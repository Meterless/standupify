// =====================================================================
// Nightshift media — makes on jobs (PRD v3 §8.3–§9).
//
//   discovery  GET  /v1/meterless/classes · /v1/meterless/transforms
//   source     POST /v1/jobs  → poll GET /v1/jobs/{id} for a usable attempt
//   make       POST /v1/jobs/{id}/materialize → make_ids (never bytes)
//   wait       GET  /v1/jobs/{id}/makes        (the MAKE's status, not the job's)
//   bytes      GET  /v1/jobs/{id}/attempts/{seq}/artifacts[/{name}]
//
// Ported from Chronicle's reference implementation (nightshiftMedia.js).
// Rules kept: nothing on the wire is guessed; a make id is persisted before
// the first poll so a reload reconnects instead of re-rendering; the
// privacy floor is never widened; a sidecar is never mistaken for media.
// =====================================================================

import { nightshiftBase, nightshiftAuthHeaders, getEngines } from '../engines';
import { bus, emit } from '../bus';
import { APP_ID } from './runtime';

/**
 * The identity of the runtime behind the base URL. Through the bridge the
 * path is always /api/nightshift/v1, so key by the origin it points at —
 * a job made on one runtime must never be "reconnected" on another.
 */
function runtimeKey(): string {
  const e = getEngines();
  return e.bridge ? `bridge:${e.nightshift.origin || 'none'}` : nightshiftBase();
}

export type MediaOutput = 'image' | 'speech' | 'music';
export type PrivacyFloor = 'local-only' | 'edge-only' | 'cloud-ok';

const PRIVACY_LS = 'standupify_media_privacy';
const ASSOC_LS = 'standupify_nightshift_media_v1';
const ASSOC_MAX = 400;

const T = {
  requestTimeoutMs: 30_000,
  sourceTimeoutMs: 8 * 60_000,
  makeTimeoutMs: 40 * 60_000,
  pollMs: 2500,
  maxPollMs: 8000,
  maxTransientErrors: 6,
  discoveryTtlMs: 60_000
};

function lsGet(k: string) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* ignore */ } }

export function getMediaPrivacy(): PrivacyFloor {
  const v = lsGet(PRIVACY_LS);
  return v === 'edge-only' || v === 'cloud-ok' ? v : 'local-only';
}
export function setMediaPrivacy(v: PrivacyFloor) {
  lsSet(PRIVACY_LS, v);
  invalidateDiscovery();
}

export class NightshiftMediaError extends Error {
  code: string | null;
  status: number | null;
  fix: string[];
  stage: string | null;
  retriable: boolean;
  makeId: string | null = null;
  constructor(message: string, o: { code?: string | null; status?: number | null; fix?: string[]; stage?: string; retriable?: boolean } = {}) {
    super(message);
    this.name = 'NightshiftMediaError';
    this.code = o.code ?? null;
    this.status = o.status ?? null;
    this.fix = (o.fix || []).filter(Boolean);
    this.stage = o.stage ?? null;
    this.retriable = !!o.retriable;
  }
}

// ---------------------------------------------------------------------
// wire
// ---------------------------------------------------------------------

const seg = (s: string | number) => encodeURIComponent(String(s));
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function url(path: string): string {
  // nightshiftBase() ends in /v1; paths here start with /v1 — never /v1/v1.
  return nightshiftBase().replace(/\/v1$/i, '') + path;
}

export async function request(method: string, path: string, body: unknown, opts: { stage?: string; timeoutMs?: number } = {}): Promise<{ status: number; data: any }> {
  const res = await raw(method, path, body, opts);
  const text = await res.text().catch(() => '');
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    const err = data?.error || {};
    const meta = data?.meterless || err.meterless || {};
    const e = new NightshiftMediaError(err.message || `Nightshift ${method} ${path} answered ${res.status}.`, {
      code: err.code || null, status: res.status, stage: opts.stage,
      fix: Array.isArray(meta.fix) ? meta.fix : Array.isArray(err.fix) ? err.fix : [],
      retriable: res.status >= 500 || res.status === 429
    });
    e.makeId = err.make_id || null;
    throw e;
  }
  return { status: res.status, data };
}

async function raw(method: string, path: string, body: unknown, opts: { stage?: string; timeoutMs?: number } = {}): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs || T.requestTimeoutMs);
  try {
    return await fetch(url(path), {
      method,
      headers: {
        'meterless-app': APP_ID,
        ...nightshiftAuthHeaders(),
        ...(body != null ? { 'Content-Type': 'application/json' } : {})
      },
      body: body != null ? JSON.stringify(body) : undefined,
      signal: ctl.signal
    });
  } catch (e: any) {
    throw new NightshiftMediaError(
      e?.name === 'AbortError' ? `Nightshift did not answer ${method} ${path} in time.` : 'Nightshift could not be reached.',
      { code: 'network', stage: opts.stage, retriable: true }
    );
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------
// discovery + carrier plan (§8.4)
// ---------------------------------------------------------------------

interface ClassRow { availability: string | null; why: string | null; chat_carrier?: boolean; routes?: { method?: string; path: string }[] }
interface Transform { id: string; label?: string; kind?: string; capability?: string; source?: string; accepts?: string; internal?: boolean; lands?: unknown; media?: { pipeline?: string; default_n?: number }; available?: boolean; reason?: string | null }
interface Discovery { at: number; base: string; classes: Record<string, ClassRow> | null; transforms: Transform[] | null; transformsRoute: 'present' | 'absent' | 'unknown'; error: NightshiftMediaError | null }

let disc: Discovery | null = null;
let discInflight: Promise<Discovery> | null = null;
const plans = new Map<MediaOutput, MediaPlan>();

export function invalidateDiscovery() { disc = null; plans.clear(); }

function normalizeClasses(data: any): Record<string, ClassRow> | null {
  const src = data?.classes || data?.data;
  if (!src || typeof src !== 'object') return null;
  const out: Record<string, ClassRow> = {};
  const put = (id: string, v: any) => {
    if (!id || !v) return;
    if (typeof v === 'string') { out[id] = { availability: v, why: null }; return; }
    out[id] = {
      availability: v.availability || v.state || null,
      why: v.why || null,
      chat_carrier: typeof v.chat_carrier === 'boolean' ? v.chat_carrier : undefined,
      routes: Array.isArray(v.routes) ? v.routes : undefined
    };
  };
  if (Array.isArray(src)) src.forEach((c: any) => put(c?.class || c?.id, c));
  else Object.keys(src).forEach(k => put(k, src[k]));
  return Object.keys(out).length ? out : null;
}

async function discover(force = false): Promise<Discovery> {
  const base = runtimeKey();
  if (!force && disc && disc.base === base && Date.now() - disc.at < T.discoveryTtlMs) return disc;
  if (discInflight) return discInflight;
  discInflight = (async () => {
    const out: Discovery = { at: Date.now(), base, classes: null, transforms: null, transformsRoute: 'unknown', error: null };
    try {
      out.classes = normalizeClasses((await request('GET', '/v1/meterless/classes', null, { stage: 'discovery' })).data);
    } catch (e: any) { if (e.code === 'network') out.error = e; }
    try {
      const r = await request('GET', '/v1/meterless/transforms', null, { stage: 'discovery' });
      out.transforms = Array.isArray(r.data?.data) ? r.data.data : [];
      out.transformsRoute = 'present';
    } catch (e: any) {
      out.transformsRoute = e.status === 404 || e.status === 405 ? 'absent' : 'unknown';
      if (e.code === 'network') out.error = e;
    }
    disc = out;
    plans.clear();
    return out;
  })();
  try { return await discInflight; } finally { discInflight = null; }
}

const OUTPUTS: Record<MediaOutput, { cls: string; kind: string; mimePrefix: string; preferred: string[]; label: string; match: (t: Transform) => boolean }> = {
  image: {
    cls: 'image', kind: 'image', mimePrefix: 'image/', preferred: ['attempt.image.still'], label: 'still image',
    match: t => t.kind === 'image' && (t.capability === 'media.image_still' || t.media?.pipeline === 'still')
  },
  speech: {
    cls: 'speech', kind: 'audio', mimePrefix: 'audio/', preferred: ['attempt.voice.narrate'], label: 'narration',
    match: t => t.kind === 'audio' && (t.capability === 'media.voice_narrate' || t.media?.pipeline === 'narrate')
  },
  music: {
    cls: 'music', kind: 'audio', mimePrefix: 'audio/', preferred: ['attempt.music.score'], label: 'score',
    match: t => t.kind === 'audio' && (t.capability === 'media.music_score' || t.media?.pipeline === 'score')
  }
};

export function pickTransform(list: Transform[] | null, output: MediaOutput): { transform: Transform | null; reason: string | null } {
  const spec = OUTPUTS[output];
  if (!Array.isArray(list)) return { transform: null, reason: 'no transforms listed' };
  const makeable = list.filter(t => t && !t.internal && !t.lands &&
    (t.source == null || t.source === 'attempt') && t.accepts !== 'artifact' && t.accepts !== 'cluster' && spec.match(t));
  if (!makeable.length) return { transform: null, reason: `this Nightshift lists no ${spec.label} transform` };
  const rank = (t: Transform) => { const i = spec.preferred.indexOf(t.id); return i === -1 ? spec.preferred.length : i; };
  makeable.sort((a, b) => rank(a) - rank(b));
  const ready = makeable.find(t => t.available !== false);
  if (ready) return { transform: ready, reason: null };
  const first = makeable[0];
  return { transform: null, reason: `${first.label || first.id} is unavailable: ${first.reason || 'Nightshift gave no reason'}` };
}

export interface MediaPlan { carrier: 'jobs' | 'none'; transform?: Transform; reason?: string; fix?: string[]; transient?: boolean; at: number }

export async function planMedia(output: MediaOutput, force = false): Promise<MediaPlan> {
  const spec = OUTPUTS[output];
  const d = await discover(force);
  const remember = (p: Omit<MediaPlan, 'at'>): MediaPlan => {
    const plan = { ...p, at: Date.now() };
    plans.set(output, plan);
    emit('standupify:media-plan', { output, plan });
    return plan;
  };
  if (d.error && d.transformsRoute === 'unknown' && !d.classes) return remember({ carrier: 'none', reason: d.error.message, transient: true });
  const row = d.classes?.[spec.cls];
  const hasMeta = !!row && typeof row.chat_carrier === 'boolean';
  const jobsRoute = (r?: ClassRow['routes']) => Array.isArray(r) && r.some(x => /\/v1\/jobs\/\{?id\}?\/materialize/i.test(String(x?.path || '')));
  if (hasMeta && row!.routes?.length && !jobsRoute(row!.routes)) {
    return remember({ carrier: 'none', reason: `Nightshift serves ${spec.cls} only through ${row!.routes!.map(r => r.path).join(', ')}, which Standupify does not speak yet.` });
  }
  if (d.transformsRoute !== 'present') {
    return remember({ carrier: 'none', reason: `This Nightshift has no jobs plane for ${spec.label}s.`, fix: ['Update Nightshift to make media through jobs.'] });
  }
  const picked = pickTransform(d.transforms, output);
  if (!picked.transform) return remember({ carrier: 'none', reason: picked.reason || undefined });
  return remember({ carrier: 'jobs', transform: picked.transform });
}

export function mediaPlanSnapshot(output: MediaOutput): MediaPlan | null { return plans.get(output) || null; }

// ---------------------------------------------------------------------
// item ↔ job association (§9.8)
// ---------------------------------------------------------------------

interface MakeRow {
  make_id: string; status: string; source_seq?: number; outputs?: string[]; transform?: string | null; step?: string;
  failure_reason?: string; failure_detail?: string;
  retries?: number; retry_after?: string; retry_reason?: string; waiting?: { held_by?: string } | null;
}

/** What the runtime is doing with a make, in words — so "queued" is never a mystery. */
function makeStep(row: MakeRow): string | null {
  if (row.step) return row.step;
  if (row.retry_reason) {
    const mins = row.retry_after ? Math.max(0, Math.round((Date.parse(row.retry_after) - Date.now()) / 60_000)) : null;
    return `Nightshift: ${row.retry_reason.replace(/_/g, ' ')}${row.retries ? ` (try ${row.retries})` : ''}${mins != null ? `, retrying in ${mins} min` : ''}`;
  }
  if (row.waiting?.held_by) return `Nightshift: waiting on ${row.waiting.held_by.replace(/_/g, ' ')}`;
  return null;
}
interface MakeRecord { makeId: string; transform: string; status: 'submitted' | 'done' | 'failed'; row?: MakeRow; error?: string }
interface Association { base: string; jobId?: string | null; seq?: number | null; privacy?: PrivacyFloor; makes: Partial<Record<MediaOutput, MakeRecord>>; touched?: number }

function readAssoc(): Record<string, Association> {
  try { const v = JSON.parse(lsGet(ASSOC_LS) || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}
function writeAssoc(all: Record<string, Association>) {
  const keys = Object.keys(all);
  if (keys.length > ASSOC_MAX) {
    keys.sort((a, b) => (all[a].touched || 0) - (all[b].touched || 0));
    keys.slice(0, keys.length - ASSOC_MAX).forEach(k => delete all[k]);
  }
  lsSet(ASSOC_LS, JSON.stringify(all));
}
function getAssociation(itemKey: string): Association | null {
  const a = readAssoc()[itemKey];
  return a && a.base === runtimeKey() ? a : null;
}
function patchAssociation(itemKey: string, patch: Partial<Association>): Association {
  const all = readAssoc();
  const prev = all[itemKey]?.base === runtimeKey() ? all[itemKey] : { base: runtimeKey(), makes: {} };
  const next = { ...prev, ...patch, makes: { ...(prev.makes || {}), ...(patch.makes || {}) }, touched: Date.now() };
  all[itemKey] = next;
  writeAssoc(all);
  return next;
}
const setMakeRecord = (itemKey: string, output: MediaOutput, rec: MakeRecord) => patchAssociation(itemKey, { makes: { [output]: rec } });

// ---------------------------------------------------------------------
// source job (§9.3, §9.4)
// ---------------------------------------------------------------------

const TERMINAL_JOB = new Set(['completed', 'cancelled', 'canceled', 'errored', 'failed']);
const attemptListSupport = new Map<string, boolean>();
const usableText = (a: any) => !!a && typeof a.text === 'string' && a.text.trim().length > 0 && !a.error;

async function readAttempt(jobId: string, seq: number) {
  try { return (await request('GET', `/v1/jobs/${seg(jobId)}/attempts/${seg(seq)}`, null, { stage: 'source' })).data; }
  catch (e: any) { if (e.status === 404) return null; throw e; }
}

async function attemptSeqs(jobId: string, job: any): Promise<number[]> {
  const base = runtimeKey();
  if (attemptListSupport.get(base) !== false) {
    try {
      const r = await request('GET', `/v1/jobs/${seg(jobId)}/attempts`, null, { stage: 'source' });
      const rows = Array.isArray(r.data) ? r.data : Array.isArray(r.data?.data) ? r.data.data : null;
      if (rows) {
        attemptListSupport.set(base, true);
        const seqs = rows.filter((x: any) => x?.seq != null && !x.error).map((x: any) => Number(x.seq)).sort((a: number, b: number) => a - b);
        const w = job?.winner_seq != null ? Number(job.winner_seq) : null;
        return [...new Set([...(w != null && seqs.includes(w) ? [w] : []), ...seqs])];
      }
    } catch (e: any) {
      if (e.status === 404 || e.status === 405) attemptListSupport.set(base, false);
      else if (e.code !== 'network') throw e;
    }
  }
  // No list route on this build: never assume seq 1.
  const seqs: number[] = [];
  if (job?.winner_seq != null) seqs.push(Number(job.winner_seq));
  const n = Math.max(Number(job?.generated) || 0, Number(job?.n) || 0, 1);
  for (let i = 1; i <= Math.min(n + 1, 12); i++) if (!seqs.includes(i)) seqs.push(i);
  return seqs;
}

async function findUsableAttempt(jobId: string, onProgress?: ProgressFn): Promise<number> {
  const deadline = Date.now() + T.sourceTimeoutMs;
  let transient = 0;
  let wait = T.pollMs;
  for (;;) {
    let job: any;
    try {
      job = (await request('GET', `/v1/jobs/${seg(jobId)}`, null, { stage: 'source' })).data;
      transient = 0;
    } catch (e: any) {
      if (e.status === 404) throw new NightshiftMediaError(`Source job ${jobId} is no longer on this Nightshift.`, { code: 'source_job_gone', stage: 'source' });
      if (!e.retriable || ++transient > T.maxTransientErrors) throw e;
      await sleep(wait);
      continue;
    }
    if (Number(job?.generated || 0) > 0 || TERMINAL_JOB.has(job?.status)) {
      for (const s of await attemptSeqs(jobId, job)) {
        const a = await readAttempt(jobId, s);
        if (usableText(a)) return Number(a.seq ?? s);
      }
    }
    if (TERMINAL_JOB.has(job?.status)) {
      throw new NightshiftMediaError(`Source job ${jobId} ${job.status} without a usable attempt.`, { code: 'source_no_attempt', stage: 'source' });
    }
    if (Date.now() > deadline) throw new NightshiftMediaError('Nightshift is still preparing this item — try again shortly.', { code: 'source_timeout', stage: 'source', retriable: true });
    onProgress?.({ stage: 'source', status: job?.status });
    await sleep(wait);
    wait = Math.min(T.maxPollMs, Math.round(wait * 1.25));
  }
}

async function createSourceJob(itemKey: string, context: string): Promise<string> {
  const brief = String(context || '').replace(/\s+/g, ' ').trim().slice(0, 1200) || itemKey;
  const r = await request('POST', '/v1/jobs', {
    kind: 'best_of_n',
    app: APP_ID,
    mode: 'meterless/text',
    n: 1,
    window: 'now',
    privacy: getMediaPrivacy(),
    media_autopilot: { mode: 'off' },
    messages: [{ role: 'user', content: `Prepare a one-paragraph brief for this stand-up comedy item: ${brief}` }]
  }, { stage: 'source' });
  const id = r.data?.id;
  if (!id) throw new NightshiftMediaError('Nightshift accepted the job but returned no id.', { code: 'source_no_id', stage: 'source' });
  patchAssociation(itemKey, { jobId: id, seq: null, privacy: getMediaPrivacy() });
  return id;
}

async function ensureSource(itemKey: string, context: string, onProgress?: ProgressFn): Promise<{ jobId: string; seq: number }> {
  const a = getAssociation(itemKey);
  if (a?.jobId && a.seq != null) return { jobId: a.jobId, seq: a.seq };
  const jobId = a?.jobId || await createSourceJob(itemKey, context);
  try {
    const seq = await findUsableAttempt(jobId, onProgress);
    patchAssociation(itemKey, { jobId, seq });
    return { jobId, seq };
  } catch (e: any) {
    // A vanished or empty job is replaced ONCE; a timeout is not (it may still run).
    if ((e.code === 'source_job_gone' || e.code === 'source_no_attempt') && a?.jobId) {
      patchAssociation(itemKey, { jobId: null, seq: null, makes: {} });
      const fresh = await createSourceJob(itemKey, context);
      const seq = await findUsableAttempt(fresh, onProgress);
      patchAssociation(itemKey, { jobId: fresh, seq });
      return { jobId: fresh, seq };
    }
    throw e;
  }
}

// ---------------------------------------------------------------------
// make → wait → collect (§9.5–§9.7)
// ---------------------------------------------------------------------

const PENDING = new Set(['submitted', 'queued', 'running']);
const FAILED = new Set(['failed', 'skipped', 'cancelled', 'canceled', 'errored']);

async function submitMake(jobId: string, seq: number, transform: Transform, text: string): Promise<string> {
  let r;
  try {
    r = await request('POST', `/v1/jobs/${seg(jobId)}/materialize`, {
      seq: Number(seq), transform: transform.id, n: 1, window: 'now', media_controls: { text: String(text) }
    }, { stage: 'make' });
  } catch (e: any) {
    if (e.code === 'already_made' && e.makeId) return e.makeId;   // a success, reconnect
    throw e;
  }
  const ids: string[] = Array.isArray(r.data?.make_ids) ? r.data.make_ids : [];
  if (!ids.length) {
    const sk = r.data?.skipped?.[0];
    throw new NightshiftMediaError(sk ? `Nightshift skipped the make: ${sk.reason}.` : 'Nightshift queued no make.', { code: sk?.reason || 'make_not_queued', stage: 'make' });
  }
  return String(ids[0]);
}

async function waitMake(jobId: string, makeId: string, onProgress?: ProgressFn): Promise<MakeRow> {
  const deadline = Date.now() + T.makeTimeoutMs;
  let transient = 0, missing = 0, wait = T.pollMs;
  for (;;) {
    let rows: MakeRow[];
    try {
      const r = await request('GET', `/v1/jobs/${seg(jobId)}/makes`, null, { stage: 'make' });
      rows = Array.isArray(r.data?.data) ? r.data.data : [];
      transient = 0;
    } catch (e: any) {
      if (e.status === 404) throw new NightshiftMediaError(`Job ${jobId} is no longer on this Nightshift.`, { code: 'make_job_gone', stage: 'make' });
      if (!e.retriable || ++transient > T.maxTransientErrors) throw e;
      await sleep(Math.min(T.maxPollMs, wait * 2));
      continue;
    }
    const row = rows.find(x => String(x?.make_id) === String(makeId));
    if (!row) {
      if (++missing > 3) throw new NightshiftMediaError(`Make ${makeId} is not on the job's ledger.`, { code: 'make_gone', stage: 'make' });
    } else {
      missing = 0;
      if (row.status === 'done') return row;
      if (FAILED.has(row.status)) {
        throw new NightshiftMediaError(
          `The render ${row.status}${row.failure_reason ? `: ${row.failure_reason}` : ''}${row.failure_detail ? ` — ${row.failure_detail}` : ''}.`,
          { code: row.failure_reason || `make_${row.status}`, stage: 'make' }
        );
      }
      onProgress?.({ stage: row.status === 'running' ? 'render' : 'queued', status: row.status, step: makeStep(row) });
    }
    if (Date.now() > deadline) {
      throw new NightshiftMediaError('Still rendering in Nightshift — the next try reconnects to it.', { code: 'make_timeout', stage: 'make', retriable: true });
    }
    await sleep(wait);
    wait = Math.min(T.maxPollMs, Math.round(wait * 1.2));
  }
}

const NON_MEDIA = /\.(json|txt|md|markdown|srt|vtt|csv|log|html?)$/i;

export function selectPrimaryArtifact(entries: any[], makeRow: MakeRow, output: MediaOutput): any | null {
  const spec = OUTPUTS[output];
  if (!Array.isArray(entries) || !makeRow) return null;
  const outputs = Array.isArray(makeRow.outputs) ? makeRow.outputs.map(String) : [];
  const mine = entries.filter(e => e?.name && (outputs.length ? outputs.includes(String(e.name)) : String(e.made?.make_id) === String(makeRow.make_id)));
  const media = mine.filter(e => {
    const mime = String(e.mime || '').toLowerCase();
    if (NON_MEDIA.test(e.name)) return false;
    if (mime && !mime.startsWith(spec.mimePrefix)) return false;
    if (!mime && e.kind !== spec.kind) return false;
    if (e.eligible === false) return false;
    const role = String(e.output_role || 'primary');
    return role !== 'supporting' && role !== 'source';
  });
  const order = (e: any) => [String(e.output_role || 'primary') === 'primary' ? 0 : 1, e.verified === true ? 0 : 1, outputs.length ? outputs.indexOf(String(e.name)) : 0];
  media.sort((a, b) => { const x = order(a), y = order(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; });
  return media[0] || null;
}

async function collect(jobId: string, row: MakeRow, fallbackSeq: number, output: MediaOutput): Promise<Blob> {
  const spec = OUTPUTS[output];
  const seq = row.source_seq ?? fallbackSeq;
  const r = await request('GET', `/v1/jobs/${seg(jobId)}/attempts/${seg(seq)}/artifacts`, null, { stage: 'bytes' });
  const entry = selectPrimaryArtifact(Array.isArray(r.data?.data) ? r.data.data : [], row, output);
  if (!entry) throw new NightshiftMediaError(`The render finished but none of its files is a ${spec.label}.`, { code: 'artifact_not_found', stage: 'bytes' });
  const res = await raw('GET', `/v1/jobs/${seg(jobId)}/attempts/${seg(seq)}/artifacts/${seg(entry.name)}`, null, { stage: 'bytes', timeoutMs: 120_000 });
  if (!res.ok) throw new NightshiftMediaError(`Nightshift answered ${res.status} for ${entry.name}.`, { code: res.status === 404 ? 'artifact_missing' : 'artifact_error', status: res.status, stage: 'bytes' });
  const header = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const declared = String(entry.mime || '').split(';')[0].trim().toLowerCase();
  const type = declared.startsWith(spec.mimePrefix) ? declared : header;
  if (!type.startsWith(spec.mimePrefix)) throw new NightshiftMediaError(`${entry.name} is ${type || 'an unknown type'}, not a ${spec.label}.`, { code: 'artifact_wrong_type', stage: 'bytes' });
  const buf = await res.arrayBuffer();
  if (!buf.byteLength) throw new NightshiftMediaError(`${entry.name} came back empty.`, { code: 'artifact_empty', stage: 'bytes' });
  return new Blob([buf], { type });
}

// ---------------------------------------------------------------------
// the one entry point
// ---------------------------------------------------------------------

export type ProgressFn = (p: { stage: string; status?: string; step?: string | null }) => void;

export interface MakeOptions {
  output: MediaOutput;
  itemKey: string;           // stable, e.g. "bit:1717…|voice"
  text: string;              // the exact prompt, or the words to speak
  context?: string;
  force?: boolean;           // an explicit "again"
  onProgress?: ProgressFn;
}

const inflight = new Map<string, Promise<Blob>>();

/** Make (or reconnect to, or collect) one piece of media. Resolves to a Blob. */
export function makeMedia(o: MakeOptions): Promise<Blob> {
  const key = `${o.itemKey}|${o.output}`;
  const existing = inflight.get(key);
  if (existing && !o.force) return existing;
  const p = runMake(o).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function runMake({ output, itemKey, text, context, force = false, onProgress }: MakeOptions): Promise<Blob> {
  if (!String(text || '').trim()) throw new NightshiftMediaError('Nothing to make from.', { code: 'empty_text' });
  let plan = await planMedia(output);
  if (plan.transient) plan = await planMedia(output, true);
  if (plan.carrier !== 'jobs' || !plan.transform) {
    throw new NightshiftMediaError(plan.reason || `Nightshift can't make a ${OUTPUTS[output].label} right now.`, { code: 'no_carrier', fix: plan.fix || [], stage: 'plan' });
  }
  const transform = plan.transform;

  const assoc = getAssociation(itemKey);
  const prior = assoc?.makes?.[output];
  if (!force && prior?.makeId && assoc?.jobId && prior.status !== 'failed') {
    try {
      let row = prior.row;
      if (PENDING.has(prior.status) || !row) {
        row = await waitMake(assoc.jobId, prior.makeId, onProgress);
        setMakeRecord(itemKey, output, { ...prior, status: 'done', row: slim(row) });
      }
      return await collect(assoc.jobId, row, assoc.seq ?? 1, output);
    } catch (e: any) {
      if (e.retriable || e.code === 'network' || e.code === 'make_timeout') throw e;
      setMakeRecord(itemKey, output, { ...prior, status: 'failed', error: e.message });
    }
  }

  let { jobId, seq } = await ensureSource(itemKey, context || text, onProgress);
  let makeId: string;
  try {
    makeId = await submitMake(jobId, seq, transform, text);
  } catch (e: any) {
    if (e.code !== 'source_not_found' && e.code !== 'job_not_found') throw e;
    patchAssociation(itemKey, { jobId: e.code === 'job_not_found' ? null : jobId, seq: null });
    ({ jobId, seq } = await ensureSource(itemKey, context || text, onProgress));
    makeId = await submitMake(jobId, seq, transform, text);
  }
  // Persist BEFORE the first poll — this is what makes reconnecting possible.
  setMakeRecord(itemKey, output, { makeId, transform: transform.id, status: 'submitted' });
  onProgress?.({ stage: 'queued', status: 'submitted' });
  const row = await waitMake(jobId, makeId, onProgress);
  setMakeRecord(itemKey, output, { makeId, transform: transform.id, status: 'done', row: slim(row) });
  return collect(jobId, row, seq, output);
}

function slim(row: MakeRow): MakeRow {
  return { make_id: row.make_id, status: row.status, source_seq: row.source_seq, outputs: row.outputs || [], transform: row.transform || null };
}

bus.addEventListener('meterless:health', (e: Event) => {
  if ((e as CustomEvent).detail?.state === 'online') {
    invalidateDiscovery();
    (['image', 'speech', 'music'] as MediaOutput[]).forEach(o => planMedia(o).catch(() => { /* surfaced on use */ }));
  }
});
