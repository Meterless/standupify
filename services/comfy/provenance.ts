// =====================================================================
// Provenance — read the ComfyUI graph that made a file, from the file.
//
// ComfyUI writes the API-format prompt into every PNG (tEXt/iTXt chunk)
// and every SaveVideo MP4 (a "prompt" metadata tag). So a still or a clip
// can say which models, seed, steps and nodes made it without trusting
// anything Standupify recorded about it. Pure: no fetch, no fs.
// =====================================================================

export interface GraphNode { class_type: string; inputs: Record<string, any>; _meta?: { title?: string } }
export type ComfyGraph = Record<string, GraphNode>;

export interface ProvenanceStep { id: string; type: string; detail: string }
export interface ProvenanceModel { role: string; file: string; label: string }

export interface ProvenanceSummary {
  kind: 'video' | 'still' | 'unknown';
  family: string;                  // "LTX-Video 2B", "FLUX.1 schnell", "Wan 2.2 5B"…
  models: ProvenanceModel[];
  width: number | null;
  height: number | null;
  frames: number | null;
  fps: number | null;
  steps: number | null;
  cfg: number | null;
  seed: number | null;
  sampler: string | null;
  prompt: string;
  negative: string;
  startImage: string | null;       // LoadImage input for image-to-video
  chain: ProvenanceStep[];         // nodes in execution order
  nodeCount: number;
}

const isGraph = (o: any): o is ComfyGraph =>
  !!o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).length > 1 &&
  Object.values(o).every((n: any) => n && typeof n === 'object' && typeof n.class_type === 'string');

/** Index of the brace that closes the object opening at `s[start]`, string-aware. */
function closeOf(s: string, start: number): number {
  let depth = 0, inStr = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (ch === '\\') i++;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return i;
  }
  return -1;
}

const MARK = [0x22, 0x63, 0x6c, 0x61, 0x73, 0x73, 0x5f, 0x74, 0x79, 0x70, 0x65, 0x22];   // "class_type"

function indexOfMark(bytes: Uint8Array, from: number): number {
  outer: for (let i = from; i <= bytes.length - MARK.length; i++) {
    for (let j = 0; j < MARK.length; j++) if (bytes[i + j] !== MARK[j]) continue outer;
    return i;
  }
  return -1;
}

/** Find the embedded API-format graph in a PNG or MP4. Null when there is none. */
export function extractGraph(bytes: Uint8Array): ComfyGraph | null {
  const dec = new TextDecoder('utf-8');
  for (let at = indexOfMark(bytes, 0), tries = 0; at !== -1 && tries < 8; at = indexOfMark(bytes, at + MARK.length), tries++) {
    const lo = Math.max(0, at - 4096);
    const s = dec.decode(bytes.subarray(lo, Math.min(bytes.length, at + 600_000)));
    const local = s.indexOf('"class_type"');
    // Walk outward: the nearest brace is a node, an outer one is the graph.
    for (let b = s.lastIndexOf('{', local); b !== -1 && local - b < 4096; b = s.lastIndexOf('{', b - 1)) {
      const end = closeOf(s, b);
      if (end === -1) continue;
      try {
        const o = JSON.parse(s.slice(b, end + 1));
        if (isGraph(o)) return o;
      } catch { /* not a JSON object boundary */ }
      if (b === 0) break;
    }
  }
  return null;
}

// ---------------------------------------------------------------------
// summary
// ---------------------------------------------------------------------

const MODEL_INPUTS: Record<string, string> = {
  ckpt_name: 'checkpoint', unet_name: 'diffusion model', clip_name: 'text encoder', clip_name1: 'text encoder',
  clip_name2: 'text encoder', vae_name: 'VAE', model_name: 'model', lora_name: 'LoRA', ckpt: 'model',
  upscale_model: 'upscaler', control_net_name: 'ControlNet'
};

export function modelLabel(file: string): string {
  const f = file.toLowerCase();
  if (/vae/.test(f) || f === 'ae.safetensors') return /wan/.test(f) ? 'Wan VAE' : /ltx/.test(f) ? 'LTX VAE' : f === 'ae.safetensors' ? 'FLUX VAE' : 'VAE';
  if (/ltx-?video|ltxv/.test(f)) return `LTX-Video${/2b/.test(f) ? ' 2B' : /13b/.test(f) ? ' 13B' : ''}${(/v?(\d+\.\d+\.\d+)/.exec(f) || [])[1] ? ` v${(/v?(\d+\.\d+\.\d+)/.exec(f) || [])[1]}` : ''}`;
  if (/wan2\.2/.test(f)) return `Wan 2.2${/5b/.test(f) ? ' 5B' : /14b/.test(f) ? ' 14B' : ''}`;
  if (/wan2\.1/.test(f)) return 'Wan 2.1';
  if (/kontext/.test(f)) return 'FLUX.1 Kontext dev';
  if (/flux1?-?schnell/.test(f)) return 'FLUX.1 schnell';
  if (/flux1?-?dev/.test(f)) return 'FLUX.1 dev';
  if (/flux/.test(f)) return 'FLUX';
  if (/sd_xl_turbo|sdxl-turbo/.test(f)) return 'SDXL Turbo';
  if (/sd_xl|sdxl/.test(f)) return 'SDXL';
  if (/t5xxl|umt5/.test(f)) return /umt5/.test(f) ? 'UMT5-XXL' : 'T5-XXL';
  if (/clip_l/.test(f)) return 'CLIP-L';
  if (/realesrgan|esrgan/.test(f)) return 'Real-ESRGAN x4';
  if (/rife/.test(f)) return 'RIFE';
  if (/^ae\.|_vae|vae/.test(f)) return 'VAE';
  return file.replace(/\.(safetensors|ckpt|pth|gguf)$/i, '');
}

/** Node ids in dependency order (inputs first). */
function order(g: ComfyGraph): string[] {
  const seen = new Set<string>(), out: string[] = [];
  const visit = (id: string, path: Set<string>) => {
    if (seen.has(id) || path.has(id) || !g[id]) return;
    path.add(id);
    for (const v of Object.values(g[id].inputs || {})) {
      if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && g[v[0]]) visit(v[0], path);
    }
    path.delete(id);
    seen.add(id);
    out.push(id);
  };
  for (const id of Object.keys(g).sort((a, b) => Number(a) - Number(b) || a.localeCompare(b))) visit(id, new Set());
  return out;
}

const num = (v: any) => (typeof v === 'number' && isFinite(v) ? v : null);
const short = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function detail(n: GraphNode): string {
  const i = n.inputs || {};
  const files = Object.keys(MODEL_INPUTS).filter(k => typeof i[k] === 'string').map(k => modelLabel(i[k]));
  if (files.length) return files.join(' + ');
  if (typeof i.text === 'string') return `“${short(i.text, 48)}”`;
  if (typeof i.image === 'string') return short(i.image, 40);
  const bits: string[] = [];
  if (num(i.width) && num(i.height)) bits.push(`${i.width}×${i.height}`);
  if (num(i.length)) bits.push(`${i.length} frames`);
  if (num(i.steps)) bits.push(`${i.steps} steps`);
  if (num(i.cfg)) bits.push(`cfg ${i.cfg}`);
  if (typeof i.sampler_name === 'string') bits.push(i.sampler_name);
  if (num(i.noise_seed) ?? num(i.seed)) bits.push(`seed ${i.noise_seed ?? i.seed}`);
  if (num(i.fps) || num(i.frame_rate)) bits.push(`${i.fps ?? i.frame_rate} fps`);
  if (typeof i.filename_prefix === 'string') bits.push(i.filename_prefix);
  return bits.join(' · ');
}

export function summarizeGraph(g: ComfyGraph): ProvenanceSummary {
  const ids = order(g);
  const nodes = ids.map(id => g[id]);
  const all = (re: RegExp) => nodes.filter(n => re.test(n.class_type));
  const first = (key: string) => {
    for (const n of nodes) { const v = n.inputs?.[key]; if (v !== undefined && !Array.isArray(v)) return v; }
    return null;
  };

  const models: ProvenanceModel[] = [];
  for (const n of nodes) {
    for (const [k, role] of Object.entries(MODEL_INPUTS)) {
      const f = n.inputs?.[k];
      if (typeof f === 'string' && !models.some(m => m.file === f)) models.push({ role, file: f, label: modelLabel(f) });
    }
  }
  const generator = models.find(m => /checkpoint|diffusion model|^model$/.test(m.role)) || models[0];
  const isVideo = nodes.some(n => /video|LTXV|Wan|ImageToVideo|SaveAnimated|VHS_/i.test(n.class_type)) ||
    !!(generator && /LTX|Wan/.test(generator.label));

  // Positive/negative prompt: follow the sampler or guider's wiring when we can.
  const textOf = (ref: any, depth = 0): string => {
    if (!Array.isArray(ref) || depth > 6) return '';
    const n = g[ref[0]];
    if (!n) return '';
    if (typeof n.inputs?.text === 'string') return n.inputs.text;
    if (typeof n.inputs?.text_g === 'string') return n.inputs.text_g;
    const key = ref[1] === 1 ? 'negative' : 'positive';
    return textOf(n.inputs?.[key] ?? n.inputs?.positive ?? n.inputs?.conditioning, depth + 1);
  };
  const consumer = nodes.find(n => n.inputs?.positive && n.inputs?.negative);
  let prompt = consumer ? textOf(consumer.inputs.positive) : '';
  let negative = consumer ? textOf(consumer.inputs.negative) : '';
  if (!prompt) {
    const texts = all(/CLIPTextEncode/).map(n => String(n.inputs?.text || '')).filter(Boolean);
    prompt = texts[0] || '';
    negative = negative || texts[1] || '';
  }

  const latent = nodes.find(n => num(n.inputs?.width) && num(n.inputs?.height));
  const load = all(/^LoadImage/)[0];
  return {
    kind: isVideo ? 'video' : nodes.some(n => /SaveImage|PreviewImage/.test(n.class_type)) ? 'still' : 'unknown',
    family: generator?.label || 'ComfyUI',
    models,
    width: num(latent?.inputs.width),
    height: num(latent?.inputs.height),
    frames: isVideo ? num(first('length')) ?? num(first('frame_count')) ?? num(first('num_frames')) : null,
    fps: num(first('fps')) ?? num(first('frame_rate')),
    steps: num(first('steps')),
    cfg: num(first('cfg')),
    seed: num(first('noise_seed')) ?? num(first('seed')),
    sampler: typeof first('sampler_name') === 'string' ? first('sampler_name') : null,
    prompt,
    negative,
    startImage: load && typeof load.inputs?.image === 'string' ? load.inputs.image : null,
    chain: ids.map(id => ({ id, type: g[id].class_type, detail: detail(g[id]) })),
    nodeCount: ids.length
  };
}
