// =====================================================================
// Consistency — the ComfyUI graphs that keep one comedian, one stage and
// one grade identical from the first shot of a special to the last.
//
// Every Original is shot from locked camera plates: a master frame is
// rendered once, and every other camera is derived FROM it, never from
// text alone. We climb the best rung this ComfyUI can run:
//
//   reference   your own image workflow with {{image}} / LoadImage
//               (IPAdapter, PuLID, ACE++, Kontext Pro… whatever you built)
//   kontext     FLUX.1 Kontext edits the master: same face, same suit,
//               same lights, new angle
//   img2img     punch-in crop of the master, re-detailed at low denoise
//               with the installed image model (works on the starter pack)
//   text        same seed + the same production bible, nothing more
//
// Finishing passes are added when their pieces are installed: a 4x
// upscale model on the key art, RIFE frame interpolation on every clip.
// All of it is plain core ComfyUI nodes unless noted, and every graph is
// exported to workflows/examples so you can open it in ComfyUI.
// =====================================================================

import type { Inventory } from './client';
import { buildCustom, chooseRecipe, type CustomWorkflow, type RecipeStatus, type ImageParams, type VideoParams } from './recipes';

type Node = { class_type: string; inputs: Record<string, any>; _meta?: { title?: string } };
type Graph = Record<string, Node>;

export type Rung = 'reference' | 'kontext' | 'img2img' | 'text';

export interface PlateEngine {
  rung: Rung;
  name: string;                       // what the UI shows, e.g. "FLUX.1 Kontext"
  base: RecipeStatus | null;          // the image recipe underneath (img2img / text)
  picks?: Record<string, string>;     // kontext model files
  custom?: CustomWorkflow;            // reference: the user's workflow
}

/** A region of the master, as fractions of its width and height. */
export interface Crop { x: number; y: number; w: number; h: number }

export interface PlateParams {
  prompt: string;                     // the full shot description
  negative: string;
  width: number;
  height: number;
  seed: number;
  reference?: string;                 // uploaded master frame (LoadImage name)
  refSize?: { width: number; height: number };   // its pixel size, for crops
  crop?: Crop;                        // punch in before re-detailing
  denoise?: number;                   // img2img strength
  edit?: string;                      // kontext / reference instruction
}

const folder = (inv: Inventory, ...names: string[]) => names.flatMap(n => inv.models[n] || []);
const find = (list: string[], re: RegExp, not?: RegExp) => list.find(f => re.test(f) && !(not && not.test(f)));
const hasAll = (inv: Inventory, nodes: string[]) => nodes.every(n => inv.nodes.has(n));
const snap = (n: number, m: number) => Math.max(m, Math.round(n / m) * m);

function builder(start: Graph = {}) {
  const g: Graph = JSON.parse(JSON.stringify(start));
  let next = Object.keys(g).reduce((m, k) => Math.max(m, Number(k) || 0), 0);
  const add = (class_type: string, inputs: Record<string, any>, title?: string): [string, number] => {
    const id = String(++next);
    g[id] = { class_type, inputs, ...(title ? { _meta: { title } } : {}) };
    return [id, 0];
  };
  return { g, add };
}

// ---------------------------------------------------------------------
// detection
// ---------------------------------------------------------------------

const KONTEXT_NODES = ['UNETLoader', 'DualCLIPLoader', 'VAELoader', 'LoadImage', 'FluxKontextImageScale', 'VAEEncode', 'ReferenceLatent', 'FluxGuidance', 'ConditioningZeroOut', 'KSampler', 'VAEDecode', 'SaveImage'];
const IMG2IMG_NODES = ['LoadImage', 'ImageCrop', 'ImageScale', 'VAEEncode'];

export function kontextPicks(inv: Inventory): { ok: true; picks: Record<string, string> } | { ok: false; missing: string[] } {
  const unet = find(folder(inv, 'diffusion_models', 'unet'), /kontext/i);
  const enc = folder(inv, 'text_encoders', 'clip');
  const t5 = find(enc, /t5xxl/i);
  const clipL = find(enc, /clip_l/i);
  const vae = find(folder(inv, 'vae'), /^ae\.|flux|ae\.safetensors$/i);
  const missing = KONTEXT_NODES.filter(n => !inv.nodes.has(n)).map(n => `node ${n} (update ComfyUI)`);
  if (!unet) missing.push('flux1-dev-kontext_fp8_scaled.safetensors in models/diffusion_models (npm run setup:comfy -- --pack originals)');
  if (!t5) missing.push('t5xxl_fp8_e4m3fn.safetensors in models/text_encoders');
  if (!clipL) missing.push('clip_l.safetensors in models/text_encoders');
  if (!vae) missing.push('ae.safetensors in models/vae');
  return missing.length ? { ok: false, missing } : { ok: true, picks: { unet: unet!, t5: t5!, clipL: clipL!, vae: vae! } };
}

/** A dropped/folder image workflow that takes a picture in: a reference recipe. */
export function isReferenceWorkflow(w: CustomWorkflow): boolean {
  if (w.kind !== 'image') return false;
  return JSON.stringify(w.graph).includes('{{image}}') || Object.values(w.graph).some(n => n.class_type === 'LoadImage');
}

/** Every rung this ComfyUI can climb, best first. The last one always exists if any image model does. */
export function plateLadder(inv: Inventory, custom: CustomWorkflow[], preferredImage?: string | null): PlateEngine[] {
  const out: PlateEngine[] = [];
  const base = chooseRecipe('image', inv, custom.filter(c => !isReferenceWorkflow(c)), preferredImage);
  for (const w of custom.filter(isReferenceWorkflow)) {
    const missing = [...new Set(Object.values(w.graph).map(n => n.class_type))].filter(c => !inv.nodes.has(c));
    if (!missing.length) out.push({ rung: 'reference', name: w.name, base, custom: w });
  }
  const k = kontextPicks(inv);
  if (k.ok) out.push({ rung: 'kontext', name: 'FLUX.1 Kontext', base, picks: k.picks });
  if (base && hasAll(inv, IMG2IMG_NODES) && base.recipe.kind === 'image' && !base.recipe.custom) {
    out.push({ rung: 'img2img', name: `${base.recipe.name} · punch-in`, base });
  }
  if (base) out.push({ rung: 'text', name: base.recipe.name, base });
  return out;
}

/** Why the top rung is missing, in plain words — for the Originals rig card. */
export function ladderAdvice(inv: Inventory): string | null {
  const k = kontextPicks(inv);
  return 'missing' in k ? `Add FLUX.1 Kontext for face-locked angles: ${k.missing[0]}` : null;
}

// ---------------------------------------------------------------------
// plate graphs
// ---------------------------------------------------------------------

/** The graph for one camera plate on a given rung. */
export function buildPlateGraph(engine: PlateEngine, p: PlateParams, inv: Inventory): Graph {
  const text: ImageParams = { prompt: p.prompt, negative: p.negative, width: p.width, height: p.height, seed: p.seed };
  if (!p.reference || engine.rung === 'text') {
    if (!engine.base) throw new Error('No image recipe is installed.');
    return engine.base.recipe.build(text, engine.base.picks || {}, inv);
  }
  if (engine.rung === 'reference' && engine.custom) {
    const vp: VideoParams = { ...text, prompt: p.edit ? `${p.edit} ${p.prompt}` : p.prompt, image: p.reference, seconds: 0 };
    return buildCustom(engine.custom, vp);
  }
  if (engine.rung === 'kontext' && engine.picks) return kontextGraph(engine.picks, p);
  if (!engine.base) throw new Error('No image recipe is installed.');
  return toImg2Img(engine.base.recipe.build(text, engine.base.picks || {}, inv), p);
}

/** Crop (optional) then scale the reference to the plate size. Returns the image ref. */
function framed(add: ReturnType<typeof builder>['add'], p: PlateParams): [string, number] {
  let img = add('LoadImage', { image: p.reference }, 'Master plate');
  if (p.crop && p.refSize) {
    const W = p.refSize.width, H = p.refSize.height;
    img = add('ImageCrop', {
      image: img,
      width: snap(p.crop.w * W, 8), height: snap(p.crop.h * H, 8),
      x: Math.max(0, Math.round(p.crop.x * W)), y: Math.max(0, Math.round(p.crop.y * H))
    }, 'Punch-in');
  }
  return add('ImageScale', { image: img, upscale_method: 'lanczos', width: p.width, height: p.height, crop: 'center' });
}

/**
 * FLUX.1 Kontext, the official template shape: the reference rides in as a
 * ReferenceLatent on the conditioning, guidance 2.5, negative zeroed out.
 */
export function kontextGraph(picks: Record<string, string>, p: PlateParams): Graph {
  const { g, add } = builder();
  const model = add('UNETLoader', { unet_name: picks.unet, weight_dtype: 'default' });
  const clip = add('DualCLIPLoader', { clip_name1: picks.t5, clip_name2: picks.clipL, type: 'flux' });
  const vae = add('VAELoader', { vae_name: picks.vae });
  const image = add('FluxKontextImageScale', { image: framed(add, p) });
  const latent = add('VAEEncode', { pixels: image, vae });
  const instruction = p.edit
    ? `${p.edit} Keep the exact same person, face, hairstyle, outfit, microphone, stage, lighting and color grade.`
    : 'Restore crisp photographic detail at this framing. Keep the exact same person, face, outfit, pose, stage and lighting.';
  const enc = add('CLIPTextEncode', { text: instruction, clip }, 'Positive');
  const ref = add('ReferenceLatent', { conditioning: enc, latent });
  const pos = add('FluxGuidance', { conditioning: ref, guidance: 2.5 });
  const neg = add('ConditioningZeroOut', { conditioning: enc }, 'Negative');
  const s = add('KSampler', { seed: p.seed, steps: 20, cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: 1, model, positive: pos, negative: neg, latent_image: latent });
  add('SaveImage', { images: add('VAEDecode', { samples: s, vae }), filename_prefix: 'standupify/originals/plate' });
  return g;
}

/**
 * Turn any built-in text-to-image graph into a punch-in: swap its empty
 * latent for the (cropped) master, encoded with the recipe's own VAE, and
 * sample at low denoise so identity and grade carry over.
 */
export function toImg2Img(graph: Graph, p: PlateParams): Graph {
  const { g, add } = builder(graph);
  const latentId = Object.keys(g).find(id => /^Empty(SD3)?LatentImage$/.test(g[id].class_type));
  const samplerId = Object.keys(g).find(id => g[id].class_type === 'KSampler');
  const decode = Object.values(g).find(n => n.class_type === 'VAEDecode');
  if (!latentId || !samplerId || !decode) return graph;
  const vae = decode.inputs.vae;
  const w = g[latentId].inputs.width ?? p.width;
  const h = g[latentId].inputs.height ?? p.height;
  const pixels = framed(add, { ...p, width: w, height: h });
  const latent = add('VAEEncode', { pixels, vae });
  delete g[latentId];
  const denoise = Math.min(0.95, Math.max(0.2, p.denoise ?? 0.42));
  const ks = g[samplerId].inputs;
  ks.latent_image = latent;
  ks.denoise = denoise;
  // Few-step models (schnell, turbo) need enough steps left after the denoise cut.
  if (typeof ks.steps === 'number' && ks.steps < 12) ks.steps = Math.min(16, Math.ceil(ks.steps / denoise));
  for (const n of Object.values(g)) if (n.class_type === 'SaveImage') n.inputs.filename_prefix = 'standupify/originals/plate';
  return g;
}

// ---------------------------------------------------------------------
// finishing passes
// ---------------------------------------------------------------------

export function upscaleModel(inv: Inventory): string | null {
  return find(folder(inv, 'upscale_models'), /x4|x2|esrgan|ultrasharp|upscal|siax|remacri|nmkd/i) || null;
}

const RIFE_NODE = 'RIFE VFI';
export const canInterpolate = (inv: Inventory) => inv.nodes.has(RIFE_NODE);

/** What finishing this ComfyUI can add: for the rig card. */
export function finishingPasses(inv: Inventory): string[] {
  const out: string[] = [];
  if (upscaleModel(inv) && hasAll(inv, ['UpscaleModelLoader', 'ImageUpscaleWithModel', 'ImageScale'])) out.push('4x key-art upscale');
  if (canInterpolate(inv)) out.push('RIFE 2x frame interpolation');
  return out;
}

/** Insert a model upscale (then a resize to `target`) before every SaveImage. */
export function withUpscale(graph: Graph, inv: Inventory, target: { width: number; height: number }): Graph {
  const model = upscaleModel(inv);
  if (!model || !hasAll(inv, ['UpscaleModelLoader', 'ImageUpscaleWithModel', 'ImageScale'])) return graph;
  const { g, add } = builder(graph);
  const loader = add('UpscaleModelLoader', { model_name: model });
  for (const n of Object.values(g)) {
    if (n.class_type !== 'SaveImage') continue;
    const up = add('ImageUpscaleWithModel', { upscale_model: loader, image: n.inputs.images });
    n.inputs.images = add('ImageScale', { image: up, upscale_method: 'lanczos', width: target.width, height: target.height, crop: 'center' });
  }
  return g;
}

/** A standalone master → 4x model → resize graph, for the key art. Null when no upscale model is installed. */
export function upscaleGraph(image: string, inv: Inventory, target: { width: number; height: number }): Graph | null {
  if (!upscaleModel(inv) || !hasAll(inv, ['LoadImage', 'UpscaleModelLoader', 'ImageUpscaleWithModel', 'ImageScale', 'SaveImage'])) return null;
  const { g, add } = builder();
  add('SaveImage', { images: add('LoadImage', { image }, 'Master plate'), filename_prefix: 'standupify/originals/keyart' });
  return withUpscale(g, inv, target);
}

/** Double the frame rate of a clip graph with RIFE (ComfyUI-Frame-Interpolation), if installed. */
export function withInterpolation(graph: Graph, inv: Inventory): Graph {
  if (!canInterpolate(inv)) return graph;
  const { g, add } = builder(graph);
  for (const n of Object.values(g)) {
    const fpsKey = n.class_type === 'VHS_VideoCombine' ? 'frame_rate' : n.class_type === 'CreateVideo' || n.class_type === 'SaveAnimatedWEBP' ? 'fps' : null;
    if (!fpsKey || !Array.isArray(n.inputs.images)) continue;
    n.inputs.images = add(RIFE_NODE, { ckpt_name: 'rife47.pth', frames: n.inputs.images, clear_cache_after_n_frames: 10, multiplier: 2, fast_mode: true, ensemble: true, scale_factor: 1 }, 'Interpolate 2x');
    n.inputs[fpsKey] = Number(n.inputs[fpsKey] || 24) * 2;
  }
  return g;
}

/** Premium shot size per video model: as big as it renders cleanly. */
export function shotSize(recipeId: string): { width: number; height: number } {
  if (recipeId.startsWith('wan')) return { width: 1280, height: 704 };
  return { width: 1024, height: 576 };
}
