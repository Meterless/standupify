// =====================================================================
// ComfyUI client — queue a graph, watch it render, collect the files.
//
//   POST /prompt            {prompt, client_id} → {prompt_id}
//   WS   /ws?clientId=…     progress · executing · errors · binary previews
//   GET  /history/{id}      outputs once finished (polled if the socket drops)
//   GET  /view?filename=…   the bytes
//   POST /upload/image      start frames for image-to-video
//   POST /interrupt         cancel
//
// Through the bridge everything is same-origin, so ComfyUI needs no CORS
// flags and its origin check never trips.
// =====================================================================

import { comfyBase, comfyWsUrl, getEngines } from '../engines';
import { bus, mediaBlob } from '../bus';

export class ComfyError extends Error {
  code: string;
  constructor(message: string, code = 'comfy_error') { super(message); this.name = 'ComfyError'; this.code = code; }
}

export interface ComfyFile { filename: string; subfolder: string; type: string; kind: 'image' | 'video' | 'audio' | 'other' }

export interface ComfyProgress {
  phase: 'queued' | 'loading' | 'sampling' | 'decoding' | 'saving' | 'done';
  value: number;          // 0..1 for the current sampler
  overall: number;        // 0..1 across the graph
  queueAhead?: number;
  label: string;
}

export interface RunOptions {
  onProgress?: (p: ComfyProgress) => void;
  onPreview?: (objectUrl: string) => void;
  signal?: AbortSignal;
}

const VIDEO_EXT = /\.(mp4|webm|mov|mkv|gif|webp)$/i;
const AUDIO_EXT = /\.(wav|mp3|flac|ogg|m4a)$/i;

function kindOf(name: string, key: string, animated: boolean): ComfyFile['kind'] {
  if (AUDIO_EXT.test(name) || key === 'audio') return 'audio';
  if (/\.(mp4|webm|mov|mkv)$/i.test(name) || key === 'videos' || key === 'gifs') return 'video';
  if (/\.(gif|webp)$/i.test(name) && animated) return 'video';
  if (/\.(png|jpe?g|webp|gif)$/i.test(name)) return 'image';
  return VIDEO_EXT.test(name) ? 'video' : 'other';
}

function phaseFor(classType: string): ComfyProgress['phase'] {
  if (/loader|load/i.test(classType)) return 'loading';
  if (/sampler|guider/i.test(classType)) return 'sampling';
  if (/decode/i.test(classType)) return 'decoding';
  if (/save|video|combine|preview/i.test(classType)) return 'saving';
  return 'loading';
}

const PHASE_LABEL: Record<ComfyProgress['phase'], string> = {
  queued: 'Waiting in line', loading: 'Loading models', sampling: 'Rendering', decoding: 'Developing', saving: 'Saving', done: 'Done'
};

function describeNodeErrors(body: any, graph: Record<string, any>): string {
  const parts: string[] = [];
  const nodeErrors = body?.node_errors || {};
  for (const [id, ne] of Object.entries<any>(nodeErrors)) {
    const cls = ne?.class_type || graph[id]?.class_type || `node ${id}`;
    for (const err of ne?.errors || []) {
      const input = err?.extra_info?.input_name ? ` › ${err.extra_info.input_name}` : '';
      parts.push(`${cls}${input}: ${err?.details || err?.message}`);
    }
  }
  if (parts.length) return parts.slice(0, 3).join(' · ');
  return body?.error?.message || body?.error || 'ComfyUI rejected the workflow.';
}

export function missingModelHint(message: string): string | null {
  const m = message.match(/value not in list: (\w+): '([^']+)'/i);
  return m ? `ComfyUI doesn't have ${m[2]}. Put it in the models folder (Engines lists exactly where).` : null;
}

async function comfyFetch(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(`${comfyBase()}${path}`, init);
  } catch {
    throw new ComfyError('ComfyUI is not reachable. Start it from Engines.', 'comfy_unreachable');
  }
}

/** Queue a graph and resolve with its output files once it has finished. */
export async function runGraph(graph: Record<string, any>, opts: RunOptions = {}): Promise<{ promptId: string; files: ComfyFile[] }> {
  if (getEngines().comfy.state !== 'online') throw new ComfyError('ComfyUI is not running. Start it from Engines.', 'comfy_offline');
  const clientId = crypto.randomUUID();
  const totalNodes = Object.keys(graph).length;
  const done = new Set<string>();
  let lastPreview: string | null = null;
  let ws: WebSocket | null = null;
  let finished = false;
  let errorMessage = '';

  const report = (p: Partial<ComfyProgress> & { phase: ComfyProgress['phase'] }) => {
    const overall = Math.min(0.99, (done.size + (p.value ?? 0)) / Math.max(totalNodes, 1));
    opts.onProgress?.({ value: 0, overall, label: PHASE_LABEL[p.phase], ...p });
  };

  // Socket first, so no early progress frame is missed.
  let promptId = '';
  const socketDone = new Promise<'ok' | 'error' | 'dropped'>((resolve) => {
    try { ws = new WebSocket(comfyWsUrl(clientId)); } catch { resolve('dropped'); return; }
    ws.binaryType = 'arraybuffer';
    let currentNode: string | null = null;
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') {
        // Binary preview: [u32 event][u32 image type][bytes]; event 4 adds a JSON metadata block.
        const buf = ev.data as ArrayBuffer;
        const view = new DataView(buf);
        const event = view.getUint32(0);
        let offset = 8;
        let mime = view.getUint32(4) === 2 ? 'image/png' : 'image/jpeg';
        if (event === 4) {
          const metaLen = view.getUint32(4);
          try {
            const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, metaLen)));
            if (meta?.prompt_id && promptId && meta.prompt_id !== promptId) return;
            if (meta?.image_type) mime = meta.image_type;
          } catch { /* ignore */ }
          offset = 8 + metaLen;
        } else if (event !== 1) return;
        if (lastPreview) URL.revokeObjectURL(lastPreview);
        lastPreview = URL.createObjectURL(new Blob([buf.slice(offset)], { type: mime }));
        opts.onPreview?.(lastPreview);
        return;
      }
      let msg: any;
      try { msg = JSON.parse(ev.data); } catch { return; }
      const d = msg.data || {};
      if (d.prompt_id && promptId && d.prompt_id !== promptId) return;
      switch (msg.type) {
        case 'status': {
          const ahead = d.status?.exec_info?.queue_remaining;
          if (!currentNode && typeof ahead === 'number' && ahead > 1) report({ phase: 'queued', queueAhead: ahead - 1 });
          break;
        }
        case 'execution_cached': (d.nodes || []).forEach((n: string) => done.add(String(n))); break;
        case 'executing':
          if (currentNode) done.add(currentNode);
          if (d.node == null) { if (promptId && (!d.prompt_id || d.prompt_id === promptId)) resolve('ok'); return; }
          currentNode = String(d.node);
          report({ phase: phaseFor(graph[currentNode]?.class_type || '') });
          break;
        case 'progress': {
          const value = d.max ? d.value / d.max : 0;
          report({ phase: phaseFor(graph[String(d.node)]?.class_type || 'sampler'), value });
          break;
        }
        case 'execution_success': resolve('ok'); break;
        case 'execution_error':
          errorMessage = `${d.node_type || 'A node'} failed: ${d.exception_message || 'unknown error'}`;
          resolve('error');
          break;
        case 'execution_interrupted': errorMessage = 'Render cancelled.'; resolve('error'); break;
      }
    };
    ws.onerror = () => resolve('dropped');
    ws.onclose = () => { if (!finished) resolve('dropped'); };
  });

  // Give the socket a moment to open; the prompt still runs if it never does.
  await Promise.race([
    new Promise<void>(r => { if (ws) { (ws as WebSocket).addEventListener('open', () => r(), { once: true }); } else r(); }),
    new Promise<void>(r => setTimeout(r, 1500))
  ]);

  const resp = await comfyFetch('/prompt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: graph, client_id: clientId })
  });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok || body?.error) {
    (ws as WebSocket | null)?.close();
    const message = describeNodeErrors(body, graph);
    throw new ComfyError(missingModelHint(message) || message, 'comfy_rejected');
  }
  promptId = body.prompt_id;
  report({ phase: 'queued', queueAhead: body.number ?? undefined });

  const onAbort = () => {
    void comfyFetch('/queue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ delete: [promptId] }) });
    void comfyFetch('/interrupt', { method: 'POST' });
  };
  opts.signal?.addEventListener('abort', onAbort, { once: true });

  try {
    // Wait on the socket, but always confirm against /history — it is the record.
    const outcome = await Promise.race([socketDone, waitHistory(promptId, opts.signal).then(() => 'ok' as const)]);
    if (outcome === 'error') throw new ComfyError(missingModelHint(errorMessage) || errorMessage, 'comfy_failed');
    const entry = await waitHistory(promptId, opts.signal);
    const status = entry?.status;
    if (status?.status_str === 'error') {
      const err = (status.messages || []).find((m: any) => m?.[0] === 'execution_error')?.[1];
      const msg = err ? `${err.node_type} failed: ${err.exception_message}` : 'ComfyUI reported an error.';
      throw new ComfyError(missingModelHint(msg) || msg, 'comfy_failed');
    }
    const files: ComfyFile[] = [];
    for (const out of Object.values<any>(entry?.outputs || {})) {
      const animated = Array.isArray(out?.animated) && out.animated.some(Boolean);
      for (const [key, list] of Object.entries<any>(out || {})) {
        if (!Array.isArray(list)) continue;
        for (const f of list) {
          if (f && typeof f.filename === 'string') {
            files.push({ filename: f.filename, subfolder: f.subfolder || '', type: f.type || 'output', kind: kindOf(f.filename, key, animated) });
          }
        }
      }
    }
    opts.onProgress?.({ phase: 'done', value: 1, overall: 1, label: PHASE_LABEL.done });
    return { promptId, files };
  } finally {
    finished = true;
    opts.signal?.removeEventListener('abort', onAbort);
    (ws as WebSocket | null)?.close();
    if (lastPreview) URL.revokeObjectURL(lastPreview);
  }
}

async function waitHistory(promptId: string, signal?: AbortSignal): Promise<any> {
  for (let wait = 1200; ; wait = Math.min(4000, wait * 1.2)) {
    if (signal?.aborted) throw new ComfyError('Render cancelled.', 'cancelled');
    const resp = await comfyFetch(`/history/${encodeURIComponent(promptId)}`).catch(() => null);
    if (resp?.ok) {
      const body = await resp.json().catch(() => ({}));
      const entry = body?.[promptId];
      if (entry && (entry.status?.completed || entry.status?.status_str === 'error' || Object.keys(entry.outputs || {}).length)) return entry;
    }
    await new Promise(r => setTimeout(r, wait));
  }
}

export async function fetchFile(f: ComfyFile): Promise<Blob> {
  const q = new URLSearchParams({ filename: f.filename, subfolder: f.subfolder, type: f.type });
  const resp = await comfyFetch(`/view?${q}`);
  if (!resp.ok) throw new ComfyError(`ComfyUI could not serve ${f.filename}.`, 'comfy_view');
  return resp.blob();
}

/** Upload a start frame (data: URL or Blob); returns the name LoadImage expects. */
export async function uploadImage(image: string | Blob, name = `standupify_${Date.now()}.png`): Promise<string> {
  const blob = typeof image === 'string' ? await mediaBlob(image) : image;
  const form = new FormData();
  form.append('image', blob, name);
  form.append('overwrite', 'true');
  form.append('type', 'input');
  const resp = await comfyFetch('/upload/image', { method: 'POST', body: form });
  const body = await resp.json().catch(() => null);
  if (!resp.ok || !body?.name) throw new ComfyError('ComfyUI would not accept the start frame.', 'comfy_upload');
  return body.subfolder ? `${body.subfolder}/${body.name}` : body.name;
}

// ---------------------------------------------------------------------
// Inventory — what this ComfyUI can actually run
// ---------------------------------------------------------------------

export interface Inventory { stamp: number; nodes: Set<string>; models: Record<string, string[]> }

let inv: Inventory | null = null;
const MODEL_FOLDERS = ['checkpoints', 'diffusion_models', 'unet', 'text_encoders', 'clip', 'vae', 'loras', 'clip_vision', 'upscale_models'];

export async function getInventory(force = false): Promise<Inventory> {
  const stamp = getEngines().comfy.inventoryStamp;
  if (!force && inv && inv.stamp === stamp) return inv;
  let raw: { stamp: number; nodes: string[]; models: Record<string, string[]> } = { stamp, nodes: [], models: {} };
  if (getEngines().bridge) {
    const r = await fetch(`./api/comfy-inventory${force ? '?refresh=1' : ''}`).catch(() => null);
    if (r?.ok) raw = await r.json();
  } else if (getEngines().comfy.state === 'online') {
    const r = await comfyFetch('/object_info').catch(() => null);
    const info = r?.ok ? await r.json() : {};
    const list = (node: string, input: string): string[] => {
      const spec = info?.[node]?.input?.required?.[input]?.[0];
      return Array.isArray(spec) ? spec : [];
    };
    const models: Record<string, string[]> = {
      checkpoints: list('CheckpointLoaderSimple', 'ckpt_name'),
      diffusion_models: list('UNETLoader', 'unet_name'),
      text_encoders: list('CLIPLoader', 'clip_name'),
      vae: list('VAELoader', 'vae_name'),
      loras: list('LoraLoader', 'lora_name'),
      upscale_models: list('UpscaleModelLoader', 'model_name')
    };
    // Newer ComfyUI lists every model folder directly (the Station has no bridge to ask).
    const folders = await comfyFetch('/models').then(x => (x.ok ? x.json() : [])).catch(() => []);
    for (const f of (Array.isArray(folders) ? folders : []).filter((x: string) => MODEL_FOLDERS.includes(x))) {
      const files = await comfyFetch(`/models/${f}`).then(x => (x.ok ? x.json() : null)).catch(() => null);
      if (Array.isArray(files) && files.length) models[f] = files;
    }
    raw = { stamp, nodes: Object.keys(info), models };
  }
  inv = { stamp: raw.stamp || stamp, nodes: new Set(raw.nodes), models: raw.models || {} };
  return inv;
}

bus.addEventListener('standupify:comfy-changed', () => { inv = null; });
