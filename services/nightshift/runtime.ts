// =====================================================================
// Nightshift runtime — the chat carrier (PRD v3 §10, §12, §13).
//
// text · code · vision · judge ride /v1/chat/completions. Media is made
// through jobs (./media.ts) — chat refuses it on every shipped build.
// =====================================================================

import { nightshiftBase, nightshiftAuthHeaders, markNightshiftOffline } from '../engines';
import { resolveTaskMode, Task, Quality, ResolvedMode } from './modes';

export const APP_ID = 'standupify';

export class NightshiftError extends Error {
  code: string | null;
  status: number | null;
  fix: string[];
  carrier: boolean;
  constructor(message: string, o: { code?: string | null; status?: number | null; fix?: string[]; carrier?: boolean } = {}) {
    super(message);
    this.name = 'NightshiftError';
    this.code = o.code ?? null;
    this.status = o.status ?? null;
    this.fix = o.fix || [];
    this.carrier = !!o.carrier;
  }
}

// Used only when the server sent no fix[] of its own (§12.1).
const HINTS: Record<string, string> = {
  class_not_ready: 'Nothing of that kind is loaded yet and Fast mode refuses to wait — switch Quality to Auto.',
  class_no_capacity: 'Nightshift would have to stop a running model to fit this one. Free some memory and try again.',
  class_gated: 'That kind of model is switched off in Nightshift (Setup › Media).',
  class_floor_blocked: 'Every route for that job is above your privacy floor.',
  mode_not_permitted: 'Standupify is not allowed to use that mode. Widen its mode set in Nightshift.',
  admission_timed_out: 'A model was still loading when the call timed out. It keeps loading — try again in a moment.',
  no_provider_configured: 'Nightshift has no model for that job yet. Open Nightshift and add one.',
  engine_timeout: 'The Nightshift engine timed out.'
};

export async function toNightshiftError(resp: Response): Promise<NightshiftError> {
  let body: any = null;
  try { body = await resp.json(); } catch { /* not JSON */ }
  const err = body?.error || {};
  const meta = body?.meterless || err.meterless || {};
  let code: string | null = err.code || body?.code || null;
  if (/empty_response$/i.test(String(err.message || ''))) code = 'empty_response';
  const carrier = code === 'class_carrier_unsupported' || meta.chat_carrier === false;
  let fix: string[] = Array.isArray(meta.fix) ? meta.fix : Array.isArray(err.fix) ? err.fix : [];
  if (!fix.length && code && HINTS[code] && !carrier) fix = [HINTS[code]];
  if (resp.status === 401 || resp.status === 403) fix = [...fix, 'Nightshift refused the access token — restart it, or paste its token in Engines.'];
  let message = err.message || `Nightshift answered ${resp.status}.`;
  if (/empty_response$/i.test(message)) message = "Nightshift's model answered with nothing — it may be busy. Try again in a moment.";
  return new NightshiftError(message, { code, status: resp.status, fix, carrier });
}

/** One sentence for a surface: the server's message, then its remediation. */
export function describeError(e: unknown): string {
  if (!e) return 'Something went wrong.';
  const any = e as any;
  const msg = String(any.message || e);
  const fix = Array.isArray(any.fix) && any.fix.length ? ` ${any.fix[0]}` : '';
  return msg + fix;
}

function headers(mode: ResolvedMode | null, extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    'meterless-app': APP_ID,
    ...nightshiftAuthHeaders(),
    ...extra
  };
  if (mode) {
    h['meterless-scope'] = 'user';
    h['meterless-mode'] = mode.header;
    if (mode.accept) h['meterless-accept'] = mode.accept;   // per request, never global (§7.3)
  }
  return h;
}

const RETRY = [2000, 4000, 8000];
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** fetch with the §10.5 rate-limit ladder and a network failure → offline signal. */
export async function nsFetch(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  const url = `${nightshiftBase()}${path}`;
  for (let attempt = 0; ; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), init.timeoutMs ?? 180_000);
    const outer = init.signal;
    const onAbort = () => ctl.abort();
    outer?.addEventListener('abort', onAbort);
    let resp: Response;
    try {
      resp = await fetch(url, { ...init, signal: ctl.signal });
    } catch (e: any) {
      if (outer?.aborted) throw e;
      if (e?.name === 'AbortError') throw new NightshiftError('Nightshift took too long to answer. It may still be loading a model — try again.', { code: 'timeout' });
      markNightshiftOffline('A request could not reach Nightshift.');
      throw new NightshiftError('Nightshift is not running (or not reachable).', { code: 'network', fix: ['Press Start next to Nightshift in Engines.'] });
    } finally {
      clearTimeout(timer);
      outer?.removeEventListener('abort', onAbort);
    }
    if (resp.status === 503 && resp.headers.get('content-type')?.includes('json')) {
      const err = await toNightshiftError(resp);
      if (err.code === 'runtime_unreachable') markNightshiftOffline(err.message);
      throw err;
    }
    if (resp.status === 429 && attempt < RETRY.length) { await sleep(RETRY[attempt]); continue; }
    if (!resp.ok) throw await toNightshiftError(resp);
    return resp;
  }
}

// ---------------------------------------------------------------------
// Reading answers: accept every shape a runtime has emitted (§10.2)
// ---------------------------------------------------------------------

function readContent(content: any): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter(p => p && p.type === 'text' && typeof p.text === 'string').map(p => p.text).join('\n\n');
}

export interface ChatRequest {
  task: Task;
  quality?: Quality;
  system?: string;
  prompt: string;
  images?: string[];            // data: URLs or bare base64
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
  onDelta?: (textSoFar: string) => void;
  onProgress?: (p: { stage: string; pct?: number }) => void;
  signal?: AbortSignal;
}

export interface ChatResult { text: string; model: string | null; mode: ResolvedMode; meta: any }

export async function chat(req: ChatRequest): Promise<ChatResult> {
  try {
    return await chatOnce(req, req.quality);
  } catch (e) {
    // Our own auto-set picked "fast" for latency; if nothing is loaded yet,
    // let Nightshift load something rather than refuse. A Fast the user
    // chose stays Fast.
    const auto = !req.quality || req.quality === 'auto';
    if (auto && e instanceof NightshiftError && e.code === 'class_not_ready' && resolveTaskMode(req.task, 'auto').disposition === 'fast') {
      return chatOnce(req, req.quality, true);
    }
    // Thinking models spend the budget reasoning and answer with nothing;
    // give the answer room once rather than failing.
    if (e instanceof NightshiftError && e.code === 'empty_response') {
      return chatOnce({ ...req, maxTokens: Math.max(2048, (req.maxTokens ?? 2048) * 2) }, req.quality);
    }
    throw e;
  }
}

async function chatOnce(req: ChatRequest, quality: Quality | undefined, forceAuto = false): Promise<ChatResult> {
  let mode = resolveTaskMode(req.task, quality, { hasImage: !!req.images?.length });
  if (forceAuto) mode = { ...mode, disposition: 'auto', modelId: `meterless/${mode.cls}.auto`, header: `${mode.cls}.auto` };
  const messages: any[] = [];
  if (req.system) messages.push({ role: 'system', content: req.system });
  // Plain text stays a string — byte-identical to v1 (§10.1).
  const user = req.images?.length
    ? [{ type: 'text', text: req.prompt }, ...req.images.map(i => ({ type: 'image_url', image_url: { url: i.startsWith('data:') ? i : `data:image/jpeg;base64,${i}` } }))]
    : req.prompt;
  messages.push({ role: 'user', content: user });

  // Always stream: the request timeout then guards time-to-first-token, not a
  // multi-minute answer from a thinking model on a small local GPU.
  const stream = true;
  const wantsTrace = !!(req.onDelta || req.onProgress);
  const body: any = {
    model: mode.modelId,
    messages,
    stream,
    temperature: req.temperature ?? 0.8,
    max_tokens: req.maxTokens ?? 2048
  };
  if (req.json) body.response_format = { type: 'json_object' };

  const resp = await nsFetch('/chat/completions', {
    method: 'POST',
    headers: headers(mode, { Accept: 'text/event-stream', ...(wantsTrace ? { 'meterless-trace': 'on' } : {}) }),
    body: JSON.stringify(body),
    signal: req.signal
  });

  // Pick the reader from what came back, never from what we asked for (§10.4).
  const type = resp.headers.get('content-type') || '';
  if (!stream || type.includes('application/json') || !resp.body?.getReader) {
    const payload = await resp.json();
    const text = readContent(payload?.choices?.[0]?.message?.content).trim();
    req.onDelta?.(text);
    return { text, model: payload?.model || null, mode, meta: payload?.meterless || null };
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let model: string | null = null;
  let meta: any = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith('data:')) continue;
      const data = t.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      let frame: any;
      try { frame = JSON.parse(data); } catch { continue; }
      model = frame.model || model;
      if (frame.meterless?.progress) req.onProgress?.(frame.meterless.progress);
      else if (frame.meterless) meta = { ...(meta || {}), ...frame.meterless };
      const delta = frame.choices?.[0]?.delta;
      if (!delta) continue;
      const piece = typeof delta.content === 'string' ? delta.content : readContent(delta.content);
      if (piece) { text += piece; req.onDelta?.(text); }
    }
  }
  return { text: text.trim(), model, mode, meta };
}

// ---------------------------------------------------------------------
// JSON out of a model answer, tolerant of fences and chatter
// ---------------------------------------------------------------------

export function extractJson<T = any>(text: string): T {
  if (!text) throw new NightshiftError('Nightshift returned an empty answer.', { code: 'empty' });
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  // Reasoning models sometimes think out loud first.
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const start = s.search(/[{[]/);
  if (start === -1) throw new NightshiftError('Nightshift answered without the JSON Standupify asked for.', { code: 'not_json' });
  const open = s[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0, end = -1, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) { end = i; break; }
  }
  const slice = end === -1 ? s.slice(start) : s.slice(start, end + 1);
  try {
    return JSON.parse(slice) as T;
  } catch {
    // Trailing commas are the commonest small-model slip.
    return JSON.parse(slice.replace(/,\s*([}\]])/g, '$1')) as T;
  }
}

/** Ask for JSON; one quiet retry when a small model fumbles the shape. */
export async function chatJson<T = any>(req: ChatRequest): Promise<T> {
  try {
    return extractJson<T>((await chat({ ...req, json: true })).text);
  } catch (e) {
    const fumbled = e instanceof SyntaxError || (e instanceof NightshiftError && (e.code === 'not_json' || e.code === 'empty'));
    if (!fumbled) throw e;
    const again = await chat({ ...req, json: true, temperature: 0.4, prompt: `${req.prompt}\n\nReply with the JSON object only. No prose, no code fences.` });
    return extractJson<T>(again.text);
  }
}
