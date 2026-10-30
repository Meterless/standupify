#!/usr/bin/env node
// =====================================================================
// npm run receipts: a proof report built only from what is on disk.
//
// Reads the Station's records (engines/station), the ComfyUI graph that
// every still and clip carries inside the file, and ComfyUI's own job
// history when ComfyUI is running. Writes docs/RECEIPTS.md and, when
// ffmpeg is on PATH, contact sheets of real frames into docs/media/.
// Nothing here calls a model.
//
//   npm run receipts                 # uses ./engines/station
//   STANDUPIFY_STATION_DIR=… npm run receipts
//   npm run receipts -- --no-images  # report only
// =====================================================================

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { extractGraph, summarizeGraph } from '../services/comfy/provenance.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const station = path.resolve(process.env.STANDUPIFY_STATION_DIR || path.join(root, 'engines', 'station'));
const mediaDir = path.join(station, 'media');
const outDoc = path.join(root, 'docs', 'RECEIPTS.md');
const outMedia = path.join(root, 'docs', 'media');
const COMFY = (process.env.COMFYUI_URL || 'http://127.0.0.1:8188').replace(/\/+$/, '');
const images = !process.argv.includes('--no-images');

const readJson = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const list = (d) => { try { return fs.readdirSync(d); } catch { return []; } };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
// Logged event text is model and template prose; keep the report's punctuation plain.
const plain = (s) => String(s || '').replace(/\s*[—–]\s*/g, ', ').replace(/,\s*,/g, ',');
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const mediaPath = (url) => { const m = /([a-f0-9]{40}\.[a-z0-9]+)/.exec(url || ''); return m ? path.join(mediaDir, m[1]) : null; };

if (!fs.existsSync(path.join(station, 'circuit.json'))) {
  console.error(`No Station data at ${station}. Run npm start and let the Circuit play a few nights first.`);
  process.exit(1);
}

// ---------------------------------------------------------------------
// Station records
// ---------------------------------------------------------------------

const circuit = readJson(path.join(station, 'circuit.json'));
const comedians = Object.fromEntries(list(path.join(station, 'db', 'comedians')).map(f => {
  const c = readJson(path.join(station, 'db', 'comedians', f));
  return c ? [c.id, c] : null;
}).filter(Boolean));
const nameOf = (id) => comedians[id]?.name || id;
const sets = list(path.join(station, 'db', 'sets')).map(f => readJson(path.join(station, 'db', 'sets', f))).filter(Boolean);
const shows = list(path.join(station, 'shows')).filter(f => f.endsWith('.json')).length;
const events = circuit.events || [];
const kinds = events.reduce((m, e) => ((m[e.kind] = (m[e.kind] || 0) + 1), m), {});

// ---------------------------------------------------------------------
// Media provenance, read from the files
// ---------------------------------------------------------------------

const media = list(mediaDir).filter(n => /^[a-f0-9]{40}\.(mp4|webm|png|webp|jpg)$/.test(n));
const prov = new Map();
for (const n of media) {
  try {
    const g = extractGraph(fs.readFileSync(path.join(mediaDir, n)));
    prov.set(n, g ? { graph: g, s: summarizeGraph(g) } : null);
  } catch { prov.set(n, null); }
}
const families = {};
for (const [, p] of prov) {
  if (!p) continue;
  const k = `${p.s.family}|${p.s.kind}`;
  const f = (families[k] ||= { family: p.s.family, kind: p.s.kind, count: 0, sizes: new Set(), frames: new Set(), steps: new Set() });
  f.count++;
  if (p.s.width) f.sizes.add(`${p.s.width}×${p.s.height}`);
  if (p.s.frames) f.frames.add(p.s.frames);
  if (p.s.steps) f.steps.add(p.s.steps);
}
const withGraph = [...prov.values()].filter(Boolean).length;

// ---------------------------------------------------------------------
// ComfyUI: measured execution times from its own history
// ---------------------------------------------------------------------

let gpu = null, timings = [], comfyVersion = null;
try {
  const stats = await (await fetch(`${COMFY}/system_stats`, { signal: AbortSignal.timeout(3000) })).json();
  gpu = stats.devices?.[0]?.name?.replace(/^cuda:\d+\s*/, '').replace(/\s*:\s*cudaMallocAsync$/, '') || null;
  comfyVersion = stats.system?.comfyui_version || null;
  const hist = await (await fetch(`${COMFY}/history?max_items=500`, { signal: AbortSignal.timeout(8000) })).json();
  const by = {};
  for (const e of Object.values(hist)) {
    const msgs = e.status?.messages || [];
    const start = msgs.find(m => m[0] === 'execution_start')?.[1]?.timestamp;
    const done = msgs.find(m => m[0] === 'execution_success')?.[1]?.timestamp;
    const graph = e.prompt?.[2];
    if (!start || !done || !graph) continue;
    const s = summarizeGraph(graph);
    const k = `${s.family}|${s.kind}|${s.width}×${s.height}|${s.frames || ''}`;
    (by[k] ||= { family: s.family, kind: s.kind, size: `${s.width}×${s.height}`, frames: s.frames, secs: [] }).secs.push((done - start) / 1000);
  }
  timings = Object.values(by).sort((a, b) => b.secs.length - a.secs.length);
} catch { /* ComfyUI not running: the report says so */ }

// ---------------------------------------------------------------------
// Theft evidence, measured: the longest run of words two sets share
// ---------------------------------------------------------------------

const words = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean);
function longestRun(a, b) {
  const x = words(a), y = words(b);
  let best = 0, end = 0;
  let prev = new Array(y.length + 1).fill(0);
  for (let i = 1; i <= x.length; i++) {
    const cur = new Array(y.length + 1).fill(0);
    for (let j = 1; j <= y.length; j++) {
      if (x[i - 1] === y[j - 1]) {
        cur[j] = prev[j - 1] + 1;
        if (cur[j] > best) { best = cur[j]; end = i; }
      }
    }
    prev = cur;
  }
  return { length: best, text: x.slice(end - best, end).join(' ') };
}
const thefts = events.filter(e => e.kind === 'theft' && e.evidence?.a && e.evidence?.b)
  .map(e => ({ e, run: longestRun(e.evidence.a, e.evidence.b) }))
  .sort((p, q) => q.run.length - p.run.length || q.e.night - p.e.night);

// ---------------------------------------------------------------------
// One rivalry, straight from the log
// ---------------------------------------------------------------------

const pairCount = {};
for (const e of events) {
  if (!['theft', 'mind', 'rivalry', 'upset'].includes(e.kind) || (e.actors || []).length < 2) continue;
  const k = [...e.actors.slice(0, 2)].sort().join('|');
  pairCount[k] = (pairCount[k] || 0) + 1;
}
const [topPair] = Object.entries(pairCount).sort((a, b) => b[1] - a[1]);
const pair = topPair ? topPair[0].split('|') : [];
const thread = pair.length
  ? events.filter(e => (e.actors || []).some(a => pair.includes(a)) &&
      (((e.actors || []).filter(a => pair.includes(a)).length === 2) || ['win', 'title', 'aim', 'promotion', 'upset'].includes(e.kind)))
      .sort((a, b) => a.night - b.night || a.at - b.at).slice(-14)
  : [];

// ---------------------------------------------------------------------
// Originals
// ---------------------------------------------------------------------

const originals = sets.filter(s => s.premium).map(s => {
  const pr = s.premium;
  const shots = pr.shots || [];
  const rendered = shots.filter(x => x.clipUrl);
  const cams = [...new Set(rendered.map(x => x.camera))];
  const families = {};
  for (const x of rendered) {
    const p = prov.get(path.basename(mediaPath(x.clipUrl) || ''));
    if (p) families[p.s.family] = (families[p.s.family] || 0) + 1;
  }
  const minutes = shots.reduce((a, x) => a + (x.seconds || 0), 0) / 60;
  return { s, pr, shots, rendered, cams, families, minutes, plates: (pr.plates || []).filter(p => p.imageUrl) };
}).sort((a, b) => b.rendered.length - a.rendered.length);

// ---------------------------------------------------------------------
// The repo's workflows, matched against what the rig actually rendered
// ---------------------------------------------------------------------

const sig = (g) => Object.values(g).map(n => n.class_type).sort().join(',');
const renderedSigs = {};
for (const [, p] of prov) if (p) renderedSigs[sig(p.graph)] = (renderedSigs[sig(p.graph)] || 0) + 1;
const workflows = list(path.join(root, 'workflows', 'examples')).filter(f => f.endsWith('.json')).map(f => {
  const g = readJson(path.join(root, 'workflows', 'examples', f));
  if (!g) return null;
  const s = summarizeGraph(g);
  return { f, s, made: renderedSigs[sig(g)] || 0 };
}).filter(Boolean);

// ---------------------------------------------------------------------
// Contact sheets: real frames, no retouching
// ---------------------------------------------------------------------

const ffmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0 ? 'ffmpeg' : null;
const font = ['C:/Windows/Fonts/arialbd.ttf', '/System/Library/Fonts/Supplemental/Arial Bold.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'].find(f => fs.existsSync(f));
const made = [];
const tmp = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TEMP || process.env.TMPDIR || '/tmp'), 'standupify-receipts-'));
function ff(args) { return spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { encoding: 'utf8' }); }
function label(text) {
  if (!font) return '';
  const f = font.replace(/:/g, '\\:');
  const t = text.replace(/[':\\]/g, ' ');
  return `,drawbox=x=0:y=ih-34:w=iw:h=34:color=black@0.62:t=fill,drawtext=fontfile='${f}':text='${t}':fontcolor=white:fontsize=19:x=12:y=h-26`;
}
/** One labelled 480×264 tile from a still, or from a clip at `at` seconds. */
function tile(src, text, at = null) {
  const out = path.join(tmp, `t${made.length}_${Math.random().toString(36).slice(2, 8)}.png`);
  const pre = at === null ? ['-i', src] : ['-ss', String(at), '-i', src];
  const r = ff([...pre, '-frames:v', '1', '-vf', `scale=480:264:force_original_aspect_ratio=increase,crop=480:264${label(text)}`, out]);
  return r.status === 0 && fs.existsSync(out) ? out : null;
}
function grid(tiles, cols, name) {
  tiles = tiles.filter(Boolean);
  if (!tiles.length) return null;
  while (tiles.length % cols) tiles.push(tiles[tiles.length - 1]);
  const rows = tiles.length / cols;
  const inputs = tiles.flatMap(t => ['-i', t]);
  const parts = [];
  for (let r = 0; r < rows; r++) parts.push(`${Array.from({ length: cols }, (_, c) => `[${r * cols + c}:v]`).join('')}hstack=inputs=${cols}[r${r}]`);
  const filter = rows > 1 ? `${parts.join(';')};${Array.from({ length: rows }, (_, r) => `[r${r}]`).join('')}vstack=inputs=${rows}[out]` : parts[0].replace(/\[r0\]$/, '[out]');
  const out = path.join(outMedia, name);
  const r = ff([...inputs, '-filter_complex', filter, '-map', '[out]', '-q:v', '3', out]);
  if (r.status === 0) { made.push(name); return name; }
  console.warn(`  ${name}: ${r.stderr?.split('\n')[0]}`);
  return null;
}
const duration = (f) => Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' }).stdout) || 4;

const sheets = {};
if (images && ffmpeg) {
  fs.mkdirSync(outMedia, { recursive: true });
  const o = originals.find(x => x.plates.length >= 4);
  if (o) {
    const order = ['master', 'wide', 'medium', 'close', 'left', 'right', 'jib', 'crowd'];
    const plates = order.map(cam => o.plates.find(p => p.camera === cam)).filter(Boolean);
    sheets.plates = grid(plates.map(p => tile(mediaPath(p.imageUrl), p.camera.toUpperCase() + ' plate')), 4, 'original-plates.jpg');

    const perCam = order.map(cam => o.rendered.find(x => x.camera === cam && x.phase !== 'title') || o.rendered.find(x => x.camera === cam)).filter(Boolean);
    sheets.coverage = grid(perCam.map(x => {
      const f = mediaPath(x.clipUrl);
      const fam = prov.get(path.basename(f))?.s.family || '';
      return f && fs.existsSync(f) ? tile(f, `${x.camera.toUpperCase()}  ${fam}`, Math.min(2, duration(f) / 2)) : null;
    }), 4, 'original-coverage.jpg');

    // One shot from plate to motion: master plate, the shot's camera plate, three frames of its clip.
    const shot = o.rendered.find(x => x.camera === 'close') || o.rendered[0];
    const f = shot && mediaPath(shot.clipUrl);
    if (f && fs.existsSync(f)) {
      const d = duration(f);
      const camPlate = o.plates.find(p => p.camera === shot.camera) || o.plates[0];
      sheets.pipeline = grid([
        tile(mediaPath(o.plates.find(p => p.camera === 'master')?.imageUrl), '1 master plate'),
        tile(mediaPath(camPlate.imageUrl), `2 ${shot.camera} plate`),
        tile(f, `3 clip ${(d * 0.1).toFixed(1)}s`, d * 0.1),
        tile(f, `4 clip ${(d * 0.5).toFixed(1)}s`, d * 0.5),
        tile(f, `5 clip ${(d * 0.9).toFixed(1)}s`, d * 0.9)
      ], 5, 'original-pipeline.jpg');
    }

    // A short animated cut across the cameras, for the README.
    const gifClips = perCam.slice(0, 8).map(x => mediaPath(x.clipUrl)).filter(f => f && fs.existsSync(f));
    if (gifClips.length >= 3) {
      const inputs = gifClips.flatMap(f => ['-ss', String(Math.min(1, duration(f) / 3)), '-t', '1.25', '-i', f]);
      const chain = gifClips.map((_, i) => `[${i}:v]fps=10,scale=480:264:force_original_aspect_ratio=increase,crop=480:264,setsar=1[v${i}]`).join(';');
      const filter = `${chain};${gifClips.map((_, i) => `[v${i}]`).join('')}concat=n=${gifClips.length}:v=1:a=0,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle[out]`;
      const r = ff([...inputs, '-filter_complex', filter, '-map', '[out]', '-loop', '0', path.join(outMedia, 'original-cut.gif')]);
      if (r.status === 0) { made.push('original-cut.gif'); sheets.gif = 'original-cut.gif'; }
      else console.warn(`  original-cut.gif: ${r.stderr?.split('\n')[0]}`);
    }
  }

  // The newest Circuit clips per video model (stage clips, not Originals).
  const originalClips = new Set(originals.flatMap(x => x.rendered.map(r => path.basename(mediaPath(r.clipUrl) || ''))));
  const circuitClips = media.filter(n => /\.mp4$/.test(n) && prov.get(n) && !originalClips.has(n))
    .map(n => ({ n, mtime: fs.statSync(path.join(mediaDir, n)).mtimeMs, s: prov.get(n).s }))
    .sort((a, b) => b.mtime - a.mtime);
  const ltx = circuitClips.filter(c => /LTX/.test(c.s.family)).slice(0, 4);
  if (ltx.length) sheets.ltx = grid(ltx.map(c => tile(path.join(mediaDir, c.n), `${c.s.family}  ${c.s.width}x${c.s.height}`, 2)), Math.min(4, ltx.length), 'circuit-ltx.jpg');
}
fs.rmSync(tmp, { recursive: true, force: true });

// ---------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------

const now = new Date();
const L = [];
L.push('# Receipts');
L.push('');
L.push(`Generated by \`npm run receipts\` on ${now.toISOString().slice(0, 16).replace('T', ' ')} UTC from the Station data on this machine. Every number below is counted from files on disk. Re-run the command to check it.`);
L.push('');
L.push('**What is simulated:** the audience and the judges. Crowd reactions come from a seeded room model; judge scores come from the local language model. No human audience was involved. Outcomes (wins, ratings, accusations) are decided by seeded rules over the logged sets.');
L.push('');
L.push('## The Station at a glance');
L.push('');
L.push('| | |');
L.push('|---|---|');
L.push(`| Nights on the Circuit | ${circuit.night} |`);
L.push(`| Comedians | ${Object.keys(comedians).length} |`);
L.push(`| Shows on record | ${shows} |`);
L.push(`| Sets and bits | ${sets.length} |`);
L.push(`| Logged events (latest ${events.length}) | ${Object.entries(kinds).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')} |`);
L.push(`| Current champion | ${nameOf(circuit.champion)} |`);
L.push(`| Media files | ${media.length}, of which ${withGraph} carry their ComfyUI graph |`);
L.push('');
L.push('## Every frame carries its graph');
L.push('');
L.push('ComfyUI writes the full API-format workflow into each PNG and each SaveVideo MP4. This table is read from those embedded graphs, not from Standupify\'s own records. In the app, the **ComfyUI** badge on any still or clip opens the same graph and downloads it as JSON.');
L.push('');
L.push('| Model | Kind | Files | Resolution | Frames | Steps |');
L.push('|---|---|---:|---|---|---|');
for (const f of Object.values(families).sort((a, b) => b.count - a.count)) {
  L.push(`| ${f.family} | ${f.kind} | ${f.count} | ${[...f.sizes].join(', ') || '-'} | ${[...f.frames].join(', ') || '-'} | ${[...f.steps].join(', ') || '-'} |`);
}
L.push('');
L.push('## Measured render times');
L.push('');
if (timings.length) {
  L.push(`From ComfyUI's own job history (execution start to finish, queue wait excluded) on **${gpu || 'this GPU'}**${comfyVersion ? `, ComfyUI ${comfyVersion}` : ''}. The local language model shares the same card, so these are times under load. Marginal cost per render: $0.`);
  L.push('');
  L.push('| Model | Kind | Resolution | Frames | Jobs | Median | Fastest | Slowest |');
  L.push('|---|---|---|---|---:|---:|---:|---:|');
  for (const t of timings) {
    const s = (x) => (x >= 90 ? `${(x / 60).toFixed(1)} min` : `${x.toFixed(1)} s`);
    L.push(`| ${t.family} | ${t.kind} | ${t.size} | ${t.frames || '-'} | ${t.secs.length} | ${s(median(t.secs))} | ${s(Math.min(...t.secs))} | ${s(Math.max(...t.secs))} |`);
  }
} else {
  L.push('ComfyUI was not running when this report was generated, so no timings were measured. Start ComfyUI and re-run.');
}
L.push('');
if (sheets.plates || sheets.coverage || sheets.pipeline || sheets.ltx) {
  L.push('## Contact sheets');
  L.push('');
  L.push('Frames pulled straight from the files with ffmpeg. No retouching, no cherry-picked takes beyond "first rendered shot per camera".');
  L.push('');
  if (sheets.gif) L.push(`![A cut across the eight cameras of one Original](media/${sheets.gif})`, '');
  if (sheets.pipeline) L.push('**One shot, plate to motion.** The master plate, the camera plate derived from it, then three frames of the image-to-video clip.', '', `![Pipeline](media/${sheets.pipeline})`, '');
  if (sheets.plates) L.push('**Eight camera plates for one Original.** Each angle is derived from the master so the comedian, room and wardrobe stay put.', '', `![Plates](media/${sheets.plates})`, '');
  if (sheets.coverage) L.push('**Coverage.** A frame from the first rendered clip on each camera.', '', `![Coverage](media/${sheets.coverage})`, '');
  if (sheets.ltx) L.push('**Circuit highlights on LTX-Video.** The newest stage clips the Station rendered with the LTX recipe.', '', `![LTX clips](media/${sheets.ltx})`, '');
}
L.push('## Originals');
L.push('');
if (originals.length) {
  L.push('| Title | Comedian | Stage | Planned shots | Shots with a rendered clip | Cameras covered | Plates | Planned runtime | Clip models |');
  L.push('|---|---|---|---:|---:|---:|---:|---:|---|');
  for (const o of originals) {
    L.push(`| ${o.s.title} | ${nameOf(o.s.comedianId)} | ${o.pr.stage} | ${o.shots.length} | ${o.rendered.length} | ${o.cams.length} | ${o.plates.length} | ${o.minutes.toFixed(1)} min | ${Object.entries(o.families).map(([k, v]) => `${k} ${v}`).join(', ') || '-'} |`);
  }
  L.push('');
  L.push('Originals are shot coverage-first: every beat gets a planned shot, the director renders the shots that matter most first, and the theater fills unrendered shots from the nearest rendered angle or its camera plate. A premiered Original is watchable end to end; it does not mean every planned shot is a unique render.');
} else {
  L.push('No Originals yet.');
}
L.push('');
L.push('## Joke theft, measured');
L.push('');
L.push('An accusation fires when a set shares at least two five-word runs with an earlier set by another comic (`findTheft` in `services/league/engine.ts`). It is evidence, not proof. Below, the longest run of words the two sets actually share, measured here from the stored texts.');
L.push('');
if (thefts.length) {
  const short = thefts.filter(t => t.run.length <= 6).length;
  L.push(`${plural(thefts.length, 'accusation')} on record. ${short} rest on a shared run of six words or fewer (stock phrases such as "in the front row"); the strongest cases:`);
  L.push('');
  L.push('| Night | Accuser | Accused | Bit | Longest shared run |');
  L.push('|---:|---|---|---|---|');
  for (const t of thefts.slice(0, 5)) {
    L.push(`| ${t.e.night} | ${nameOf(t.e.actors[1])} | ${nameOf(t.e.actors[0])} | ${(/“([^”]+)”/.exec(t.e.text) || [])[1] || ''} | ${t.run.length} words: "${clip(t.run.text, 140)}" |`);
  }
}
L.push('');
if (thread.length) {
  L.push(`## One rivalry, as logged: ${nameOf(pair[0])} and ${nameOf(pair[1])}`);
  L.push('');
  L.push('The most frequent pairing in the theft, callout and rivalry events, with each comic\'s wins and titles in between. The log records order, not cause.');
  L.push('');
  L.push('| Night | Event |');
  L.push('|---:|---|');
  for (const e of thread) L.push(`| ${e.night} | ${plain(e.text).replace(/\|/g, '/')} |`);
  L.push('');
}
L.push('## Workflows in this repo');
L.push('');
L.push('API-format graphs in `workflows/examples/`. "Rendered here" counts Station files whose embedded graph has exactly the same set of nodes.');
L.push('');
L.push('| Workflow | Model | Nodes | Resolution | Rendered here |');
L.push('|---|---|---:|---|---:|');
for (const w of workflows) L.push(`| \`${w.f}\` | ${w.s.family} | ${w.s.nodeCount} | ${w.s.width ? `${w.s.width}×${w.s.height}` : '-'} | ${w.made} |`);
L.push('');

fs.mkdirSync(path.dirname(outDoc), { recursive: true });
fs.writeFileSync(outDoc, L.join('\n'));
console.log(`Wrote ${path.relative(root, outDoc)}${made.length ? ` and ${made.map(m => `docs/media/${m}`).join(', ')}` : ''}.`);
if (images && !ffmpeg) console.log('ffmpeg is not on PATH, so no contact sheets were made.');
