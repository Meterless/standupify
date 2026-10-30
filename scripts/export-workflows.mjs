// Writes every built-in recipe as a ComfyUI API workflow into workflows/examples/.
// Each file keeps {{prompt}} / {{negative}} / {{image}} placeholders, so it opens
// in ComfyUI as-is and also works dropped back into Standupify as a recipe.
//
//   npm run export:workflows

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'node:module';

// The app's TypeScript imports siblings without an extension; let Node find the .ts file.
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  try { return await next(spec, ctx); }
  catch (e) { if (spec.startsWith('.') && !/[.][a-z]+$/.test(spec.split('/').pop())) return next(spec + '.ts', ctx); throw e; }
}`));

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { BUILTIN_RECIPES } = await import(pathToFileURL(path.join(root, 'services', 'comfy', 'recipes.ts')).href);
const consistency = await import(pathToFileURL(path.join(root, 'services', 'comfy', 'consistency.ts')).href);

const inv = {
  stamp: 1,
  nodes: new Set(['CheckpointLoaderSimple', 'CLIPTextEncode', 'EmptySD3LatentImage', 'EmptyLatentImage', 'KSampler', 'VAEDecode', 'SaveImage', 'FluxGuidance',
    'UNETLoader', 'DualCLIPLoader', 'CLIPLoader', 'VAELoader', 'LoadImage', 'LTXVImgToVideo', 'LTXVConditioning', 'LTXVScheduler', 'SamplerCustomAdvanced',
    'CFGGuider', 'RandomNoise', 'KSamplerSelect', 'CreateVideo', 'SaveVideo', 'ModelSamplingSD3', 'Wan22ImageToVideoLatent',
    'VAEEncode', 'ImageCrop', 'ImageScale', 'FluxKontextImageScale', 'ReferenceLatent', 'ConditioningZeroOut', 'UpscaleModelLoader', 'ImageUpscaleWithModel', 'RIFE VFI']),
  models: {
    checkpoints: ['flux1-schnell-fp8.safetensors', 'sd_xl_turbo_1.0_fp16.safetensors', 'ltx-video-2b-v0.9.5.safetensors'],
    diffusion_models: ['flux1-schnell-fp8-e4m3fn.safetensors', 'flux1-dev-kontext_fp8_scaled.safetensors', 'wan2.2_ti2v_5B_fp16.safetensors'],
    text_encoders: ['t5xxl_fp8_e4m3fn.safetensors', 'clip_l.safetensors', 'umt5_xxl_fp8_e4m3fn_scaled.safetensors'],
    vae: ['ae.safetensors', 'wan2.2_vae.safetensors'],
    upscale_models: ['RealESRGAN_x4plus.pth']
  }
};

const out = path.join(root, 'workflows', 'examples');
fs.mkdirSync(out, { recursive: true });
for (const r of BUILTIN_RECIPES) {
  if (r.id === 'checkpoint') continue;               // the generic fallback is not worth shipping
  const d = r.detect(inv);
  if (!d.ok) { console.warn(`skip ${r.id}: ${d.missing.join(', ')}`); continue; }
  const params = r.kind === 'image'
    ? { prompt: '{{prompt}}', negative: '{{negative}}', width: 1024, height: 768, seed: 42 }
    : { prompt: '{{prompt}}', negative: '{{negative}}', image: '{{image}}', width: r.id.startsWith('wan') ? 960 : 768, height: r.id.startsWith('wan') ? 544 : 512, seconds: 4, seed: 42 };
  // A sample graph for the SDXL file uses the turbo checkpoint; the FLUX split file the fp8 unet.
  const picks = r.id === 'sdxl' ? { ckpt: 'sd_xl_turbo_1.0_fp16.safetensors' } : d.picks;
  const file = path.join(out, `standupify_${r.kind === 'image' ? 'still' : 'clip'}_${r.id}.json`);
  fs.writeFileSync(file, JSON.stringify(r.build(params, picks, inv), null, 2) + '\n');
  console.log(`wrote ${path.relative(root, file)}`);
}

// Originals: the consistency graphs. {{image}} is the master plate.
const write = (name, graph) => {
  const file = path.join(out, name);
  fs.writeFileSync(file, JSON.stringify(graph, null, 2) + '\n');
  console.log(`wrote ${path.relative(root, file)}`);
};
const plate = { prompt: '{{prompt}}', negative: '{{negative}}', width: 1344, height: 768, seed: 42, reference: '{{image}}', refSize: { width: 1344, height: 768 } };
const ladder = consistency.plateLadder(inv, [], 'flux-split');
const kontext = ladder.find((e) => e.rung === 'kontext');
const punchIn = ladder.find((e) => e.rung === 'img2img');
if (kontext) write('standupify_original_plate_kontext.json', consistency.buildPlateGraph(kontext, { ...plate, edit: 'Move the camera to stage left: a 3/4 profile of the comedian.' }, inv));
if (punchIn) write('standupify_original_plate_punch-in.json', consistency.buildPlateGraph(punchIn, { ...plate, crop: { x: 0.33, y: 0.03, w: 0.34, h: 0.34 }, denoise: 0.42 }, inv));
const ltx = BUILTIN_RECIPES.find((r) => r.id === 'ltxv');
const d = ltx.detect(inv);
if (d.ok) write('standupify_original_shot_ltxv-rife.json', consistency.withInterpolation(ltx.build({ prompt: '{{prompt}}', negative: '{{negative}}', image: '{{image}}', width: 1024, height: 576, seconds: 5, seed: 42 }, d.picks, inv), inv));
