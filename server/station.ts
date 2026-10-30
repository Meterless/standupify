// =====================================================================
// The Station — the Circuit runs inside `npm start`, not inside a tab.
//
// The bridge loads this module once (through Vite's SSR loader, so it shares
// the app's own engine code). It keeps everything on disk under
// engines/station/, runs the Circuit headless against the engines the bridge
// discovered, and serves the browser:
//
//   GET  /api/station/hello            is there a Station?
//   GET  /api/station/snapshot         circuit state + recent shows + live view
//   GET  /api/station/stream           SSE: snapshot / live / tasks, as they change
//   POST /api/station/repo             {method, args} → the Repository, over the wire
//   POST /api/station/cmd              {name, args}   → runShow, setLive, …
//   POST /api/station/import           a browser's IndexedDB, once
//   GET  /api/station/media/<file>     every still and clip, as a file
//
// Media never travels inside JSON: any long data: URL is written to
// engines/station/media/<sha1>.<ext> and replaced with its /api/station/media URL.
// =====================================================================

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { resolveObjectURL } from 'node:buffer';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AISettings, AutopilotJob, Clip, Comedian, OutboxItem, Promo, ScoutTarget, Set as ComedySet } from '../types';
import { DEFAULT_SETTINGS, normalizeComedian, setRepository, type Repository } from '../services/repository';
import { configureHeadless, setEngineStatus, type ComfyStatus, type NightshiftStatus } from '../services/engines';
import { media } from '../services/bus';
import { subscribeTasks, getTasks } from '../services/tasks';
import { headshotPrompt } from '../services/studio';
import * as store from '../services/league/store';
import * as engine from '../services/league/engine';
import type { CircuitState, Show } from '../services/league/types';
import * as originals from '../services/premium/production';
import * as autopilot from '../services/autopilot';
import { extractGraph, summarizeGraph, type ComfyGraph, type ProvenanceSummary } from '../services/comfy/provenance';

const MEDIA_PREFIX = '/api/station/media/';
const INLINE_MAX = 4096;   // shorter data: URLs (icons, tiny gifs) stay inline

// ---------------------------------------------------------------------
// media on disk
// ---------------------------------------------------------------------

let mediaDir = '';
const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/webm': 'webm', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/ogg': 'ogg', 'audio/webm': 'weba' };
const MIME: Record<string, string> = Object.fromEntries(Object.entries(EXT).map(([m, e]) => [e, m]));

function externalize(s: string): string {
  const m = /^data:([^;,]+)(;base64)?,/.exec(s);
  if (!m) return s;
  const bytes = m[2] ? Buffer.from(s.slice(m[0].length), 'base64') : Buffer.from(decodeURIComponent(s.slice(m[0].length)));
  const name = `${crypto.createHash('sha1').update(bytes).digest('hex')}.${EXT[m[1]] || 'bin'}`;
  const file = path.join(mediaDir, name);
  if (!fs.existsSync(file)) fs.writeFileSync(file, bytes);
  return MEDIA_PREFIX + name;
}

/** Deep, in place: long data: URLs become files. Returns the same object. */
function shrink<T>(v: T): T {
  if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) v[i] = shrinkValue(v[i]); return v; }
  if (v && typeof v === 'object') { for (const k of Object.keys(v)) (v as any)[k] = shrinkValue((v as any)[k]); }
  return v;
}
function shrinkValue(x: any): any {
  if (typeof x === 'string') return x.length > INLINE_MAX && x.startsWith('data:') ? externalize(x) : x;
  return x && typeof x === 'object' ? shrink(x) : x;
}
const replacer = (_k: string, x: unknown) => (typeof x === 'string' && x.length > INLINE_MAX && x.startsWith('data:') ? externalize(x) : x);
const toJson = (v: unknown) => JSON.stringify(v, replacer);

function mediaFile(url: string): string | null {
  if (!url.startsWith(MEDIA_PREFIX)) return null;
  const name = url.slice(MEDIA_PREFIX.length).split('?')[0];
  return /^[a-f0-9]{40}\.[a-z0-9]+$/.test(name) ? path.join(mediaDir, name) : null;
}

// Provenance: the ComfyUI graph each file carries, read from the file itself.
// Media files are content-addressed, so one read per name is enough.
const provCache = new Map<string, { graph: ComfyGraph; summary: ProvenanceSummary } | null>();
function provenanceOf(f: string) {
  const key = path.basename(f);
  if (!provCache.has(key)) {
    let entry: { graph: ComfyGraph; summary: ProvenanceSummary } | null = null;
    try {
      const graph = extractGraph(fs.readFileSync(f));
      if (graph) entry = { graph, summary: summarizeGraph(graph) };
    } catch { /* unreadable: no provenance */ }
    provCache.set(key, entry);
  }
  return provCache.get(key)!;
}

function provenanceTally() {
  const files = (() => { try { return fs.readdirSync(mediaDir).filter(n => /^[a-f0-9]{40}\.(mp4|webm|png|webp|jpg)$/.test(n)); } catch { return []; } })();
  const byFamily: Record<string, { kind: string; count: number }> = {};
  let withGraph = 0;
  for (const n of files) {
    const p = provenanceOf(path.join(mediaDir, n));
    if (!p) continue;
    withGraph++;
    const k = `${p.summary.kind}:${p.summary.family}`;
    (byFamily[k] ||= { kind: p.summary.kind, count: 0 }).count++;
  }
  return {
    files: files.length,
    withGraph,
    families: Object.entries(byFamily).map(([k, v]) => ({ family: k.split(':').slice(1).join(':'), kind: v.kind, count: v.count })).sort((a, b) => b.count - a.count)
  };
}

// ---------------------------------------------------------------------
// tables — every record is its own JSON file; reads come from memory
// ---------------------------------------------------------------------

class Table<T extends { id: string }> {
  rows = new Map<string, T>();
  constructor(private dir: string) {
    fs.mkdirSync(dir, { recursive: true });
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) {
      try { const r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); if (r?.id) this.rows.set(String(r.id), r); } catch { /* skip a torn file */ }
    }
  }
  private file(id: string) { return path.join(this.dir, `${encodeURIComponent(id)}.json`); }
  get(id: string): T | undefined { const r = this.rows.get(id); return r ? structuredClone(r) : undefined; }
  all(): T[] { return [...this.rows.values()].map(r => structuredClone(r)); }
  /** Filter before cloning: listing one comedian's rows should not copy the whole table. */
  where(keep: (r: T) => boolean): T[] { return [...this.rows.values()].filter(keep).map(r => structuredClone(r)); }
  put(r: T) {
    shrink(r);
    this.rows.set(String(r.id), structuredClone(r));
    const f = this.file(String(r.id));
    fs.writeFileSync(`${f}.tmp`, JSON.stringify(r));
    fs.renameSync(`${f}.tmp`, f);
  }
  del(id: string) { this.rows.delete(id); try { fs.unlinkSync(this.file(id)); } catch { /* gone */ } }
  clear() { for (const id of [...this.rows.keys()]) this.del(id); }
}

const by = <T>(key: (t: T) => number) => (a: T, b: T) => key(b) - key(a);

class FileRepository implements Repository {
  comedians: Table<Comedian>; sets: Table<ComedySet>; clips: Table<Clip>; promos: Table<Promo>;
  scouts: Table<ScoutTarget>; jobs: Table<AutopilotJob>; outbox: Table<OutboxItem>;
  private settingsFile: string;
  current: AISettings;
  constructor(dir: string) {
    this.comedians = new Table(path.join(dir, 'comedians'));
    this.sets = new Table(path.join(dir, 'sets'));
    this.clips = new Table(path.join(dir, 'clips'));
    this.promos = new Table(path.join(dir, 'promos'));
    this.scouts = new Table(path.join(dir, 'scouts'));
    this.jobs = new Table(path.join(dir, 'jobs'));
    this.outbox = new Table(path.join(dir, 'outbox'));
    this.settingsFile = path.join(dir, 'settings.json');
    let saved: Partial<AISettings> = {};
    try { saved = JSON.parse(fs.readFileSync(this.settingsFile, 'utf8')); } catch { /* defaults */ }
    this.current = clean(saved);
  }
  async getComedian(id: string) { const c = this.comedians.get(id); return c ? normalizeComedian(c) : undefined; }
  async listComedians() { return this.comedians.all().map(normalizeComedian).sort(by(c => c.updatedAt)); }
  async saveComedian(c: Comedian) { c.updatedAt = Date.now(); this.comedians.put(c); }
  async deleteComedian(id: string) {
    this.comedians.del(id);
    for (const t of [this.sets, this.clips, this.promos, this.scouts, this.jobs, this.outbox] as Table<any>[]) {
      for (const r of t.all()) if (r.comedianId === id) t.del(r.id);
    }
  }
  async getSet(id: string) { return this.sets.get(id); }
  async listSets(comedianId: string) { return this.sets.where(s => s.comedianId === comedianId).sort(by(s => s.createdAt)); }
  async saveSet(s: ComedySet) { s.updatedAt = Date.now(); this.sets.put(s); }
  async deleteSet(id: string) { this.sets.del(id); }
  async getClip(id: string) { return this.clips.get(id); }
  async listClips(comedianId: string) { return this.clips.where(c => c.comedianId === comedianId).sort(by(c => c.createdAt)); }
  async saveClip(c: Clip) { this.clips.put(c); }
  async deleteClip(id: string) { this.clips.del(id); }
  async listPromos(comedianId: string) { return this.promos.all().filter(p => p.comedianId === comedianId).sort(by(p => p.createdAt)); }
  async savePromo(p: Promo) { this.promos.put(p); }
  async deletePromo(id: string) { this.promos.del(id); }
  async listScouts(comedianId: string) { return this.scouts.all().filter(s => s.comedianId === comedianId).sort(by(s => s.relevanceScore)); }
  async saveScout(t: ScoutTarget) { t.updatedAt = Date.now(); this.scouts.put(t); }
  async deleteScout(id: string) { this.scouts.del(id); }
  async listJobs(comedianId?: string) { return this.jobs.all().filter(j => !comedianId || j.comedianId === comedianId).sort(by(j => j.createdAt)); }
  async saveJob(j: AutopilotJob) {
    this.jobs.put(j);
    const all = this.jobs.all().sort(by(x => x.createdAt));
    for (const old of all.slice(200)) this.jobs.del(old.id);
  }
  async deleteJob(id: string) { this.jobs.del(id); }
  async listOutbox(comedianId?: string) { return this.outbox.all().filter(o => !comedianId || o.comedianId === comedianId).sort(by(o => o.submittedAt)); }
  async saveOutboxItem(o: OutboxItem) { this.outbox.put(o); }
  async deleteOutboxItem(id: string) { this.outbox.del(id); }
  async getSettings() { return { ...this.current }; }
  async saveSettings(s: AISettings) {
    this.current = clean(s);
    fs.writeFileSync(this.settingsFile, JSON.stringify(this.current, null, 2));
  }
  isEmpty() { return this.comedians.rows.size === 0 && this.sets.rows.size === 0; }
}

function clean(s: Partial<AISettings>): AISettings {
  const merged: any = { ...DEFAULT_SETTINGS, ...(s || {}) };
  const out = {} as AISettings;
  for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof AISettings)[]) (out as any)[k] = merged[k];
  return out;
}

// The Circuit's own records.
class FileCircuit implements store.CircuitPersistence {
  shows: Table<Show>;
  constructor(private dir: string) { this.shows = new Table(path.join(dir, 'shows')); }
  private get stateFile() { return path.join(this.dir, 'circuit.json'); }
  async loadState() { try { return JSON.parse(fs.readFileSync(this.stateFile, 'utf8')) as CircuitState; } catch { return undefined; } }
  async writeState(st: CircuitState) {
    const f = this.stateFile;
    fs.writeFileSync(`${f}.tmp`, toJson(st));
    fs.renameSync(`${f}.tmp`, f);
  }
  async writeShow(show: Show) { this.shows.put(show); }
  async getShow(id: string) { return this.shows.get(id); }
  async recentShows(limit: number) { return this.shows.all().sort((a, b) => b.night - a.night || b.startedAt - a.startedAt).slice(0, limit); }
  async reset() { this.shows.clear(); try { fs.unlinkSync(this.stateFile); } catch { /* none */ } }
  isEmpty() { return !fs.existsSync(this.stateFile); }
}

// ---------------------------------------------------------------------
// start
// ---------------------------------------------------------------------

export interface StationProbe {
  status(): Promise<{ nightshift: NightshiftStatus; comfy: ComfyStatus }>;
  token(): string | null;
}

let repo: FileRepository;
let circuit: FileCircuit;
let started = false;
let onAir = false;
let opening: Promise<void> | null = null;
const getSettings = () => repo.current;

/** Start the Circuit. A brand-new Station first waits for a browser to hand over its roster. */
async function goOnAir() {
  if (opening) return opening;
  if (onAir) return;
  onAir = true;
  opening = (async () => {
    await engine.ensureCircuit();
    engine.resumeIfLive(getSettings);
    originals.startOriginals(getSettings);
    await autopilot.resumeAutopilot(getSettings());
    console.log(`  \x1b[38;5;215m●\x1b[0m Station on the air — the Circuit keeps running with the tab closed.`);
  })().catch(e => { onAir = false; throw e; }).finally(() => { opening = null; });
  return opening;
}

export async function startStation(root: string, probe: StationProbe) {
  if (started) return;
  started = true;
  const dir = process.env.STANDUPIFY_STATION_DIR || path.join(root, 'engines', 'station');
  mediaDir = path.join(dir, 'media');
  fs.mkdirSync(mediaDir, { recursive: true });
  repo = new FileRepository(path.join(dir, 'db'));
  circuit = new FileCircuit(dir);
  setRepository(repo);
  store.setCircuitPersistence(circuit);
  const shiftFile = path.join(dir, 'night-shift.json');
  autopilot.configureAutopilotPersistence({
    async load() {
      try { return JSON.parse(fs.readFileSync(shiftFile, 'utf8')); }
      catch (e: any) { if (e?.code === 'ENOENT') return null; throw e; }
    },
    async save(state) {
      fs.writeFileSync(`${shiftFile}.tmp`, JSON.stringify(state, null, 2));
      fs.renameSync(`${shiftFile}.tmp`, shiftFile);
    }
  });
  media.resolve = async (url) => {
    const f = mediaFile(url);
    if (!f) return null;
    const ext = path.extname(f).slice(1);
    return new Blob([fs.readFileSync(f)], { type: MIME[ext] || 'application/octet-stream' });
  };

  // The engines, as the bridge sees them — re-read every few seconds.
  const feed = async () => {
    try {
      const { nightshift, comfy } = await probe.status();
      configureHeadless({
        nightshiftBase: `${(nightshift.origin || 'http://127.0.0.1:8088').replace(/\/+$/, '')}/v1`,
        token: probe.token(),
        comfyBase: (comfy.origin || 'http://127.0.0.1:8188').replace(/\/+$/, '')
      });
      setEngineStatus(nightshift, comfy);
    } catch { /* next tick */ }
  };
  await feed();
  setInterval(feed, 5000).unref();

  wireStream();
  if (!(repo.isEmpty() && circuit.isEmpty())) await goOnAir();
  else {
    // Nobody has handed anything over within a few minutes: start fresh.
    setTimeout(() => { goOnAir().catch(e => console.warn('Station could not open:', e)); }, 5 * 60_000).unref();
  }
}

// ---------------------------------------------------------------------
// live stream (SSE)
// ---------------------------------------------------------------------

const clients = new Set<ServerResponse>();
let lastState: unknown = null, lastShows: unknown = null, lastLive: unknown = null;
const pending = { snapshot: false, live: false, tasks: false, autopilot: false };
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function send(res: ServerResponse, event: string, data: string) { res.write(`event: ${event}\ndata: ${data}\n\n`); }

function snapshotBody() {
  const s = store.getCircuitSnapshot();
  return { state: s.state, shows: s.shows, live: s.live };
}

const previews = new Map<string, string>();
async function tasksBody() {
  const out = [];
  for (const t of getTasks().slice(0, 30)) {
    let preview: string | undefined;
    if (t.preview?.startsWith('blob:')) {
      preview = previews.get(t.preview);
      if (!preview) {
        const b = resolveObjectURL(t.preview);
        if (b) { preview = `data:${b.type || 'image/jpeg'};base64,${Buffer.from(await b.arrayBuffer()).toString('base64')}`; previews.clear(); previews.set(t.preview, preview); }
      }
    }
    const { cancel, ...rest } = t;
    out.push({ ...rest, preview, remote: true });
  }
  return out;
}

function schedule(kind: keyof typeof pending, ms: number) {
  pending[kind] = true;
  if (flushTimer || !clients.size) return;
  flushTimer = setTimeout(flush, ms);
}

async function flush() {
  flushTimer = null;
  if (!clients.size) { pending.snapshot = pending.live = pending.tasks = pending.autopilot = false; return; }
  const parts: [string, string][] = [];
  if (pending.snapshot) parts.push(['snapshot', toJson(snapshotBody())]);
  else if (pending.live) parts.push(['live', toJson(store.getCircuitSnapshot().live)]);
  if (pending.tasks) parts.push(['tasks', JSON.stringify(await tasksBody())]);
  if (pending.autopilot) parts.push(['autopilot', toJson(await autopilot.getAutopilotStatus())]);
  pending.snapshot = pending.live = pending.tasks = pending.autopilot = false;
  for (const res of clients) for (const [e, d] of parts) send(res, e, d);
}

function wireStream() {
  store.subscribeCircuit(() => {
    const s = store.getCircuitSnapshot();
    if (s.state !== lastState || s.shows !== lastShows) { lastState = s.state; lastShows = s.shows; schedule('snapshot', 600); }
    if (s.live !== lastLive) { lastLive = s.live; schedule('live', 250); }
  });
  subscribeTasks(() => schedule('tasks', 800));
  autopilot.onStatus(() => schedule('autopilot', 100));
  setInterval(() => { for (const res of clients) res.write(': keep-alive\n\n'); }, 20_000).unref();
}

// ---------------------------------------------------------------------
// commands + RPC
// ---------------------------------------------------------------------

const REPO_METHODS = new Set([
  'getComedian', 'listComedians', 'saveComedian', 'deleteComedian', 'getSet', 'listSets', 'saveSet', 'deleteSet',
  'getClip', 'listClips', 'saveClip', 'deleteClip', 'listPromos', 'savePromo', 'deletePromo', 'listScouts', 'saveScout', 'deleteScout',
  'listJobs', 'saveJob', 'deleteJob', 'listOutbox', 'saveOutboxItem', 'deleteOutboxItem', 'getSettings', 'saveSettings'
]);

const COMMANDS: Record<string, (...a: any[]) => Promise<unknown> | unknown> = {
  autopilotStatus: () => autopilot.getAutopilotStatus(),
  autopilotStart: async (interval?: number) => {
    await goOnAir();
    await autopilot.startAutopilot(getSettings(), interval);
    return autopilot.getAutopilotStatus();
  },
  autopilotStop: async () => { await autopilot.stopAutopilot(); return autopilot.getAutopilotStatus(); },
  autopilotRunNow: async (id: string) => {
    await goOnAir();
    const c = await repo.getComedian(String(id));
    if (!c) throw new Error('This comedian is no longer in the roster.');
    await autopilot.triggerCycleNow(c, getSettings());
    return true;
  },
  ensureCircuit: async () => { await goOnAir(); return true; },
  runShow: () => { if (!engine.isShowRunning()) engine.runShow(getSettings()).catch(e => console.warn('station show', e)); return true; },
  setLive: (on: boolean) => engine.setLive(!!on, getSettings),
  setRehearsals: (n: number) => engine.setRehearsals(Number(n)),
  resetCircuit: () => engine.resetCircuit(),
  enterCircuit: async (id: string) => { const c = await repo.getComedian(id); if (c) await engine.enterCircuit(c); return !!c; },
  shootRoster: () => engine.shootRoster(getSettings(), c => headshotPrompt(c, c.venue)),
  reelStatus: () => engine.reelStatus(),
  originalsGreenlight: (id: string, o?: originals.GreenlightOptions) => originals.greenlightOriginal(String(id), o || {}),
  originalsPause: (id: string, paused: boolean) => originals.pauseOriginal(String(id), !!paused),
  originalsList: () => originals.listOriginals()
};

/** The first browser to connect hands over its IndexedDB, if the Station is still empty. */
async function importBrowser(body: any) {
  const out = { comedians: 0, sets: 0, shows: 0, circuit: false };
  if (onAir || !repo.isEmpty()) { await goOnAir(); return { ...out, skipped: 'The Station already has a roster.' }; }
  for (const c of body.comedians || []) { repo.comedians.put(c); out.comedians++; }
  for (const s of body.sets || []) { repo.sets.put(s); out.sets++; }
  for (const c of body.clips || []) repo.clips.put(c);
  for (const p of body.promos || []) repo.promos.put(p);
  for (const s of body.scouts || []) repo.scouts.put(s);
  for (const j of body.jobs || []) repo.jobs.put(j);
  for (const o of body.outbox || []) repo.outbox.put(o);
  if (body.settings) await repo.saveSettings(body.settings);
  if (body.circuit?.state) {
    for (const sh of body.circuit.shows || []) { await circuit.writeShow(sh); out.shows++; }
    await circuit.writeState(body.circuit.state as CircuitState);   // a show in progress resumes here
    out.circuit = true;
  }
  await goOnAir();
  return out;
}

function readBody(req: IncomingMessage, limit = 1024 * 1024 * 1024): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown) {
  const text = toJson(body);
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(text);
}

/** Bridge entry point. Returns false if the path is not the Station's. */
export async function handleStation(req: IncomingMessage, res: ServerResponse, p: string): Promise<boolean> {
  if (!p.startsWith('/api/station/')) return false;
  if (!started) { json(res, 503, { error: { message: 'The Station is starting.' } }); return true; }
  const route = p.slice('/api/station/'.length);
  const write = req.method === 'POST';
  if (write && req.headers['x-standupify'] !== '1') { json(res, 403, { error: { message: 'missing x-standupify header' } }); return true; }

  if (route === 'hello') { json(res, 200, { ok: true, empty: !onAir && repo.isEmpty() && circuit.isEmpty() }); return true; }
  if (route === 'snapshot') { json(res, 200, snapshotBody()); return true; }

  if (route === 'stream') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    clients.add(res);
    send(res, 'snapshot', toJson(snapshotBody()));
    send(res, 'tasks', JSON.stringify(await tasksBody()));
    send(res, 'autopilot', toJson(await autopilot.getAutopilotStatus()));
    req.on('close', () => clients.delete(res));
    return true;
  }

  if (route.startsWith('media/')) {
    const f = mediaFile(`/api/station/${route}`);
    if (!f || !fs.existsSync(f)) { res.writeHead(404); res.end(); return true; }
    const stat = fs.statSync(f);
    const type = MIME[path.extname(f).slice(1)] || 'application/octet-stream';
    const range = /bytes=(\d*)-(\d*)/.exec(String(req.headers.range || ''));
    const head = { 'content-type': type, 'cache-control': 'public, max-age=31536000, immutable', 'accept-ranges': 'bytes' };
    if (range) {   // <video> seeks
      const start = range[1] ? Number(range[1]) : 0;
      const end = range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
      res.writeHead(206, { ...head, 'content-range': `bytes ${start}-${end}/${stat.size}`, 'content-length': end - start + 1 });
      fs.createReadStream(f, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { ...head, 'content-length': stat.size });
      fs.createReadStream(f).pipe(res);
    }
    return true;
  }

  if (route === 'provenance') { json(res, 200, provenanceTally()); return true; }
  if (route.startsWith('provenance/media/')) {
    const f = mediaFile(`/api/station/${route.slice('provenance/'.length)}`);
    if (!f || !fs.existsSync(f)) { json(res, 404, { error: { message: 'No such media file.' } }); return true; }
    const p = provenanceOf(f);
    json(res, 200, p ? { ok: true, ...p } : { ok: false, reason: 'This file carries no ComfyUI graph (sample media, a Nightshift still, or a render from another tool).' });
    return true;
  }

  if (!write) { json(res, 404, { error: { message: `No Station route ${route}` } }); return true; }
  try {
    const body = await readBody(req);
    if (route === 'repo') {
      if (!REPO_METHODS.has(body.method)) { json(res, 400, { error: { message: `unknown method ${body.method}` } }); return true; }
      const out = await (repo as any)[body.method](...(body.args || []));
      json(res, 200, { result: out ?? null });
      return true;
    }
    if (route === 'cmd') {
      const fn = COMMANDS[body.name];
      if (!fn) { json(res, 400, { error: { message: `unknown command ${body.name}` } }); return true; }
      json(res, 200, { result: (await fn(...(body.args || []))) ?? null });
      return true;
    }
    if (route === 'import') { json(res, 200, await importBrowser(body)); return true; }
  } catch (e: any) {
    json(res, 500, { error: { message: e?.message || String(e) } });
    return true;
  }
  json(res, 404, { error: { message: `No Station route ${route}` } });
  return true;
}
