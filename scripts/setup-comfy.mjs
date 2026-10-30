// =====================================================================
// npm run setup:comfy — ComfyUI + the models Standupify uses, one command.
//
//   npm run setup:comfy                       starter pack into ./engines/ComfyUI
//   npm run setup:comfy -- --pack lite        smaller download (SDXL Turbo + LTX-Video)
//   npm run setup:comfy -- --pack wan         add Wan 2.2 5B clips
//   npm run setup:comfy -- --pack originals   starter + FLUX.1 Kontext + 4x upscaler, for Originals
//   npm run setup:comfy -- --dir D:\ComfyUI   install somewhere else (or into an existing ComfyUI)
//   npm run setup:comfy -- --models-only      skip ComfyUI itself, just fetch models
//   npm run setup:comfy -- --dry-run          check every URL and the disk, download nothing
//   npm run setup:comfy -- --yes              don't ask before downloading
//
// Every URL is checked and the total size shown before a byte is fetched.
// Downloads resume if interrupted. Nothing outside the target folder is touched.
// =====================================================================

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d; };

const c = { dim: (s) => `\x1b[2m${s}\x1b[0m`, amber: (s) => `\x1b[38;5;215m${s}\x1b[0m`, green: (s) => `\x1b[32m${s}\x1b[0m`, red: (s) => `\x1b[31m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m` };
const say = (s = '') => console.log(s);
const die = (s) => { console.error(c.red(`\n✗ ${s}\n`)); process.exit(1); };

const HF = 'https://huggingface.co';
// Each file lists mirrors in order; the first that answers wins.
const FILES = {
  fluxUnet:  { folder: 'diffusion_models', name: 'flux1-schnell-fp8-e4m3fn.safetensors', urls: [`${HF}/Kijai/flux-fp8/resolve/main/flux1-schnell-fp8-e4m3fn.safetensors`] },
  t5:        { folder: 'text_encoders', name: 't5xxl_fp8_e4m3fn.safetensors', urls: [`${HF}/comfyanonymous/flux_text_encoders/resolve/main/t5xxl_fp8_e4m3fn.safetensors`] },
  clipL:     { folder: 'text_encoders', name: 'clip_l.safetensors', urls: [`${HF}/comfyanonymous/flux_text_encoders/resolve/main/clip_l.safetensors`] },
  fluxVae:   { folder: 'vae', name: 'ae.safetensors', urls: [`${HF}/black-forest-labs/FLUX.1-schnell/resolve/main/ae.safetensors`, `${HF}/Comfy-Org/Lumina_Image_2.0_Repackaged/resolve/main/split_files/vae/ae.safetensors`] },
  sdxlTurbo: { folder: 'checkpoints', name: 'sd_xl_turbo_1.0_fp16.safetensors', urls: [`${HF}/stabilityai/sdxl-turbo/resolve/main/sd_xl_turbo_1.0_fp16.safetensors`] },
  ltx:       { folder: 'checkpoints', name: 'ltx-video-2b-v0.9.5.safetensors', urls: [`${HF}/Lightricks/LTX-Video/resolve/main/ltx-video-2b-v0.9.5.safetensors`] },
  wanUnet:   { folder: 'diffusion_models', name: 'wan2.2_ti2v_5B_fp16.safetensors', urls: [`${HF}/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_ti2v_5B_fp16.safetensors`] },
  wanVae:    { folder: 'vae', name: 'wan2.2_vae.safetensors', urls: [`${HF}/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/vae/wan2.2_vae.safetensors`] },
  umt5:      { folder: 'text_encoders', name: 'umt5_xxl_fp8_e4m3fn_scaled.safetensors', urls: [`${HF}/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors`] },
  // Originals: face-locked camera angles (FLUX.1 Kontext dev — non-commercial license) and a 4x key-art upscaler.
  kontext:   { folder: 'diffusion_models', name: 'flux1-dev-kontext_fp8_scaled.safetensors', urls: [`${HF}/Comfy-Org/flux1-kontext-dev_ComfyUI/resolve/main/split_files/diffusion_models/flux1-dev-kontext_fp8_scaled.safetensors`] },
  esrgan:    { folder: 'upscale_models', name: 'RealESRGAN_x4plus.pth', urls: ['https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth'] }
};

const PACKS = {
  starter: { label: 'FLUX.1 schnell stills + LTX-Video clips', files: ['fluxUnet', 't5', 'clipL', 'fluxVae', 'ltx'] },
  lite:    { label: 'SDXL Turbo stills + LTX-Video clips',     files: ['sdxlTurbo', 't5', 'ltx'] },
  wan:     { label: 'FLUX.1 schnell stills + Wan 2.2 5B clips', files: ['fluxUnet', 't5', 'clipL', 'fluxVae', 'wanUnet', 'wanVae', 'umt5'] },
  originals: { label: 'Starter pack + FLUX.1 Kontext (face-locked Originals) + 4x upscaler', files: ['fluxUnet', 't5', 'clipL', 'fluxVae', 'ltx', 'kontext', 'esrgan'] },
  all:     { label: 'Everything above',                         files: Object.keys(FILES) }
};

const pack = PACKS[opt('pack', 'starter')] || die(`Unknown pack. Choose one of: ${Object.keys(PACKS).join(', ')}`);
const dir = path.resolve(opt('dir', path.join(root, 'engines', 'ComfyUI')));
const modelsOnly = flag('models-only');
const dryRun = flag('dry-run');

const gb = (n) => `${(n / 1024 ** 3).toFixed(1)} GB`;
function run(cmd, cmdArgs, opts = {}) {
  const r = spawnSync(cmd, cmdArgs, { stdio: 'inherit', shell: process.platform === 'win32', ...opts });
  if (r.status !== 0) die(`${cmd} ${cmdArgs.join(' ')} failed.`);
}
function has(cmd, a = ['--version']) { return spawnSync(cmd, a, { stdio: 'ignore', shell: process.platform === 'win32' }).status === 0; }

function findPython() {
  const tries = process.platform === 'win32'
    ? [['py', ['-3.12']], ['py', ['-3.11']], ['py', ['-3.13']], ['python', []]]
    : [['python3.12', []], ['python3.11', []], ['python3', []]];
  for (const [cmd, pre] of tries) {
    // No shell: cmd.exe would eat a % in the snippet.
    const r = spawnSync(cmd, [...pre, '-c', 'import sys;print(sys.version_info[0],sys.version_info[1])'], { encoding: 'utf8' });
    const [maj, min] = r.status === 0 ? r.stdout.trim().split(/\s+/).map(Number) : [];
    if (maj === 3 && min >= 10 && min <= 13) return { cmd, pre, version: `${maj}.${min}` };
  }
  return null;
}

async function head(file) {
  for (const url of file.urls) {
    try {
      const r = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(15000) });
      const size = Number(r.headers.get('x-linked-size') || r.headers.get('content-length') || 0);
      if (r.ok && size > 0) return { url, size };
    } catch { /* try the next mirror */ }
  }
  return null;
}

async function download(url, dest, size) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  let have = fs.existsSync(part) ? fs.statSync(part).size : 0;
  const r = await fetch(url, { headers: have ? { Range: `bytes=${have}-` } : {}, redirect: 'follow' });
  if (!r.ok && r.status !== 206) throw new Error(`HTTP ${r.status}`);
  if (have && r.status !== 206) have = 0;     // server ignored the range: start over
  const out = fs.createWriteStream(part, { flags: have ? 'a' : 'w' });
  let done = have, last = 0;
  const t0 = Date.now();
  for await (const chunk of r.body) {
    if (!out.write(chunk)) await new Promise((res) => out.once('drain', res));
    done += chunk.length;
    if (Date.now() - last > 250) {
      last = Date.now();
      const pct = size ? done / size : 0, mbps = (done - have) / 1024 ** 2 / Math.max(0.001, (Date.now() - t0) / 1000);
      const bar = '█'.repeat(Math.round(pct * 28)).padEnd(28, '░');
      process.stdout.write(`\r    ${c.amber(bar)} ${(pct * 100).toFixed(0).padStart(3)}%  ${gb(done)} / ${gb(size)}  ${mbps.toFixed(0)} MB/s   `);
    }
  }
  await new Promise((res) => out.end(res));
  fs.renameSync(part, dest);
  process.stdout.write(`\r    ${c.green('█'.repeat(28))} 100%  ${gb(size)}${' '.repeat(24)}\n`);
}

// ---------------------------------------------------------------------

say(`\n  ${c.amber('●')} ${c.bold('Standupify · ComfyUI setup')}  ${c.dim(pack.label)}\n`);

const comfyExists = fs.existsSync(path.join(dir, 'main.py'));
const freshInstall = !modelsOnly && !comfyExists;
if (freshInstall && !has('git')) die('git is needed to fetch ComfyUI. Install it from https://git-scm.com and run this again.');
const py = freshInstall ? findPython() : { cmd: 'skip', pre: [], version: '' };
if (!py) die('Python 3.10–3.13 is needed for ComfyUI. Install it from https://python.org (tick "Add to PATH"), or use ComfyUI Desktop from https://comfy.org/download and run: npm run setup:comfy -- --models-only --dir <its folder>');

const gpu = spawnSync('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader'], { encoding: 'utf8' });
const nvidia = gpu.status === 0 ? gpu.stdout.trim().split('\n')[0] : null;
say(`  ${c.dim('target')}   ${dir}${comfyExists ? c.dim('  (existing ComfyUI — models only)') : ''}`);
say(`  ${c.dim('gpu')}      ${nvidia || (process.platform === 'darwin' ? 'Apple silicon (MPS)' : 'no NVIDIA GPU found — renders will be slow')}`);

say(`\n  ${c.dim('checking downloads…')}`);
const plan = [];
for (const key of pack.files) {
  const f = FILES[key];
  const dest = path.join(dir, 'models', f.folder, f.name);
  if (fs.existsSync(dest)) { say(`  ${c.green('✓')} ${f.name.padEnd(44)} ${c.dim('already there')}`); continue; }
  const h = await head(f);
  if (!h) die(`Could not reach any mirror for ${f.name}. Check your internet connection and try again.`);
  plan.push({ ...f, ...h, dest });
  say(`  ${c.amber('↓')} ${f.name.padEnd(44)} ${gb(h.size)}`);
}
const modelBytes = plan.reduce((a, f) => a + f.size, 0);
const envBytes = freshInstall ? 6.5 * 1024 ** 3 : 0;
const total = modelBytes + envBytes;
fs.mkdirSync(dir, { recursive: true });
let free = Infinity;
try { const s = fs.statfsSync(dir); free = s.bavail * s.bsize; } catch { /* old Node */ }
say(`\n  ${c.bold('total')}    ${gb(total)}${envBytes ? c.dim(` (models ${gb(modelBytes)} + ComfyUI & PyTorch ~${gb(envBytes)})`) : ''}`);
say(`  ${c.dim('free')}     ${Number.isFinite(free) ? gb(free) : 'unknown'}`);
if (free < total * 1.05) die(`Not enough space in ${path.parse(dir).root}. Try a smaller pack (--pack lite) or another drive (--dir X:\\ComfyUI).`);
if (dryRun) { say(c.dim('\n  dry run — nothing downloaded.\n')); process.exit(0); }

if (!flag('yes') && process.stdin.isTTY) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const a = (await rl.question(`\n  Download ${gb(total)} into ${dir}? [Y/n] `)).trim().toLowerCase();
  rl.close();
  if (a && a !== 'y' && a !== 'yes') { say(c.dim('  Nothing downloaded.\n')); process.exit(0); }
}

if (freshInstall) {
  say(`\n  ${c.amber('1/3')} fetching ComfyUI`);
  // git refuses a non-empty folder; the size check above may have created it empty.
  run('git', ['clone', '--depth', '1', 'https://github.com/comfyanonymous/ComfyUI.git', dir]);
}
if (freshInstall && !fs.existsSync(path.join(dir, '.venv'))) {
  say(`\n  ${c.amber('2/3')} installing PyTorch + ComfyUI ${c.dim(`(Python ${py.version})`)}`);
  run(py.cmd, [...py.pre, '-m', 'venv', '.venv'], { cwd: dir });
  const vpy = path.join(dir, '.venv', process.platform === 'win32' ? 'Scripts' : 'bin', process.platform === 'win32' ? 'python.exe' : 'python');
  run(vpy, ['-m', 'pip', 'install', '--upgrade', 'pip'], { cwd: dir });
  const torch = nvidia ? ['--index-url', 'https://download.pytorch.org/whl/cu128'] : process.platform === 'darwin' ? [] : ['--index-url', 'https://download.pytorch.org/whl/cpu'];
  run(vpy, ['-m', 'pip', 'install', 'torch', 'torchvision', 'torchaudio', ...torch], { cwd: dir });
  run(vpy, ['-m', 'pip', 'install', '-r', 'requirements.txt'], { cwd: dir });
}

// Remember the location so `npm start` can launch it from any drive.
fs.mkdirSync(path.join(root, 'engines'), { recursive: true });
fs.writeFileSync(path.join(root, 'engines', 'comfy-location.json'), JSON.stringify({ dir, installedAt: new Date().toISOString() }, null, 2));

say(`\n  ${c.amber('3/3')} downloading models`);
for (const f of plan) {
  say(`  ${f.name}`);
  try { await download(f.url, f.dest, f.size); }
  catch (e) { die(`${f.name} failed (${e.message}). Run the same command again — it resumes where it stopped.`); }
}

say(`\n  ${c.green('●')} ${c.bold('ComfyUI is ready.')}`);
say(`  Run ${c.bold('npm start')} — Standupify starts ComfyUI for you and picks these models automatically.\n`);
