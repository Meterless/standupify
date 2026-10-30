// =====================================================================
// npm run soak — leave the whole Station running and measure it.
//
// Talks to a running `npm start` (the Station API). It puts the Circuit on
// the air, optionally pins the video recipe (e.g. Wan 2.2) and greenlights
// an Original, then every few minutes records what the Station made and
// what failed, rebuilds the landing page from the fresh footage, and keeps
// a running report in engines/logs/soak-<stamp>.md.
//
//   npm run soak -- --hours 8 --video wan22-5b --original coverage
//   npm run soak -- --hours 1 --every 5          (minutes between samples)
//   npm run soak -- --port 3212                  (another Station)
// =====================================================================

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
const base = `http://127.0.0.1:${opt('port', process.env.PORT || '3210')}`;
const hours = Number(opt('hours', '6'));
const every = Number(opt('every', '10')) * 60_000;
const video = opt('video', null);
const original = opt('original', null);          // 'coverage' | 'full'
const landingEvery = Number(opt('landing', '30')) * 60_000;
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const report = path.join(root, 'engines', 'logs', `soak-${stamp}.md`);
fs.mkdirSync(path.dirname(report), { recursive: true });

const H = { 'content-type': 'application/json', 'x-standupify': '1' };
const cmd = async (name, ...a) => (await (await fetch(`${base}/api/station/cmd`, { method: 'POST', headers: H, body: JSON.stringify({ name, args: a }) })).json()).result;
const repo = async (method, ...a) => (await (await fetch(`${base}/api/station/repo`, { method: 'POST', headers: H, body: JSON.stringify({ method, args: a }) })).json()).result;
const status = async () => (await fetch(`${base}/api/status`)).json();
const snapshot = async () => (await fetch(`${base}/api/station/snapshot`)).json();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const log = (s) => { console.log(s); fs.appendFileSync(report, s + '\n'); };

/** Tasks come over the Station's live stream; read one frame of it. */
async function tasks() {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 5000);
  try {
    const r = await fetch(`${base}/api/station/stream`, { signal: ctl.signal });
    const reader = r.body.getReader(); let buf = '';
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      buf += new TextDecoder().decode(value);
      const m = /event: tasks\ndata: (.*)\n/.exec(buf);
      if (m) { ctl.abort(); return JSON.parse(m[1]); }
    }
  } catch { /* aborted */ } finally { clearTimeout(t); }
  return [];
}

function count(dir) { try { return fs.readdirSync(dir).length; } catch { return 0; } }
const stationDir = process.env.STANDUPIFY_STATION_DIR || path.join(root, 'engines', 'station');
const media = () => {
  const files = (() => { try { return fs.readdirSync(path.join(stationDir, 'media')); } catch { return []; } })();
  return { clips: files.filter(f => /\.(mp4|webm|gif|webp)$/.test(f)).length, stills: files.filter(f => /\.(png|jpg)$/.test(f)).length, audio: files.filter(f => /\.(wav|mp3|ogg)$/.test(f)).length };
};

// ---------------------------------------------------------------------

const st = await status().catch(() => null);
if (!st) { console.error(`No Standupify at ${base}. Start it with npm start first.`); process.exit(1); }
log(`# Soak test · ${new Date().toLocaleString()}\n`);
log(`- Station: ${base} · Nightshift ${st.nightshift?.state} · ComfyUI ${st.comfy?.state}${st.comfy?.gpu ? ` (${st.comfy.gpu.name})` : ''}`);
log(`- Plan: ${hours} h, a sample every ${every / 60_000} min, landing rebuilt every ${landingEvery / 60_000} min${video ? `, video recipe pinned to ${video}` : ''}${original ? `, one Original (${original})` : ''}\n`);

if (video) {
  const s = await repo('getSettings');
  await repo('saveSettings', { ...s, videoRecipe: video });
  log(`- Video recipe set to \`${video}\` (the Reel and Originals use it when its models are installed).`);
}
await cmd('setLive', true);
log('- The Circuit is live.');
if (original) {
  const snap = await snapshot();
  const top = Object.values(snap.state?.stats || {}).filter(s => s.life === 'active').sort((a, b) => b.elo - a.elo)[0];
  if (top) { const id = await cmd('originalsGreenlight', top.comedianId, { budget: original, minutes: 12 }); log(`- Original greenlit for the top of the board: ${id}`); }
}

const start = Date.now();
const m0 = media();
const failures = new Map();
let lastLanding = Date.now() - landingEvery + 60_000, samples = 0, prevShows = count(path.join(stationDir, 'shows'));
log('\n| time | night | shows | clips | stills | audio | Originals | running | failed (new) | engines |\n|---|---|---|---|---|---|---|---|---|---|');

while (Date.now() - start < hours * 3600_000) {
  try {
    const [snap, list, eng, origs] = await Promise.all([snapshot(), tasks(), status(), cmd('originalsList').catch(() => [])]);
    const m = media();
    const fresh = list.filter(t => t.status === 'failed' && !failures.has(t.id));
    for (const t of fresh) failures.set(t.id, t);
    const shows = count(path.join(stationDir, 'shows'));
    const o = (origs || [])[0];
    const mins = Math.round((Date.now() - start) / 60_000);
    log(`| +${mins}m | ${snap.state?.night ?? '—'} | ${shows} (+${shows - prevShows}) | ${m.clips} (+${m.clips - m0.clips}) | ${m.stills} (+${m.stills - m0.stills}) | ${m.audio} | ${o ? `${o.stage} ${o.shots.done}/${o.shots.total}` : '—'} | ${list.filter(t => t.status === 'running').length} | ${failures.size} (+${fresh.length}) | NS ${eng.nightshift?.state} · Comfy ${eng.comfy?.state} |`);
    for (const t of fresh) log(`  - ✗ ${t.engine} · ${t.label}: ${(t.error || '').slice(0, 200)}`);
    prevShows = shows; samples++;
    if (Date.now() - lastLanding > landingEvery) {
      const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'build-landing.mjs')], { encoding: 'utf8', env: { ...process.env } });
      log(`  - landing rebuilt: ${(r.stdout || r.stderr).trim().split('\n').pop()}`);
      lastLanding = Date.now();
    }
  } catch (e) { log(`  - sample failed: ${e.message}`); }
  await sleep(every);
}

const m = media();
log(`\n## Result after ${hours} h\n- ${m.clips - m0.clips} new clips, ${m.stills - m0.stills} new stills, ${failures.size} failed tasks over ${samples} samples.`);
const byKind = {};
for (const t of failures.values()) { const k = `${t.engine} · ${(t.error || 'unknown').slice(0, 80)}`; byKind[k] = (byKind[k] || 0) + 1; }
for (const [k, n] of Object.entries(byKind).sort((a, b) => b[1] - a[1])) log(`- ${n}× ${k}`);
spawnSync(process.execPath, [path.join(root, 'scripts', 'build-landing.mjs')], { stdio: 'inherit' });
log(`\nReport: ${path.relative(root, report)}`);
