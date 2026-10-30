// =====================================================================
// Recipes — ComfyUI graphs Standupify can build on its own.
//
// Each recipe says which nodes and model files it needs. We read what
// ComfyUI actually has installed and pick the best recipe that will run,
// so the user never chooses a checkpoint. Any API-format workflow can be
// dropped in as a custom recipe (FLUX 3, LTX 2.5, Wan 3… whatever ships
// next): we find its prompt, start frame, seed and output nodes ourselves.
// =====================================================================

import type { Inventory } from './client';

export type RecipeKind = 'image' | 'video';

export interface ImageParams { prompt: string; negative: string; width: number; height: number; seed: number }
export interface VideoParams { prompt: string; negative: string; image: string; width: number; height: number; seconds: number; seed: number }

type Picks = Record<string, string>;
type Graph = Record<string, { class_type: string; inputs: Record<string, any>; _meta?: { title?: string } }>;

export interface Recipe {
  id: string;
  kind: RecipeKind;
  name: string;          // what the user sees, e.g. "FLUX.1 schnell"
  speed: string;         // a rough expectation, e.g. "~5 s"
  custom?: boolean;
  detect(inv: Inventory): { ok: true; picks: Picks } | { ok: false; missing: string[] };
  build(params: ImageParams | VideoParams, picks: Picks, inv: Inventory): Graph;
}

// ---------------------------------------------------------------------
// inventory helpers
// ---------------------------------------------------------------------

const folder = (inv: Inventory, ...names: string[]) => names.flatMap(n => inv.models[n] || []);
const find = (list: string[], re: RegExp, not?: RegExp) => list.find(f => re.test(f) && !(not && not.test(f)));
const VIDEO_CKPT = /ltx|wan|hunyuan|svd|cogvideo|mochi|animate/i;

function need(inv: Inventory, nodes: string[]): string[] {
  return nodes.filter(n => !inv.nodes.has(n)).map(n => `node ${n} (update ComfyUI)`);
}

let counter = 0;
function graph() {
  const g: Graph = {};
  counter = 0;
  const add = (class_type: string, inputs: Record<string, any>, title?: string): [string, number] & { id: string } => {
    const id = String(++counter);
    g[id] = { class_type, inputs, ...(title ? { _meta: { title } } : {}) };
    const ref = [id, 0] as any;
    ref.id = id;
    return ref;
  };
  const out = (ref: { id: string }, slot: number) => [ref.id, slot];
  return { g, add, out };
}

/** Save a frame batch as a video with the best node this ComfyUI has. */
function saveVideo(inv: Inventory, add: ReturnType<typeof graph>['add'], images: any, fps: number) {
  if (inv.nodes.has('CreateVideo') && inv.nodes.has('SaveVideo')) {
    const video = add('CreateVideo', { images, fps });
    add('SaveVideo', { video, filename_prefix: 'standupify/clip', format: 'auto', codec: 'auto' });
  } else if (inv.nodes.has('VHS_VideoCombine')) {
    add('VHS_VideoCombine', { images, frame_rate: fps, loop_count: 0, filename_prefix: 'standupify/clip', format: 'video/h264-mp4', pingpong: false, save_output: true });
  } else {
    add('SaveAnimatedWEBP', { images, filename_prefix: 'standupify/clip', fps, lossless: false, quality: 85, method: 'default' });
  }
}

const emptyLatent = (inv: Inventory) => inv.nodes.has('EmptySD3LatentImage') ? 'EmptySD3LatentImage' : 'EmptyLatentImage';
const snap = (n: number, m: number) => Math.max(m, Math.round(n / m) * m);

// ---------------------------------------------------------------------
// Image recipes
// ---------------------------------------------------------------------

const fluxCheckpoint: Recipe = {
  id: 'flux-ckpt', kind: 'image', name: 'FLUX.1', speed: '~5–20 s',
  detect(inv) {
    const ckpt = find(folder(inv, 'checkpoints'), /flux/i, VIDEO_CKPT);
    const missing = need(inv, ['CheckpointLoaderSimple', 'KSampler']);
    if (!ckpt) missing.push('a FLUX checkpoint in models/checkpoints (e.g. flux1-schnell-fp8.safetensors)');
    return missing.length ? { ok: false, missing } : { ok: true, picks: { ckpt: ckpt! } };
  },
  build(p, picks, inv) {
    const { g, add, out } = graph();
    const ip = p as ImageParams;
    const schnell = /schnell/i.test(picks.ckpt);
    const ck = add('CheckpointLoaderSimple', { ckpt_name: picks.ckpt });
    let pos: any = add('CLIPTextEncode', { text: ip.prompt, clip: out(ck, 1) }, 'Positive');
    if (!schnell && inv.nodes.has('FluxGuidance')) pos = add('FluxGuidance', { conditioning: pos, guidance: 3.5 });
    const neg = add('CLIPTextEncode', { text: '', clip: out(ck, 1) }, 'Negative');
    const lat = add(emptyLatent(inv), { width: ip.width, height: ip.height, batch_size: 1 });
    const s = add('KSampler', { seed: ip.seed, steps: schnell ? 4 : 20, cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: 1, model: out(ck, 0), positive: pos, negative: neg, latent_image: lat });
    const img = add('VAEDecode', { samples: s, vae: out(ck, 2) });
    add('SaveImage', { images: img, filename_prefix: 'standupify/still' });
    return g;
  }
};

const fluxSplit: Recipe = {
  id: 'flux-split', kind: 'image', name: 'FLUX.1 · split files', speed: '~5–20 s',
  detect(inv) {
    const unet = find(folder(inv, 'diffusion_models', 'unet'), /flux/i, /kontext|fill|redux|depth|canny/i);
    const enc = folder(inv, 'text_encoders', 'clip');
    const t5 = find(enc, /t5xxl/i);
    const clipL = find(enc, /clip_l/i);
    const vae = find(folder(inv, 'vae'), /^ae\.|flux|ae\.safetensors$/i);
    const missing = need(inv, ['UNETLoader', 'DualCLIPLoader', 'VAELoader', 'KSampler']);
    if (!unet) missing.push('a FLUX model in models/diffusion_models');
    if (!t5) missing.push('t5xxl_fp8_e4m3fn.safetensors in models/text_encoders');
    if (!clipL) missing.push('clip_l.safetensors in models/text_encoders');
    if (!vae) missing.push('ae.safetensors in models/vae');
    return missing.length ? { ok: false, missing } : { ok: true, picks: { unet: unet!, t5: t5!, clipL: clipL!, vae: vae! } };
  },
  build(p, picks, inv) {
    const { g, add } = graph();
    const ip = p as ImageParams;
    const schnell = /schnell/i.test(picks.unet);
    const model = add('UNETLoader', { unet_name: picks.unet, weight_dtype: 'default' });
    const clip = add('DualCLIPLoader', { clip_name1: picks.t5, clip_name2: picks.clipL, type: 'flux' });
    const vae = add('VAELoader', { vae_name: picks.vae });
    let pos: any = add('CLIPTextEncode', { text: ip.prompt, clip }, 'Positive');
    if (!schnell && inv.nodes.has('FluxGuidance')) pos = add('FluxGuidance', { conditioning: pos, guidance: 3.5 });
    const neg = add('CLIPTextEncode', { text: '', clip }, 'Negative');
    const lat = add(emptyLatent(inv), { width: ip.width, height: ip.height, batch_size: 1 });
    const s = add('KSampler', { seed: ip.seed, steps: schnell ? 4 : 20, cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: 1, model, positive: pos, negative: neg, latent_image: lat });
    add('SaveImage', { images: add('VAEDecode', { samples: s, vae }), filename_prefix: 'standupify/still' });
    return g;
  }
};

const sdxl: Recipe = {
  id: 'sdxl', kind: 'image', name: 'SDXL', speed: '~3–15 s',
  detect(inv) {
    const ckpt = find(folder(inv, 'checkpoints'), /xl|turbo|lightning|juggernaut|realvis|pony|illustrious|dreamshaper/i, new RegExp(`${VIDEO_CKPT.source}|flux|refiner`, 'i'));
    const missing = need(inv, ['CheckpointLoaderSimple', 'KSampler']);
    if (!ckpt) missing.push('an SDXL checkpoint in models/checkpoints');
    return missing.length ? { ok: false, missing } : { ok: true, picks: { ckpt: ckpt! } };
  },
  build(p, picks) {
    const { g, add, out } = graph();
    const ip = p as ImageParams;
    const turbo = /turbo/i.test(picks.ckpt);
    const lightning = /lightning|hyper|dmd/i.test(picks.ckpt);
    const ck = add('CheckpointLoaderSimple', { ckpt_name: picks.ckpt });
    const pos = add('CLIPTextEncode', { text: ip.prompt, clip: out(ck, 1) }, 'Positive');
    const neg = add('CLIPTextEncode', { text: ip.negative, clip: out(ck, 1) }, 'Negative');
    const lat = add('EmptyLatentImage', { width: ip.width, height: ip.height, batch_size: 1 });
    const s = add('KSampler', {
      seed: ip.seed,
      steps: turbo ? 4 : lightning ? 8 : 26,
      cfg: turbo ? 1 : lightning ? 1.5 : 6,
      sampler_name: turbo ? 'euler_ancestral' : lightning ? 'euler' : 'dpmpp_2m',
      scheduler: turbo ? 'normal' : lightning ? 'sgm_uniform' : 'karras',
      denoise: 1, model: out(ck, 0), positive: pos, negative: neg, latent_image: lat
    });
    add('SaveImage', { images: add('VAEDecode', { samples: s, vae: out(ck, 2) }), filename_prefix: 'standupify/still' });
    return g;
  }
};

const anyCheckpoint: Recipe = {
  id: 'checkpoint', kind: 'image', name: 'Stable Diffusion', speed: '~3–10 s',
  detect(inv) {
    const ckpt = find(folder(inv, 'checkpoints'), /\.(safetensors|ckpt)$/i, new RegExp(`${VIDEO_CKPT.source}|flux|refiner|inpaint`, 'i'));
    const missing = need(inv, ['CheckpointLoaderSimple', 'KSampler']);
    if (!ckpt) missing.push('any image checkpoint in models/checkpoints');
    return missing.length ? { ok: false, missing } : { ok: true, picks: { ckpt: ckpt! } };
  },
  build(p, picks) {
    const { g, add, out } = graph();
    const ip = p as ImageParams;
    const ck = add('CheckpointLoaderSimple', { ckpt_name: picks.ckpt });
    const pos = add('CLIPTextEncode', { text: ip.prompt, clip: out(ck, 1) }, 'Positive');
    const neg = add('CLIPTextEncode', { text: ip.negative, clip: out(ck, 1) }, 'Negative');
    // SD1.5-class models want ~512px on the short side.
    const scale = 512 / Math.min(ip.width, ip.height);
    const lat = add('EmptyLatentImage', { width: snap(ip.width * scale, 64), height: snap(ip.height * scale, 64), batch_size: 1 });
    const s = add('KSampler', { seed: ip.seed, steps: 25, cfg: 7, sampler_name: 'dpmpp_2m', scheduler: 'karras', denoise: 1, model: out(ck, 0), positive: pos, negative: neg, latent_image: lat });
    add('SaveImage', { images: add('VAEDecode', { samples: s, vae: out(ck, 2) }), filename_prefix: 'standupify/still' });
    return g;
  }
};

// ---------------------------------------------------------------------
// Video recipes (image → video, the start frame is the bit's still)
// ---------------------------------------------------------------------

const ltxv: Recipe = {
  id: 'ltxv', kind: 'video', name: 'LTX-Video', speed: '~30–90 s',
  detect(inv) {
    const ckpt = find(folder(inv, 'checkpoints'), /ltx/i, /upscal|vae_only/i);
    const t5 = find(folder(inv, 'text_encoders', 'clip'), /t5xxl/i);
    const missing = need(inv, ['LTXVImgToVideo', 'LTXVConditioning', 'LTXVScheduler', 'SamplerCustomAdvanced', 'CFGGuider', 'RandomNoise', 'KSamplerSelect', 'CLIPLoader', 'LoadImage']);
    if (!ckpt) missing.push('an LTX-Video checkpoint in models/checkpoints (e.g. ltx-video-2b-v0.9.5.safetensors)');
    if (!t5) missing.push('a T5-XXL text encoder in models/text_encoders');
    return missing.length ? { ok: false, missing } : { ok: true, picks: { ckpt: ckpt!, t5: t5! } };
  },
  build(p, picks, inv) {
    const { g, add, out } = graph();
    const vp = p as VideoParams;
    const distilled = /distill/i.test(picks.ckpt);
    const frames = 8 * Math.max(3, Math.round((vp.seconds * 24) / 8)) + 1;   // LTX wants 8n+1
    const ck = add('CheckpointLoaderSimple', { ckpt_name: picks.ckpt });
    const clip = add('CLIPLoader', { clip_name: picks.t5, type: 'ltxv', device: 'default' });
    const pos = add('CLIPTextEncode', { text: vp.prompt, clip }, 'Positive');
    const neg = add('CLIPTextEncode', { text: vp.negative, clip }, 'Negative');
    const img = add('LoadImage', { image: vp.image });
    const i2v = add('LTXVImgToVideo', { positive: pos, negative: neg, vae: out(ck, 2), image: img, width: snap(vp.width, 32), height: snap(vp.height, 32), length: frames, batch_size: 1, strength: 1 });
    const cond = add('LTXVConditioning', { positive: out(i2v, 0), negative: out(i2v, 1), frame_rate: 24 });
    const sigmas = add('LTXVScheduler', { steps: distilled ? 8 : 30, max_shift: 2.05, base_shift: 0.95, stretch: true, terminal: 0.1, latent: out(i2v, 2) });
    const guider = add('CFGGuider', { model: out(ck, 0), positive: out(cond, 0), negative: out(cond, 1), cfg: distilled ? 1 : 3 });
    const sampled = add('SamplerCustomAdvanced', {
      noise: add('RandomNoise', { noise_seed: vp.seed }),
      guider, sampler: add('KSamplerSelect', { sampler_name: 'euler' }), sigmas, latent_image: out(i2v, 2)
    });
    saveVideo(inv, add, add('VAEDecode', { samples: sampled, vae: out(ck, 2) }), 24);
    return g;
  }
};

const wan22: Recipe = {
  id: 'wan22-5b', kind: 'video', name: 'Wan 2.2', speed: '~3–8 min',
  detect(inv) {
    const unet = find(folder(inv, 'diffusion_models', 'unet'), /wan2\.?2.*ti2v.*5b|wan2\.?2_ti2v/i);
    const enc = find(folder(inv, 'text_encoders', 'clip'), /umt5/i);
    const vae = find(folder(inv, 'vae'), /wan2\.?2.*vae/i);
    const missing = need(inv, ['UNETLoader', 'CLIPLoader', 'VAELoader', 'Wan22ImageToVideoLatent', 'ModelSamplingSD3', 'KSampler', 'LoadImage']);
    if (!unet) missing.push('wan2.2_ti2v_5B_fp16.safetensors in models/diffusion_models');
    if (!enc) missing.push('umt5_xxl_fp8_e4m3fn_scaled.safetensors in models/text_encoders');
    if (!vae) missing.push('wan2.2_vae.safetensors in models/vae');
    return missing.length ? { ok: false, missing } : { ok: true, picks: { unet: unet!, enc: enc!, vae: vae! } };
  },
  build(p, picks, inv) {
    const { g, add } = graph();
    const vp = p as VideoParams;
    const frames = 4 * Math.max(4, Math.round((vp.seconds * 24) / 4)) + 1;   // Wan wants 4n+1
    const unet = add('UNETLoader', { unet_name: picks.unet, weight_dtype: 'default' });
    const clip = add('CLIPLoader', { clip_name: picks.enc, type: 'wan', device: 'default' });
    const vae = add('VAELoader', { vae_name: picks.vae });
    const model = add('ModelSamplingSD3', { model: unet, shift: 8 });
    const pos = add('CLIPTextEncode', { text: vp.prompt, clip }, 'Positive');
    const neg = add('CLIPTextEncode', { text: vp.negative, clip }, 'Negative');
    const img = add('LoadImage', { image: vp.image });
    const lat = add('Wan22ImageToVideoLatent', { vae, width: snap(vp.width, 32), height: snap(vp.height, 32), length: frames, batch_size: 1, start_image: img });
    const s = add('KSampler', { seed: vp.seed, steps: 20, cfg: 5, sampler_name: 'uni_pc', scheduler: 'simple', denoise: 1, model, positive: pos, negative: neg, latent_image: lat });
    saveVideo(inv, add, add('VAEDecode', { samples: s, vae }), 24);
    return g;
  }
};

export const BUILTIN_RECIPES: Recipe[] = [fluxCheckpoint, fluxSplit, sdxl, anyCheckpoint, ltxv, wan22];

// ---------------------------------------------------------------------
// Custom workflows — drop in any ComfyUI "Export (API)" JSON
// ---------------------------------------------------------------------

export interface CustomWorkflow { id: string; name: string; kind: RecipeKind; graph: Graph; source: 'dropped' | 'folder' }

const VIDEO_OUT = /SaveVideo|VHS_VideoCombine|SaveAnimatedWEBP|SaveAnimatedPNG|SaveWEBM|CreateVideo/;
const IMAGE_OUT = /^(SaveImage|PreviewImage|Image Save)$/;
const TEXT_INPUTS = ['text', 'prompt', 'positive_prompt', 'text_g', 'text_l', 'string'];

export class WorkflowFormatError extends Error {}

/** Validate a dropped file and work out what it makes. Throws a friendly error. */
export function analyzeWorkflow(json: any, name: string): CustomWorkflow {
  if (json && Array.isArray(json.nodes) && Array.isArray(json.links)) {
    throw new WorkflowFormatError('That is the editor format. In ComfyUI open Workflow › Export (API) and drop that file instead.');
  }
  const graphJson: Graph = json?.prompt && typeof json.prompt === 'object' ? json.prompt : json;
  const nodes = Object.values(graphJson || {});
  if (!nodes.length || !nodes.every(n => n && typeof (n as any).class_type === 'string' && typeof (n as any).inputs === 'object')) {
    throw new WorkflowFormatError('That file is not a ComfyUI API workflow.');
  }
  const classes = nodes.map(n => n.class_type);
  const kind: RecipeKind | null = classes.some(c => VIDEO_OUT.test(c)) ? 'video' : classes.some(c => IMAGE_OUT.test(c)) ? 'image' : null;
  if (!kind) throw new WorkflowFormatError('That workflow saves nothing Standupify can show (no image or video output node).');
  if (!positiveNode(graphJson)) throw new WorkflowFormatError('Could not find a prompt in that workflow. Put {{prompt}} in its prompt box and export again.');
  return {
    id: `custom:${name.replace(/\.json$/i, '')}:${hash(JSON.stringify(graphJson))}`,
    name: name.replace(/\.json$/i, '').replace(/[_-]+/g, ' '),
    kind, graph: graphJson, source: 'dropped'
  };
}

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function textInputOf(node: any): string | null {
  return TEXT_INPUTS.find(k => typeof node.inputs?.[k] === 'string') || null;
}

/** The positive prompt node: {{prompt}} wins, then titles, then "not wired to a negative". */
function positiveNode(g: Graph): string | null {
  const ids = Object.keys(g);
  const marked = ids.find(id => Object.values(g[id].inputs || {}).some(v => typeof v === 'string' && v.includes('{{prompt}}')));
  if (marked) return marked;
  const texts = ids.filter(id => textInputOf(g[id]));
  const titled = texts.find(id => /positive|prompt/i.test(g[id]._meta?.title || '') && !/negative/i.test(g[id]._meta?.title || ''));
  if (titled) return titled;
  const negatives = new Set<string>();
  for (const n of Object.values(g)) {
    for (const [k, v] of Object.entries(n.inputs || {})) {
      if (/negative/i.test(k) && Array.isArray(v)) negatives.add(String(v[0]));
    }
  }
  return texts.find(id => !negatives.has(id) && !/negative/i.test(g[id]._meta?.title || '')) || null;
}

export function buildCustom(w: CustomWorkflow, p: ImageParams | VideoParams): Graph {
  const g: Graph = JSON.parse(JSON.stringify(w.graph));
  const video = 'image' in p ? (p as VideoParams) : null;
  const fill = (s: string) => s
    .replace(/\{\{prompt\}\}/g, p.prompt)
    .replace(/\{\{negative\}\}/g, p.negative)
    .replace(/\{\{image\}\}/g, video?.image || '');
  let templated = false;
  for (const n of Object.values(g)) {
    for (const [k, v] of Object.entries(n.inputs || {})) {
      if (typeof v === 'string' && /\{\{(prompt|negative|image)\}\}/.test(v)) { n.inputs[k] = fill(v); templated = true; }
      if ((k === 'seed' || k === 'noise_seed') && typeof v === 'number') n.inputs[k] = p.seed;
    }
  }
  if (!templated) {
    const pos = positiveNode(g);
    if (pos) n_set(g[pos], p.prompt);
  }
  if (video && !JSON.stringify(w.graph).includes('{{image}}')) {
    const load = Object.values(g).find(n => n.class_type === 'LoadImage');
    if (load) load.inputs.image = video.image;
  }
  return g;
}

function n_set(node: Graph[string], text: string) {
  const key = textInputOf(node);
  if (key) node.inputs[key] = text;
}

// ---------------------------------------------------------------------
// Choosing
// ---------------------------------------------------------------------

export interface RecipeStatus { recipe: Recipe; ok: boolean; picks?: Picks; missing: string[] }

export function customToRecipe(w: CustomWorkflow): Recipe {
  return {
    id: w.id, kind: w.kind, name: w.name, speed: 'your workflow', custom: true,
    detect: (inv) => {
      const missing = [...new Set(Object.values(w.graph).map(n => n.class_type))].filter(c => !inv.nodes.has(c)).map(c => `node ${c}`);
      return missing.length ? { ok: false, missing } : { ok: true, picks: {} };
    },
    build: (params) => buildCustom(w, params)
  };
}

export function rankRecipes(kind: RecipeKind, inv: Inventory, custom: CustomWorkflow[]): RecipeStatus[] {
  const all = [...custom.filter(c => c.kind === kind).map(customToRecipe), ...BUILTIN_RECIPES.filter(r => r.kind === kind)];
  return all.map(recipe => {
    const d = recipe.detect(inv);
    return 'missing' in d ? { recipe, ok: false, missing: d.missing } : { recipe, ok: true, picks: d.picks, missing: [] };
  });
}

/** The recipe to run: the user's pick if it is ready, else the first ready one. */
export function chooseRecipe(kind: RecipeKind, inv: Inventory, custom: CustomWorkflow[], preferredId?: string | null): RecipeStatus | null {
  const ranked = rankRecipes(kind, inv, custom);
  return ranked.find(r => r.ok && r.recipe.id === preferredId) || ranked.find(r => r.ok) || null;
}
