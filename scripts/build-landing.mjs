// =====================================================================
// npm run landing — feed everything the Station has made into the landing
// page, so it previews what watching the Station is actually like.
//
// Reads engines/station/ (the roster, every Circuit show, every special and
// Original) and writes:
//   landing/media/station/<file>   every still and clip, copied once
//   landing/station.js             window.STATION = { comics, clips, stills, shows, originals, … }
//
// station.js is a plain script (not JSON) so the page also works opened
// straight from disk (file://), where fetch() is blocked.
//
//   npm run landing                    from engines/station
//   npm run landing -- --dir <station> from another Station folder (e.g. the demo)
// =====================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i !== -1 && args[i + 1] ? args[i + 1] : d; };
const station = path.resolve(opt('dir', path.join(root, 'engines', 'station')));
const outDir = path.join(root, 'landing', 'media', 'station');
fs.mkdirSync(outDir, { recursive: true });

const readAll = (dir) => {
  try { return fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return null; } }).filter(Boolean); }
  catch { return []; }
};
const circuit = (() => { try { return JSON.parse(fs.readFileSync(path.join(station, 'circuit.json'), 'utf8')); } catch { return null; } })();
const comedians = readAll(path.join(station, 'db', 'comedians'));
const sets = readAll(path.join(station, 'db', 'sets'));
const shows = readAll(path.join(station, 'shows')).sort((a, b) => b.night - a.night || b.startedAt - a.startedAt);

/** /api/station/media/<sha>.<ext> → media/station/<sha>.<ext> (copied once). */
let copied = 0;
const media = (url) => {
  if (typeof url !== 'string') return null;
  const m = /\/api\/station\/media\/([a-f0-9]{40}\.[a-z0-9]+)/.exec(url);
  if (!m) return null;
  const src = path.join(station, 'media', m[1]);
  const dst = path.join(outDir, m[1]);
  if (!fs.existsSync(src)) return null;
  if (!fs.existsSync(dst)) { fs.copyFileSync(src, dst); copied++; }
  return `media/station/${m[1]}`;
};
const isVideo = (u) => /\.(mp4|webm|gif|webp)$/i.test(u || '');

const stats = circuit?.stats || {};
const clubs = Object.fromEntries((circuit?.clubs || []).map(c => [c.id, c]));
const comics = comedians.filter(c => stats[c.id] || c.headshotUrl).map(c => {
  const s = stats[c.id] || {};
  return {
    id: c.id, name: c.name, tagline: c.tagline, style: c.style, look: c.look,
    headshot: media(c.headshotUrl) || media(c.avatarImage), stage: s.stage || null, elo: Math.round(s.elo || 0),
    wins: s.wins || 0, titles: s.titles || 0, champion: circuit?.champion === c.id,
    mood: s.inner?.felt ? { label: s.inner.felt.label, valence: s.inner.felt.valence, arousal: s.inner.felt.arousal } : null,
    thought: s.inner?.stream?.[0]?.text || s.journal?.[0]?.text || null
  };
}).sort((a, b) => b.elo - a.elo);
const nameOf = Object.fromEntries(comedians.map(c => [c.id, c.name]));

// Every clip and still, newest first, with what it shows.
const clips = [], stills = [];
const seen = new Set();
const add = (list, url, meta) => { const u = media(url); if (!u || seen.has(u)) return; seen.add(u); list.push({ src: u, ...meta }); };
for (const sh of shows) {
  const club = clubs[sh.clubId];
  for (const p of sh.performances || []) {
    const meta = { comic: nameOf[p.comedianId] || 'A comic', comedianId: p.comedianId, title: p.title, club: club?.name || '', format: sh.format, night: sh.night, score: p.final, text: (p.text || '').slice(0, 600), at: sh.endedAt || sh.startedAt };
    for (const c of p.clips || []) add(clips, c.url, { ...meta, move: c.move });
    if (p.videoUrl) add(clips, p.videoUrl, meta);
    if (p.imageUrl) add(stills, p.imageUrl, meta);
  }
}
const originals = [], specials = [];
for (const s of sets.sort((a, b) => b.createdAt - a.createdAt)) {
  const comic = nameOf[s.comedianId] || 'A comic';
  if (s.premium) {
    const p = s.premium;
    const plates = (p.plates || []).map(x => ({ camera: x.camera, src: media(x.imageUrl), method: x.method })).filter(x => x.src);
    const shotClips = (p.shots || []).filter(x => x.clipUrl).map(x => ({ camera: x.camera, src: media(x.clipUrl), phase: x.phase, seconds: x.seconds, chapter: x.chapter })).filter(x => x.src);
    for (const c of shotClips) add(clips, c.src.replace('media/station/', '/api/station/media/'), { comic, title: s.title, club: p.bible?.theater || '', format: 'original', camera: c.camera, at: p.updatedAt });
    originals.push({
      id: s.id, comic, comedianId: s.comedianId, title: s.title, logline: s.logline, stage: p.stage, theater: p.bible?.theater, city: p.bible?.city,
      grade: p.bible?.grade, palette: p.bible?.palette, keyArt: media(p.keyArt) || plates.find(x => x.camera === 'master')?.src || null,
      minutes: p.script ? Math.round(p.script.seconds / 60) : p.targetMinutes, chapters: (p.script?.chapters || []).map(ch => ch.title),
      sample: (p.script?.chapters?.[0]?.beats || []).slice(0, 6).map(b => ({ kind: b.kind, line: b.line, laugh: b.laugh })),
      plates, clips: shotClips.slice(0, 60), shots: (p.shots || []).length, done: (p.shots || []).filter(x => x.status === 'done').length
    });
  } else if (s.generatedBy === 'autopilot' && s.title !== 'Live on the Circuit') {
    for (const b of s.bits || []) {
      const meta = { comic, title: b.title, club: s.title, format: 'special', score: b.laughScore, text: (b.description || '').slice(0, 600), at: s.updatedAt };
      for (const c of b.clips || []) add(clips, c.url, { ...meta, move: c.move });
      if (b.videoUrl) add(clips, b.videoUrl, meta);
      if (b.imageUrl) add(stills, b.imageUrl, meta);
    }
    specials.push({ id: s.id, comic, title: s.title, logline: s.logline, bits: (s.bits || []).length, cover: media(s.bits?.find(b => b.imageUrl)?.imageUrl) });
  }
}
// Headshots and any other stills from circuit sets.
for (const s of sets) for (const b of s.bits || []) if (b.imageUrl) add(stills, b.imageUrl, { comic: nameOf[s.comedianId] || 'A comic', title: b.title, club: s.title, score: b.laughScore, at: s.updatedAt });
for (const c of comics) if (c.headshot && !seen.has(c.headshot)) stills.push({ src: c.headshot, comic: c.name, title: 'Headshot', at: 0 });

const world = circuit?.world ? {
  places: Object.values(circuit.world.places || {}).map(p => ({ name: p.name, kind: p.kind, canon: p.canon, anchor: media(p.anchor) })),
  things: Object.values(circuit.world.things || {}).map(t => ({ name: t.name, owner: nameOf[t.ownerId] || null, canon: t.canon, anchor: media(t.anchor) })).slice(0, 40)
} : null;

const out = {
  builtAt: Date.now(), night: circuit?.night || 0, champion: nameOf[circuit?.champion] || null,
  era: circuit?.era?.current ? { name: circuit.era.current.name, doctrine: circuit.era.current.doctrine } : null,
  comics, clubs: Object.values(clubs).map(c => ({ id: c.id, name: c.name, venue: c.venue, prestige: c.prestige, crowd: c.crowd })),
  clips: clips.sort((a, b) => (b.at || 0) - (a.at || 0)), stills: stills.sort((a, b) => (b.at || 0) - (a.at || 0)),
  shows: shows.slice(0, 40).map(sh => ({ night: sh.night, club: clubs[sh.clubId]?.name, format: sh.format, theme: sh.theme, headline: sh.headline, winner: nameOf[sh.winnerId] || null,
    sets: (sh.performances || []).map(p => ({ comic: nameOf[p.comedianId], headshot: comics.find(c => c.id === p.comedianId)?.headshot || null, title: p.title, score: p.final, rank: p.rank, moments: (p.moments || []).slice(0, 2), still: media(p.imageUrl), clip: media(p.clips?.[0]?.url || p.videoUrl), line: (p.text || '').split(/(?<=[.!?])\s+/)[0]?.slice(0, 180) })) })),
  originals, specials, world,
  events: (circuit?.events || []).slice(0, 40).map(e => ({ kind: e.kind, text: e.text, night: e.night }))
};

fs.writeFileSync(path.join(root, 'landing', 'station.js'), `// Generated by npm run landing, ${new Date().toISOString()}\nwindow.STATION = ${JSON.stringify(out).replace(/\s*—\s*/g, ', ')};\n`);   // model prose, plain punctuation
console.log(`landing/station.js: ${comics.length} comics · ${clips.length} clips · ${stills.length} stills · ${out.shows.length} shows · ${originals.length} Originals · copied ${copied} new files`);
