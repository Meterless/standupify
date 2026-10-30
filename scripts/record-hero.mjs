// =====================================================================
// npm run record:hero: record the top of the landing page as a looping GIF
// for the README (docs/media/landing-hero.gif).
//
// Drives headless Chrome (or Edge) over the DevTools protocol and steps the
// page clock by hand: every CSS animation and every clip on the wall is
// paused and set to the frame's time, so each frame is exact however slow
// the capture runs. ffmpeg then crossfades the tail into the head, so the
// loop has no jump, and builds a two-pass palette GIF.
//
//   npm run record:hero
//   npm run record:hero -- --seconds 6 --fps 10 --width 880 --seed 3
//   npm run record:hero -- --keep     also keep the PNG frames
//   CHROME=/path/to/chrome npm run record:hero
// =====================================================================

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i !== -1 && args[i + 1] ? args[i + 1] : d; };
const SECONDS = Number(opt('seconds', 6));     // loop length
const FADE = Number(opt('fade', 1));           // crossfade from the tail into the head
const FPS = Number(opt('fps', 10));
const WIDTH = Number(opt('width', 880));       // GIF width, cropped to 2:1; capture is 1280×720 CSS px at 1.5x
const COLORS = Number(opt('colors', 64));      // every pixel moves, so size grows with frames, not colors
const SEED = Number(opt('seed', 3));           // which tiles land on the wall
const START = Number(opt('start', 0));         // page time of the first frame
const OUT = path.resolve(root, opt('out', 'docs/media/landing-hero.gif'));
const PAGE = path.join(root, 'landing', 'index.html');
const KEEP = args.includes('--keep');          // leave the PNG frames in the temp folder

const chrome = (() => {
  const local = process.env.LOCALAPPDATA || '';
  const found = [process.env.CHROME,
    'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    path.join(local, 'Google/Chrome/Application/chrome.exe'),
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'
  ].find(p => p && fs.existsSync(p));
  return found || null;
})();
if (!chrome) { console.error('No Chrome or Edge found. Set CHROME to the browser executable.'); process.exit(1); }
if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status !== 0) { console.error('ffmpeg is not on PATH.'); process.exit(1); }
if (!fs.existsSync(PAGE)) { console.error('landing/index.html is missing.'); process.exit(1); }

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'standupify-hero-'));
const frames = path.join(work, 'frames');
fs.mkdirSync(frames);
const browser = spawn(chrome, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${path.join(work, 'profile')}`,
  '--hide-scrollbars', '--mute-audio', '--no-first-run', '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required',
  '--allow-file-access-from-files', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Chrome writes the port it picked to DevToolsActivePort in its profile.
let wsUrl = null;
for (let i = 0; i < 100 && !wsUrl; i++) {
  await sleep(100);
  try { const [port, p] = fs.readFileSync(path.join(work, 'profile', 'DevToolsActivePort'), 'utf8').trim().split(/\r?\n/); wsUrl = `ws://127.0.0.1:${port}${p}`; } catch { }
}
if (!wsUrl) { browser.kill(); console.error('The browser did not open its DevTools port.'); process.exit(1); }

const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  const p = m.id && pending.get(m.id);
  if (!p) return;
  pending.delete(m.id);
  m.error ? p.rej(new Error(m.error.message)) : p.res(m.result);
};
const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
  const id = ++seq; pending.set(id, { res, rej });
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
});

const finish = (code) => {
  try { ws.close(); } catch { }
  browser.kill();
  if (KEEP) console.log(`frames kept in ${frames}`);
  setTimeout(() => { try { fs.rmSync(KEEP ? path.join(work, 'profile') : work, { recursive: true, force: true }); } catch { } process.exit(code); }, 600);
};

try {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const s = (m, p) => send(m, p, sessionId);
  const run = async (expression) => {
    const r = await s('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };

  await s('Page.enable');
  await s('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1.5, mobile: false });
  // A seeded Math.random, so the same tiles land on the wall every run.
  await s('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { let a = ${SEED >>> 0} || 1; Math.random = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; })();` });
  await s('Page.navigate', { url: pathToFileURL(PAGE).href });
  for (let i = 0; i < 200; i++) { if (await run('document.readyState').catch(() => '') === 'complete') break; await sleep(100); }

  const info = await run(`(async () => {
    const hero = document.querySelector('.hero');
    hero.querySelectorAll('img').forEach(i => { i.loading = 'eager'; });
    await document.fonts.ready;
    await Promise.all([...hero.querySelectorAll('img')].map(i => i.decode().catch(() => {})));
    const vids = [...hero.querySelectorAll('video')];
    await Promise.all(vids.map(v => v.readyState >= 2 ? 0 : new Promise(r => { v.addEventListener('loadeddata', r, { once: true }); setTimeout(r, 10000); })));
    vids.forEach(v => v.pause());
    window.__anims = document.getAnimations();
    window.__anims.forEach(a => a.pause());
    return { images: hero.querySelectorAll('img').length, clips: vids.filter(v => v.readyState >= 2).length, animations: window.__anims.length };
  })()`);
  console.log(`hero wall: ${info.images} stills, ${info.clips} clips, ${info.animations} animations`);

  const total = Math.round((SECONDS + FADE) * FPS);
  for (let f = 0; f < total; f++) {
    const t = START + f / FPS;
    await run(`(async () => {
      const t = ${t};
      window.__anims.forEach(a => { a.currentTime = t * 1000; });
      // Clips on the wall all start together on load, so they share one clock.
      const box = innerHeight, wide = innerWidth;
      const vids = [...document.querySelectorAll('.hero video')].filter(v => {
        const r = v.getBoundingClientRect(); return r.right > 0 && r.left < wide && r.bottom > 0 && r.top < box;
      });
      await Promise.all(vids.map(v => new Promise(r => {
        const at = v.duration ? t % v.duration : 0;
        if (Math.abs(v.currentTime - at) < 1e-3) return r();
        v.addEventListener('seeked', r, { once: true }); setTimeout(r, 4000); v.currentTime = at;
      })));
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    })()`);
    const { data } = await s('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(frames, `${String(f).padStart(4, '0')}.png`), Buffer.from(data, 'base64'));
    if (f % FPS === 0) process.stdout.write(`\rframes ${f + 1}/${total}`);
  }
  process.stdout.write(`\rframes ${total}/${total}\n`);

  // Play from FADE to SECONDS + FADE, crossfading the last FADE seconds into
  // the first FADE seconds: the GIF ends on the frame it starts with.
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const graph = [
    `[0]scale=${WIDTH}:-2:flags=lanczos,crop=${WIDTH}:${Math.round(WIDTH / 4) * 2}:0:0,split[a][b]`,
    `[a]trim=start=${FADE},setpts=PTS-STARTPTS[main]`,
    `[b]trim=end=${FADE},setpts=PTS-STARTPTS[head]`,
    `[main][head]xfade=transition=fade:duration=${FADE}:offset=${SECONDS - FADE},split[x][y]`,
    `[x]palettegen=max_colors=${COLORS}:stats_mode=full[p]`,
    `[y][p]paletteuse=dither=none:diff_mode=rectangle`
  ].join(';');
  const ff = spawnSync('ffmpeg', ['-v', 'error', '-y', '-framerate', String(FPS), '-i', path.join(frames, '%04d.png'), '-filter_complex', graph, '-loop', '0', OUT], { encoding: 'utf8' });
  if (ff.status !== 0) throw new Error(ff.stderr || 'ffmpeg failed');
  console.log(`${path.relative(root, OUT)}: ${WIDTH}px, ${SECONDS}s at ${FPS} fps, ${(fs.statSync(OUT).size / 1048576).toFixed(1)} MB`);
  finish(0);
} catch (e) {
  console.error(e.message || e);
  finish(1);
}
