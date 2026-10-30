// =====================================================================
// The demo engines, in the browser — for the hosted web demo
// (`npm run build:web`), where there is no Node bridge to run
// scripts/mock-engines.mjs. Same writing, same pixels, same routes:
//
//   Nightshift  /v1/models, /v1/meterless/classes, /v1/meterless/transforms,
//               chat (JSON or SSE), jobs → materialize → makes → artifacts
//   ComfyUI     /system_stats, /object_info, /models, /prompt, /history,
//               /view, /upload/image, and a fake /ws progress socket
//
// Requests arrive as (method, path, body) from web/demo-shim.ts and come
// back as real Response objects, so the app cannot tell the difference.
// =====================================================================

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const enc = new TextEncoder();

// ---------------------------------------------------------------------
// pixels: a procedural comedy stage, a PNG via canvas, a GIF encoder
// ---------------------------------------------------------------------

function rng(seed: number) { let s = seed >>> 0 || 1; return () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) ^ Math.imul(s ^ (s >>> 13), 3266489909)) >>> 0) / 4294967296; }
function hashStr(s: string) { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

const PALETTES = [
  { wall: [122, 46, 28], shirt: [40, 70, 140] }, { wall: [59, 42, 122], shirt: [180, 60, 50] },
  { wall: [15, 76, 117], shirt: [230, 190, 60] }, { wall: [107, 91, 42], shirt: [30, 120, 90] },
  { wall: [194, 96, 61], shirt: [70, 40, 110] }, { wall: [45, 106, 79], shirt: [200, 200, 205] }
];

/** A comedian on a stage, deterministic per prompt. `noise` 0..1 for previews. RGB bytes. */
function drawStage(w: number, h: number, prompt: string, noise = 0): Uint8Array {
  const r = rng(hashStr(prompt));
  const pal = PALETTES[Math.floor(r() * PALETTES.length)];
  const portrait = h > w;
  const cx = w * (0.42 + r() * 0.16), head = (portrait ? 0.11 : 0.085) * h;
  const headY = h * (portrait ? 0.34 : 0.36), skin = [150 + r() * 90, 110 + r() * 70, 90 + r() * 60];
  const hair = [r() * 80, r() * 60, r() * 40];
  const out = new Uint8Array(w * h * 3);
  const nr = rng(hashStr(prompt) ^ 99);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / w, v = y / h;
      let c: number[];
      if (v < 0.78) {
        const by = Math.floor(y / (h / 22)), bx = Math.floor((x + (by % 2) * (w / 24)) / (w / 12));
        const mortar = (y % Math.round(h / 22) < 2) || ((x + (by % 2) * (w / 24)) % Math.round(w / 12) < 2);
        const shade = 0.55 + ((bx * 7 + by * 13) % 5) * 0.05;
        c = pal.wall.map(ch => ch * (mortar ? 0.35 : shade));
      } else {
        c = [22, 18, 16];
      }
      const dx = (u - cx / w) * 1.6, dy = v - 0.05;
      const spot = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy * 0.6) * 1.35);
      c = c.map((ch, i) => ch * (0.25 + spot * 1.1) + [255, 210, 150][i] * spot * 0.35);
      const bodyTop = headY + head * 1.05, bodyW = head * 1.35 * (1 + (v - bodyTop / h) * 0.9);
      if (y > bodyTop && y < h * 0.86 && Math.abs(x - cx) < bodyW) c = pal.shirt.map(ch => ch * (0.5 + spot * 0.8));
      const ax = cx + head * 1.4, ay = headY + head * 1.8;
      if (Math.abs((x - ax) - (y - ay) * -0.6) < head * 0.35 && y > headY + head * 0.6 && y < ay + head) c = pal.shirt.map(ch => ch * 0.7);
      if (Math.hypot(x - (cx + head * 0.9), y - (headY + head * 0.7)) < head * 0.28) c = [20, 20, 22];
      const hd = Math.hypot((x - cx) / 0.85, y - headY);
      if (hd < head) c = (y < headY - head * 0.35) ? hair : skin.map(ch => ch * (0.55 + spot * 0.6));
      const sx = cx - head * 2.6;
      if (Math.abs(x - sx) < 2 && y > headY + head && y < h * 0.82) c = [30, 30, 32];
      const crowd = h * 0.9 + Math.sin(u * 22) * h * 0.035;
      if (y > crowd) c = [6, 6, 7];
      if (noise > 0) c = c.map(ch => ch * (1 - noise) + nr() * 255 * noise);
      const o = (y * w + x) * 3;
      out[o] = Math.max(0, Math.min(255, c[0])); out[o + 1] = Math.max(0, Math.min(255, c[1])); out[o + 2] = Math.max(0, Math.min(255, c[2]));
    }
  }
  return out;
}

async function stillPng(prompt: string, w = 512, h = 384, noise = 0): Promise<Blob> {
  const rgb = drawStage(w, h, prompt, noise);
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) { rgba[j] = rgb[i]; rgba[j + 1] = rgb[i + 1]; rgba[j + 2] = rgb[i + 2]; rgba[j + 3] = 255; }
  const img = new ImageData(rgba, w, h);
  if (typeof OffscreenCanvas !== 'undefined') {
    const cv = new OffscreenCanvas(w, h);
    cv.getContext('2d')!.putImageData(img, 0, 0);
    return cv.convertToBlob({ type: 'image/png' });
  }
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  cv.getContext('2d')!.putImageData(img, 0, 0);
  return new Promise((res, rej) => cv.toBlob(b => (b ? res(b) : rej(new Error('canvas'))), 'image/png'));
}

// GIF89a with a 6×6×6 palette; LZW after omggif.
function lzw(indices: number[], minCode: number, out: number[]) {
  const clear = 1 << minCode, eoi = clear + 1;
  let next = eoi + 1, size = minCode + 1, cur = 0, shift = 0, table = new Map<number, number>();
  const bytes: number[] = [];
  const emit = (code: number) => { cur |= code << shift; shift += size; while (shift >= 8) { bytes.push(cur & 255); cur >>>= 8; shift -= 8; } };
  emit(clear);
  let ib = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i], key = (ib << 8) | k, code = table.get(key);
    if (code === undefined) {
      emit(ib);
      if (next === 4096) { emit(clear); next = eoi + 1; size = minCode + 1; table = new Map(); }
      else { if (next >= (1 << size)) size++; table.set(key, next++); }
      ib = k;
    } else ib = code;
  }
  emit(ib); emit(eoi);
  if (shift > 0) bytes.push(cur & 255);
  out.push(minCode);
  for (let i = 0; i < bytes.length; i += 255) { const blk = bytes.slice(i, i + 255); out.push(blk.length); for (const b of blk) out.push(b); }
  out.push(0);
}

function zoomGif(prompt: string, frames = 28, w = 320, h = 240, move = 'dolly'): Uint8Array {
  const src = drawStage(w, h, prompt);
  const out: number[] = [...enc.encode('GIF89a'), w & 255, w >> 8, h & 255, h >> 8, 0xf7, 0, 0];
  for (let i = 0; i < 256; i++) { const r = Math.floor(i / 36) % 6, g = Math.floor(i / 6) % 6, b = i % 6; out.push(...(i < 216 ? [r * 51, g * 51, b * 51] : [0, 0, 0])); }
  out.push(0x21, 0xff, 0x0b, ...enc.encode('NETSCAPE2.0'), 0x03, 0x01, 0, 0, 0);
  for (let f = 0; f < frames; f++) {
    const t = f / (frames - 1);
    const z = move === 'crash' ? (t < 0.5 ? 1 : 1.7) : 1 + 0.35 * t;
    const sway = move === 'handheld' ? Math.sin(t * 20) * 3 : move === 'orbit' ? (t - 0.5) * 40 : 0;
    const idx = new Array<number>(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const sx = Math.min(w - 1, Math.max(0, Math.round((x - w / 2) / z + w / 2 + sway)));
      const sy = Math.min(h - 1, Math.max(0, Math.round((y - h * 0.42) / z + h * 0.42)));
      const o = (sy * w + sx) * 3;
      idx[y * w + x] = Math.round(src[o] / 51) * 36 + Math.round(src[o + 1] / 51) * 6 + Math.round(src[o + 2] / 51);
    }
    out.push(0x21, 0xf9, 0x04, 0x04, 7, 0, 0, 0);
    out.push(0x2c, 0, 0, 0, 0, w & 255, w >> 8, h & 255, h >> 8, 0);
    lzw(idx, 8, out);
  }
  out.push(0x3b);
  return Uint8Array.from(out);
}

// ---------------------------------------------------------------------
// audio
// ---------------------------------------------------------------------

function wav(samples: ArrayLike<number>, rate = 22050): Uint8Array {
  const b = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) b.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); b.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 1, true); b.setUint32(24, rate, true);
  b.setUint32(28, rate * 2, true); b.setUint16(32, 2, true); b.setUint16(34, 16, true); str(36, 'data'); b.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) b.setInt16(44 + i * 2, Math.max(-32767, Math.min(32767, Math.round(samples[i] * 32767))), true);
  return new Uint8Array(b.buffer);
}

/** Murmured "speech": soft syllable-shaped bursts at a talking pace, so captions sync. */
function speechWav(text: string) {
  const rate = 22050, words = text.split(/\s+/).filter(Boolean).length || 4;
  const secs = Math.max(2, words / 2.7), n = Math.round(secs * rate);
  const r = rng(hashStr(text));
  const s = new Float32Array(n);
  let syl = 0, sylLen = 0, f0 = 150 + r() * 60;
  for (let i = 0; i < n; i++) {
    if (i >= syl + sylLen) { syl = i; sylLen = Math.round(rate * (0.12 + r() * 0.14)); f0 = 130 + r() * 90; }
    const p = (i - syl) / sylLen, env = Math.sin(Math.PI * p) ** 2 * (r() < 0.002 ? 0 : 1);
    const t = i / rate;
    s[i] = env * 0.18 * (Math.sin(2 * Math.PI * f0 * t) * 0.6 + Math.sin(2 * Math.PI * f0 * 2.1 * t) * 0.25 + Math.sin(2 * Math.PI * f0 * 3.3 * t) * 0.1);
  }
  return wav(s, rate);
}

/** A short brassy walk-on sting. */
function musicWav() {
  const rate = 22050, bpm = 132, beat = 60 / bpm, notes = [0, 4, 7, 12, 7, 4, 0, 7, 9, 12, 16, 12, 9, 7, 12, 19];
  const n = Math.round(notes.length * beat * 0.5 * rate + rate);
  const s = new Float32Array(n);
  notes.forEach((semi, k) => {
    const f = 220 * 2 ** (semi / 12), start = Math.round(k * beat * 0.5 * rate), len = Math.round(beat * 0.5 * rate * 1.6);
    for (let i = 0; i < len && start + i < n; i++) {
      const t = i / rate, env = Math.exp(-3 * t) * Math.min(1, i / 200);
      s[start + i] += env * 0.18 * (Math.sin(2 * Math.PI * f * t) + 0.5 * Math.sin(4 * Math.PI * f * t) + 0.3 * Math.sin(6 * Math.PI * f * t));
    }
    if (k % 2 === 0) for (let i = 0; i < 1500; i++) s[start + i] += (Math.random() - 0.5) * 0.25 * Math.exp(-i / 300);
  });
  return wav(s, rate);
}

// ---------------------------------------------------------------------
// real footage: the Station's own frames, packed by `npm run build:web`
// into demo-media/. Every render prompt carries the comic's look, so each
// comic gets their own face back; the procedural stage is the fallback.
// ---------------------------------------------------------------------

export interface MediaComic { name: string; tagline: string; look: string; headshot: string; stills: string[]; clips: string[] }
let media: MediaComic[] = [];
export const demoMedia = () => media;

export async function loadDemoMedia(): Promise<void> {
  try {
    const r = await fetch('./demo-media/manifest.json', { cache: 'no-cache' });
    if (r.ok) media = ((await r.json())?.comics || []).filter((c: MediaComic) => c.headshot && c.look);
  } catch { /* procedural frames */ }
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ');

/** Whose frames a prompt asks for: by look, else by name, else (unless strict) a stable pick. */
function comicFor(prompt: string, strict = false): MediaComic | null {
  if (!media.length) return null;
  const p = norm(prompt);
  return media.find(c => p.includes(norm(c.look).slice(0, 48)))
    || media.find(c => p.includes(c.name.toLowerCase()))
    || (strict ? null : media[hashStr(p.slice(0, 160)) % media.length]);
}

const blobs = new Map<string, Promise<Blob>>();
function load(url: string): Promise<Blob> {
  if (!blobs.has(url)) blobs.set(url, fetch(url).then(r => { if (!r.ok) throw new Error(url); return r.blob(); }));
  return blobs.get(url)!;
}

async function realStill(prompt: string, portrait = false): Promise<Blob | null> {
  const c = comicFor(prompt);
  if (!c) return null;
  const pool = portrait || /portrait headshot/i.test(prompt) || !c.stills.length ? [c.headshot] : c.stills;
  return load(pool[hashStr(prompt) % pool.length]).catch(() => null);
}

async function realClip(prompt: string): Promise<{ data: Blob; ext: string } | null> {
  const c = comicFor(prompt);
  if (!c) return null;
  if (c.clips.length) {
    const data = await load(c.clips[hashStr(prompt) % c.clips.length]).catch(() => null);
    return data ? { data, ext: 'mp4' } : null;
  }
  // No footage of this comic yet: a slow push-in on one of their stills.
  const still = await realStill(prompt);
  return still ? pushIn(still, hashStr(prompt)).catch(() => null) : null;
}

function canvas(w: number, h: number) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  return { cv, ctx: cv.getContext('2d')! };
}

/** A few seconds of camera push recorded from a canvas (WebM, or MP4 on Safari). */
async function pushIn(still: Blob, seed: number, seconds = 3): Promise<{ data: Blob; ext: string } | null> {
  if (typeof MediaRecorder === 'undefined') return null;
  const type = ['video/webm;codecs=vp9', 'video/webm', 'video/mp4'].find(t => MediaRecorder.isTypeSupported(t));
  if (!type) return null;
  const img = await createImageBitmap(still);
  const { cv, ctx } = canvas(768, 512);
  const rec = new MediaRecorder(cv.captureStream(30), { mimeType: type, videoBitsPerSecond: 3_000_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const stopped = new Promise(r => { rec.onstop = r; });
  const fx = 0.35 + (seed % 30) / 100;   // where the push lands
  const draw = (t: number) => {
    const s = Math.max(cv.width / img.width, cv.height / img.height) * (1.04 + 0.14 * t);
    const w = img.width * s, h = img.height * s;
    ctx.drawImage(img, (cv.width - w) * fx, (cv.height - h) * 0.4, w, h);
  };
  draw(0);
  rec.start();
  const t0 = performance.now();
  await new Promise<void>(done => {
    const tick = () => { const t = Math.min(1, (performance.now() - t0) / (seconds * 1000)); draw(t); if (t < 1) setTimeout(tick, 33); else done(); };
    tick();
  });
  rec.stop();
  await stopped;
  img.close();
  return { data: new Blob(chunks, { type: type.split(';')[0] }), ext: type.includes('mp4') ? 'mp4' : 'webm' };
}

/** A sampler preview: the real frame under noise that clears as the steps run. */
async function noisyPreview(still: Blob, noise: number): Promise<Uint8Array> {
  const img = await createImageBitmap(still);
  const { cv, ctx } = canvas(192, 128);
  ctx.drawImage(img, 0, 0, 192, 128);
  img.close();
  const px = ctx.getImageData(0, 0, 192, 128);
  for (let i = 0; i < px.data.length; i += 4) for (let k = 0; k < 3; k++) px.data[i + k] = px.data[i + k] * (1 - noise) + Math.random() * 255 * noise;
  ctx.putImageData(px, 0, 0);
  const blob = await new Promise<Blob>((res, rej) => cv.toBlob(b => (b ? res(b) : rej(new Error('canvas'))), 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

const extOf = (b: Blob) => (b.type === 'image/jpeg' ? 'jpg' : b.type === 'image/webp' ? 'webp' : 'png');

// ---------------------------------------------------------------------
// writing: canned but genuinely written comedians (kept in step with
// scripts/mock-engines.mjs)
// ---------------------------------------------------------------------

type Comic = { name: string; tagline: string; voice: string; style: string; audience: string; look: string; setTitle: string; setLogline: string; material: string[][]; bits: string[][] };

const COMICS: Comic[] = [
  {
    name: 'Marjorie Pell', tagline: 'Kindergarten teacher. Treats the audience accordingly.', voice: 'sing-song calm that curdles into menace', style: 'observational', audience: 'parents, teachers, anyone who has been a toddler',
    look: 'a woman in her late 40s with a sensible grey bob, red cardigan over a floral dress, lanyard full of keys, reading glasses on a beaded chain',
    setTitle: 'Inside Voices', setLogline: 'Adults are just toddlers with car keys.',
    material: [['Circle Time', 'BIT', 'Running the audience like a classroom'], ['The Glitter Incident', 'BIT', 'A 2009 event still under investigation'], ['Gerald', 'PERSONA', 'A five-year-old with the confidence of a hedge-fund manager'], ['Sticker Chart', 'PROP', 'Her system for rating husbands'], ['Inside voices', 'CATCHPHRASE', 'Whispered before every punchline'], ['Parent emails', 'THEME', 'Passive aggression at scale'], ['Snack time', 'THEME', 'Goldfish crackers as currency'], ['Room 4B', 'VENUE', 'Where dreams go to nap']],
    bits: [
      ['Circle Time', 'I teach kindergarten, so I already know how tonight goes. Somebody in the front is going to cry, somebody in the back is going to eat something that is not food, and at least one of you is going to tell me about your dog for nine minutes. Sir. Sir. We are not doing show-and-tell with your ex.', 'pointing at the front row like a disappointed teacher'],
      ['Sticker Chart', 'I put my husband on a sticker chart. Not to be mean — it works! He gets a gold star for loading the dishwasher, a silver star for loading it correctly, and if he fills a whole row, he gets to pick the movie. He has never filled a row. He has, however, learned to forge stickers. That is not growth. That is fraud with a smiley face.', 'holding up an imaginary sticker sheet'],
      ['Parent Emails', 'Parent emails are a hostage negotiation with spell-check. "Hi Mrs. Pell, just circling back on why Brayden was not chosen as line leader." Because Brayden led the line into the fountain, Karen. He did not lead. He launched.', 'typing furiously on an invisible keyboard'],
      ['Gerald', 'Gerald is five and he negotiates like he has lawyers. I said, "Gerald, two more minutes on the swings." He said, "Let us call it five and I won\'t tell anyone about the coffee in your water bottle." Gerald. That is not water. That is how you are still alive.', 'crouching down to eye level with an invisible child']
    ]
  },
  {
    name: 'Dez Okafor', tagline: 'Retired astronaut. Still terrible at small talk.', voice: 'precise mission-control deadpan', style: 'deadpan', audience: 'nerds, introverts, people who hate parties',
    look: 'a broad-shouldered man in his 50s with a shaved head and grey stubble, faded NASA bomber jacket over a plain black tee, aviator watch, very upright posture',
    setTitle: 'Houston, We Have Small Talk', setLogline: 'Space was easy. Brunch is hard.',
    material: [['Re-entry', 'THEME', 'Returning to normal life after orbit'], ['The ISS toilet', 'PROP', 'A two-million-dollar vacuum with trust issues'], ['Brunch', 'VENUE', 'The most hostile environment he has visited'], ['Mission Control', 'PERSONA', 'The voice in his head narrating every conversation'], ['Negative, Houston', 'CATCHPHRASE', 'His answer to every invitation'], ['Gravity', 'THEME', 'Overrated'], ['Freeze-dried ice cream', 'PROP', 'His only souvenir and greatest regret']],
    bits: [
      ['Small Talk', 'I spent 200 days in orbit. I trained for fires, for depressurization, for a debris strike. Nobody trained me for "So what do you do?" at a barbecue. I said, "I was an astronaut." The guy said, "Cool, I\'m in logistics." And then we stood there. Two professionals. Both moving things through space. Only one of us ever got to leave.', 'standing at rigid attention holding an invisible paper plate'],
      ['Re-entry', 'Coming back to Earth is brutal. Your legs forget their job. For the first week I walked like a newborn giraffe that owes money. My wife said, "You look drunk." I said, "No. I am experiencing gravity." She said, "That is what drunk people say."', 'wobbling across the stage on purpose'],
      ['Brunch', 'Brunch is the most dangerous environment I have ever entered. In space, the air is trying to kill you, but at least it is honest about it. At brunch, everyone smiles while they fight over the bill. A woman split a twelve-dollar mimosa into thirds. I have seen orbital mechanics simpler than that math.', 'squinting at an imaginary receipt'],
      ['Mission Control', 'I still hear Mission Control in my head. Date night: "Dez, you are cleared to compliment the dress." I say, "Nice dress." Mission Control: "Negative, Dez. That was the curtains."', 'pressing an earpiece and nodding seriously']
    ]
  },
  {
    name: 'Tilly Vance', tagline: 'Wedding DJ in the middle of an existential crisis.', voice: 'manic hype-man energy that keeps collapsing into despair', style: 'absurdist', audience: 'millennials who have been to too many weddings',
    look: 'a wiry woman in her early 30s with a neon-green buzzcut, oversized sequined blazer, giant headphones around her neck, glitter on one cheek',
    setTitle: 'Play It Again, Uncle Rick', setLogline: 'Every wedding is the same wedding and she is the only one who knows.',
    material: [['Uncle Rick', 'PERSONA', 'Requests the same song at every wedding she has ever played'], ['The Electric Slide', 'BIT', 'A dance she believes is a cult'], ['Open bar', 'THEME', 'A countdown clock to chaos'], ['The bouquet toss', 'BIT', 'Organized violence with flowers'], ['Is this the drop?', 'CATCHPHRASE', 'Her plea to the universe'], ['Banquet hall B', 'VENUE', 'She has played it 400 times']],
    bits: [
      ['Uncle Rick', 'Every wedding has an Uncle Rick. Different families, different states — same Rick. He walks up at 9:47, he asks for "Brown Eyed Girl," and he tips me a single folded twenty like it is a secret. I have started to think Rick is not a man. Rick is a system. Rick is how weddings know they are weddings.', 'leaning over an imaginary DJ booth'],
      ['The Electric Slide', 'Nobody teaches the Electric Slide. Nobody has ever learned it. And yet, the second it starts, eighty people turn the same direction at the same time. That is not a dance. That is a cult with a choreographer. I played it once by accident and a groomsman whispered, "It is time."', 'doing the slide in slow, ominous steps'],
      ['Bouquet Toss', 'The bouquet toss is the only time it is socially acceptable to body-check a bridesmaid. I have seen a grandmother box out a college athlete. Ninety years old. Elbows like a defensive lineman. She caught it, looked me dead in the eye, and said, "Play something slow, I have plans."', 'miming a dramatic catch'],
      ['Is This The Drop?', 'I DJ\'d nine weddings this month. I am starting to feel like the song never ends. Like I am always one bar away from the drop. My therapist asked how I am doing. I said, "Is this the drop?" She said, "We have twenty minutes left." I said, "Then build it, Debra."', 'clutching the headphones with both hands']
    ]
  }
];

const JOKE_SHAPES = [
  (topic: string, c: Comic) => `You know what nobody tells you about ${topic}? It is exactly like ${c.material[0][0].toLowerCase()}, except everyone is pretending it is fine. I tried to explain that at a party and a man slowly backed into a fern. Not away from me — into the fern. He chose the fern.`,
  (topic: string) => `I have a theory about ${topic}. It is not a good theory. My therapist called it "a lot." My mother called it "very you." My landlord called the police. Three reviews, all accurate.`,
  (topic: string) => `People keep asking how I feel about ${topic}. I feel about it the way a cat feels about a bath: politely furious, and planning something you will find later.`
];

function castJson(prompt: string) {
  const idea = (prompt.match(/Build the comedian around this idea: "([^"]+)"/) || [])[1] || '';
  const c = /astronaut|space|nasa|small talk/i.test(idea) ? COMICS[1]
    : /dj|wedding|party|music/i.test(idea) ? COMICS[2]
    : /teacher|school|kid|parent/i.test(idea) ? COMICS[0]
    : COMICS[hashStr(prompt + Date.now()) % COMICS.length];
  return JSON.stringify({
    name: c.name, tagline: c.tagline, voice: c.voice, style: c.style, audience: c.audience, look: c.look,
    material: c.material.map(([name, type, description]) => ({ name, type, description })),
    setTitle: c.setTitle, setLogline: c.setLogline,
    bits: c.bits.map(([title, description, action]) => ({ title, description, action }))
  }, null, 2);
}

const SET_SHAPES = [
  (t: string, me: boolean) => `You ever notice ${t} is designed by someone who hates you personally? I tried to be calm about ${t}. I lasted four seconds. Then I said my own name out loud, like a villain in a parking garage. ${me ? `My mentor would have walked out.` : ''} And the worst part? It worked.`,
  (t: string) => `I have a theory about ${t}: nobody has ever enjoyed it, we just agreed to pretend, like jazz. My therapist says I catastrophize. I said, "Name one thing about ${t} that isn't a catastrophe." She's still thinking. I'm still paying.`,
  (t: string) => `${t[0].toUpperCase() + t.slice(1)} is just a group project where everyone else is the dog. You know who wins at ${t}? Nobody. You know who loses? Me, specifically, every Tuesday, in public, with witnesses.`,
  (t: string) => `My dad thinks ${t} is a government test. He's not wrong. He failed it in 1994 and they never told him the results. He just got a letter that said "we'll call you." Thirty years. Phone's right there, Gerald.`
];

function setJson(text: string, seq = 0) {
  const name = (text.match(/You are ([^,]+), a stand-up comedian/) || [])[1] || 'the comic';
  const theme = (text.match(/Tonight's theme: ([^.\n]+)/) || [])[1] || 'life';
  const roast = (text.match(/Roast ([^—\n]+?) —/) || [])[1];
  if (roast) {
    const lines = [`${roast.trim()} looks like the before picture in an ad for a product that doesn't work. I'm not saying they're boring, but their mirror asked for a transfer. Give it up for ${roast.trim()}, everybody — someone has to.`,
      `${roast.trim()}, I've seen funnier terms and conditions. You have the stage presence of a screensaver. The only thing you've ever killed is a houseplant, and it filed a complaint.`];
    return JSON.stringify({ title: `The ${roast.trim().split(' ')[0]} Problem`, text: lines[(hashStr(name) + seq) % lines.length] });
  }
  const shape = SET_SHAPES[(hashStr(name + theme) + seq) % SET_SHAPES.length];
  const titles = ['Explained', 'Is A Cult', 'Ruined My Life', 'Needs A Manager', 'Is My Nemesis'];
  const tcase = theme.split(' ').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
  return JSON.stringify({ title: `${tcase} ${titles[(hashStr(name) + seq) % titles.length]}`, text: workTheRoom(text, shape(theme, /trained under/.test(text)), name) });
}

/** The Room brief asks for stage directions and crowd work: a mock comic does a little of both. */
function workTheRoom(brief: string, set: string, name: string) {
  if (!/TIMING: mark your delivery/.test(brief)) return set;
  const h = hashStr(name + set);
  const who = (brief.match(/WHO IS IN THE ROOM: (?:an? |the )?([^(;]+?) \(/) || [])[1];
  const happens = (brief.match(/SOMETHING HAPPENS DURING YOUR SET: (?:an? )?([^.—]+)/) || [])[1];
  const sentences = set.split(/(?<=[.?!])\s+/);
  const last = sentences.pop();
  const cues = ['[beat]', '[hold]', '[act-out]', '[stare]'];
  let out = sentences.map((x, i) => (i % 2 === 1 ? `${x} ${cues[(h + i) % cues.length]}` : x)).join(' ');
  if (who && h % 3 !== 0) out += ` [to the crowd] And you — yes, the ${who.trim().split(' ').slice(0, 4).join(' ')} — you know exactly what I mean.`;
  if (happens && h % 2 === 0) out += ` [riff] Oh good, ${happens.trim()}. Perfect timing. That's my whole life.`;
  return `${out} [beat] ${last} [hold]`;
}

function panelJson(text: string) {
  const n = (text.match(/^\d+\. /gm) || []).length || 2;
  const lines: Record<string, string[]> = { booker: ['Tight structure. I would book that tomorrow.', 'Premise is fine, the turn needs work.', 'Original angle — that is a closer.'],
    critic: ['A real point of view, finally.', 'Clever, but I saw the punchline coming.', 'The callback earned it. Lovely craft.'],
    heckler: ['I LAUGHED. Do not tell anyone.', 'Boo! Kidding. Mostly.', 'My beer went out my nose. Ten.'] };
  return JSON.stringify({ sets: Array.from({ length: n }, (_, i) => {
    const h = hashStr(text + i);
    const cell = (k: string, o: number) => ({ score: Math.round((4.5 + ((h >>> o) % 50) / 10) * 10) / 10, line: lines[k][(h >>> o) % 3] });
    return { n: i + 1, booker: cell('booker', 1), critic: cell('critic', 3), heckler: cell('heckler', 5) };
  }) });
}

function comicJson(text: string) {
  const first = ['Ari', 'Bo', 'Cass', 'Dante', 'Esme', 'Finn', 'Gigi', 'Imani', 'Kit', 'Nell'], last = ['Abara', 'Cho', 'Fairley', 'Moreau', 'Nwosu', 'Sato', 'Quintero', 'Lindqvist'];
  const h = hashStr(text + Date.now());
  const apprentice = /APPRENTICE/.test(text);
  // In the web demo a newcomer wears a Station comic's look, so their renders come back as real footage.
  const borrowed = media.length ? media[(h >>> 8) % media.length].look : null;
  return JSON.stringify({
    name: `${first[h % first.length]} ${last[(h >>> 4) % last.length]}`,
    tagline: apprentice ? 'Learned from the best. Plans to beat them.' : 'First open mic tonight. No notes. Big dreams.',
    voice: 'quick, wry, a little too honest', style: ['observational', 'absurdist', 'dark', 'storytelling'][h % 4], audience: 'night owls and underdogs',
    look: borrowed || 'a young comedian in a thrifted corduroy jacket, round glasses, notebook in the back pocket',
    doctrine: apprentice ? 'The old school, sped up: every setup is also a punchline.' : 'Tell the truth, then make it weirder.',
    material: [{ name: 'Day job', type: 'THEME', description: 'Temping at a call center for a company that sells call centers' }, { name: 'Roommate Dev', type: 'PERSONA', description: 'Has a podcast. Has never had a listener.' }]
  });
}

function bibleJson(text: string) {
  const h = hashStr(text);
  const theaters = [['The Orpheum', 'Los Angeles'], ['The Beacon', 'New York'], ['The Riviera', 'Chicago'], ['The Paramount', 'Austin']];
  const [theater, city] = theaters[h % theaters.length];
  return JSON.stringify({
    theater, city,
    stage: 'a gilded proscenium with a wall of warm marquee bulbs in an art-deco pattern, one chrome mic stand, a bar stool and a glass of water',
    lighting: 'a hard follow spot from the balcony, amber front fill and deep teal backlights cutting through haze',
    grade: 'warm amber skin against teal shadows, rich filmic contrast, gentle halation',
    wardrobe: 'a fitted black suit jacket over a faded band t-shirt, white sneakers',
    crowd: 'a sold-out house of night owls, couples on date night and comedy nerds',
    tagline: 'One night. No retakes.'
  });
}

function outlineJson(text: string) {
  const n = Number((text.match(/EXACTLY (\d+) chunks/) || [])[1]) || 10;
  const name = (text.match(/Comedian ([^—\n]+) —/) || [])[1]?.trim() || 'The Comic';
  const proven = [...text.matchAll(/^\d+\. "([^"]+)"/gm)].map(m => m[1]);
  const extra = ['Hometown Hero', 'The Group Chat', 'My Landlord Has A Podcast', 'Airport Security Knows Me', 'Therapy, Season Two', 'Dating Apps For Raccoons', 'My Dad Learned To Text', 'The Gym Is A Cult', 'Self-Checkout Rage', 'Wedding Toast Disaster', 'Smart Fridge Betrayal', 'Jury Duty', 'Grocery Store Politics'];
  const chapters = Array.from({ length: n }, (_, i) => {
    const from = i < proven.length && i % 2 === 0 ? i + 1 : null;
    const title = i === n - 1 ? 'Coming Home' : from ? proven[from - 1] : extra[(i + hashStr(text)) % extra.length];
    return { title, premise: `${title}: it starts as a small annoyance and escalates until ${name} is the villain of the story.`, from };
  });
  return JSON.stringify({ title: ['Unreasonable Doubt', 'Nobody Asked', 'Loud In A Library', 'Born Ready-ish'][hashStr(text) % 4], logline: `${name} finally gets the big stage and uses it to confess everything.`, chapters });
}

function chunkJson(text: string) {
  const title = (text.match(/Write chunk \d+: "([^"]+)"/) || [])[1] || 'this';
  const target = Number((text.match(/About (\d+) words/) || [])[1]) || 180;
  const closer = /This is the CLOSER/.test(text);
  const opener = /Open by greeting the city/.test(text);
  const t = title.toLowerCase();
  const lines: [string, string, string, number][] = [
    ['setup', `So, ${t}. I need to talk about ${t}, because nobody else will, and somebody has to be the adult here.`, 'leans on the mic stand', 1],
    ['setup', 'Last week it happened again. I am standing there, minding my business, which is a full-time job for me, believe me.', 'mimes holding a coffee', 1.5],
    ['punch', `And a stranger looks me dead in the eye and goes, "You look like someone who has opinions about ${t}." Ma'am, I look like someone who has opinions about lunch.`, 'squints at the front row', 7.6],
    ['tag', "I don't even have opinions about lunch. I have feelings. Lunch has hurt me.", 'hand on heart', 6.4],
    ['actout', 'So now I am that guy, crouched behind a display of discount candles, whispering into my phone like a hostage negotiator.', 'crouches and whispers into the mic', 3],
    ['punch', 'The candle was called "Fresh Linen." It smelled like a hospital that is trying to be your friend.', 'sniffs the air', 8.1],
    ['crowdwork', 'Sir, front row, you know what I mean. You have the face of a man who has bought a candle out of guilt.', 'points to the front row', 5.5],
    ['punch', "He's nodding! He bought it for his wife. It's for him. It's always for him.", 'nods along', 7.9],
    ['setup', "My therapist says I make everything about me. Which is rude, because I'm paying her, so it's literally about me.", 'shrugs', 2],
    ['punch', "That's the deal! I give you money, you look at me like a documentary. That's the whole relationship!", 'spreads arms wide', 8.4],
    ['callback', `And you know what she said? "That sounds like a ${t} problem." Everything is a ${t} problem now.`, 'pauses, deadpan', 8.8]
  ];
  const beats: { kind: string; line: string; cue: string; laugh: number }[] = [];
  if (opener) beats.push({ kind: 'open', line: 'Thank you! Thank you so much, what a night, look at this place. You all dressed up for me? I wore my good socks. We match.', cue: 'waves, takes the mic off the stand', laugh: 6 });
  let words = beats.reduce((a, b) => a + b.line.split(/\s+/).length, 0);
  for (let i = 0; words < target && i < 40; i++) {
    const [kind, line, cue, laugh] = lines[(i + hashStr(title)) % lines.length];
    beats.push({ kind, line, cue, laugh });
    words += line.split(/\s+/).length;
  }
  if (closer) beats.push({ kind: 'close', line: "That's my time. You've been incredible, I'll never forget you, I've already forgotten some of you. Goodnight!", cue: 'puts the mic back in the stand', laugh: 9.2 });
  return JSON.stringify({ beats });
}

function answerFor(body: any, mode: string): string {
  const text = (body.messages || []).map((m: any) => typeof m.content === 'string' ? m.content : (m.content || []).map((p: any) => p.text || '').join(' ')).join('\n');
  if (/continuity supervisor/.test(text)) return JSON.stringify({ face: 'square jaw, deep-set brown eyes, laugh lines', hair: 'short dark hair, greying at the temples', skin: 'warm medium-brown skin', build: 'broad-shouldered, solid', wardrobe: 'a worn olive bomber jacket over a black tee', signature: 'a mission patch on the left sleeve', essence: 'A broad-shouldered man in his fifties with a square jaw, deep-set brown eyes and short dark hair greying at the temples. He wears a worn olive bomber jacket over a black tee, a mission patch on the left sleeve.' });
  if (/production designer and director of photography/.test(text)) return bibleJson(text);
  if (/Outline a \d+-minute special/.test(text)) return outlineJson(text);
  if (/Write chunk \d+:/.test(text)) return chunkJson(text);
  if (/THE PANEL:/.test(text)) return panelJson(text);
  if (/"title": "short bit name", "text"/.test(text)) return setJson(text, body.__seq || 0);
  if (/talent scout/.test(text) && /APPRENTICE|first open mic/.test(text)) return comicJson(text);
  if (/comedy-blog headline/.test(text)) { const about = (text.match(/about tonight: ([^.]+)./) || [])[1] || 'Tonight at the club'; return ['Nobody Was Ready: ', 'Stop Everything — ', 'Instant Classic: '][hashStr(text) % 3] + about; }
  if (/judge/.test(mode) || /Grade it\./.test(text)) {
    const s = 5 + (hashStr(text) % 45) / 10;
    const notes = ['Tag the punchline — one more beat and it is a laugh break.', 'Cut the second sentence; the turn lands faster without it.', 'Great act-out. Hold the pause before the button.', 'Specific detail is doing the work here. More of that.'];
    return JSON.stringify({ score: Math.round(s * 10) / 10, note: notes[hashStr(text) % notes.length] });
  }
  if (/Discover a brand-new stand-up comedian/.test(text)) return castJson(text);
  if (/Write the NEXT bit/.test(text)) {
    const topic = (text.match(/based on: "([^"]+)"/) || [])[1] || 'this';
    const name = (text.match(/Comedian "([^"]+)"/) || [])[1] || 'the comic';
    const c = COMICS.find(x => x.name === name) || COMICS[0];
    const clean = topic.replace(/@/g, '').replace(/[.!]+$/, '');
    return JSON.stringify({ title: clean.split(/\s+/).slice(0, 4).map(w => w[0].toUpperCase() + w.slice(1)).join(' '), description: JOKE_SHAPES[hashStr(topic) % JOKE_SHAPES.length](clean.toLowerCase(), c), action: 'pacing the edge of the stage, mic cord in hand' });
  }
  if (/Pitch the next bit/.test(text)) {
    const mats = [...text.matchAll(/@([^()|]+?) \(/g)].map(m => m[1].trim());
    return JSON.stringify({ instruction: `@${mats[0] || 'the opener'} meets @${mats[1] || 'the crowd'} — escalate until it collapses.` });
  }
  if (/Invent ONE new piece of material/.test(text)) return JSON.stringify({ name: 'The Group Chat', type: 'THEME', description: 'Forty unread messages and one of them is a lawsuit.' });
  return 'Tonight only — catch the new set before it catches you.';
}

// ---------------------------------------------------------------------
// responses
// ---------------------------------------------------------------------

export interface DemoRequest { method: string; path: string; search: URLSearchParams; headers: Headers; body: any }

const json = (status: number, obj: unknown) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
const bytes = (data: Uint8Array | Blob, mime: string) => new Response(data, { status: 200, headers: { 'content-type': mime } });

// ---------------------------------------------------------------------
// Nightshift
// ---------------------------------------------------------------------

const CHAT = { method: 'POST', path: '/v1/chat/completions' };
const MAT = { method: 'POST', path: '/v1/jobs/{id}/materialize' };
const CLASSES: Record<string, any> = {
  text: { availability: 'ready', chat_carrier: true, routes: [CHAT] }, code: { availability: 'ready', chat_carrier: true, routes: [CHAT] },
  vision: { availability: 'ready', chat_carrier: true, routes: [CHAT] }, judge: { availability: 'ready', chat_carrier: true, routes: [CHAT] },
  image: { availability: 'ready', chat_carrier: false, routes: [MAT] }, speech: { availability: 'ready', chat_carrier: false, routes: [MAT] },
  music: { availability: 'ready', chat_carrier: false, routes: [MAT] }, video: { availability: 'unavailable', why: 'no video engine on this box', chat_carrier: false, routes: [] }
};
const TRANSFORMS = [
  { id: 'attempt.doc.markdown', kind: 'markdown', capability: 'document.write_markdown', source: 'attempt', accepts: 'any-text', available: true },
  { id: 'attempt.image.still', label: 'Still image', kind: 'image', capability: 'media.image_still', source: 'attempt', accepts: 'any-text', media: { pipeline: 'still', default_n: 2 }, available: true },
  { id: 'attempt.voice.narrate', label: 'Narrate', kind: 'audio', capability: 'media.voice_narrate', source: 'attempt', accepts: 'any-text', media: { pipeline: 'narrate', default_n: 1 }, available: true },
  { id: 'attempt.music.score', label: 'Score', kind: 'audio', capability: 'media.music_score', source: 'attempt', accepts: 'any-text', media: { pipeline: 'score' }, available: true },
  { id: 'attempt.asr.transcribe', kind: 'text', capability: 'media.asr_transcribe', source: 'attempt', internal: true, available: true }
];

export const NIGHTSHIFT_MODES = 5 + Object.keys(CLASSES).length;
export const NIGHTSHIFT_CLASSES = CLASSES;

const jobs = new Map<string, any>();
let jobSeq = 0, makeSeq = 0;

export async function nightshift(req: DemoRequest): Promise<Response> {
  const { method, path: p, body } = req;
  if (p === '/healthz' || p === '/health') return json(200, { ok: true });

  if (p === '/v1/models') {
    return json(200, { object: 'list', data: [
      ...['auto', 'fast', 'deep', 'cheap', 'local'].map(d => ({ id: `meterless/${d}`, object: 'model', meterless: { class: null, disposition: d, availability: 'ready' } })),
      ...Object.keys(CLASSES).map(k => ({ id: `meterless/${k}`, object: 'model', meterless: { class: k, disposition: 'auto', ...CLASSES[k] } }))
    ] });
  }
  if (p === '/v1/meterless/classes') return json(200, { classes: CLASSES });
  if (p === '/v1/meterless/transforms') return json(200, { object: 'list', data: TRANSFORMS });

  if (p === '/v1/chat/completions' && method === 'POST') {
    const model = String(body?.model || '');
    const m = model.match(/^meterless\/(image|speech|music|video)/);
    if (m) return json(400, { error: { message: `/v1/chat/completions cannot carry ${m[1]} on this build.`, code: 'class_carrier_unsupported' }, meterless: { chat_carrier: false, routes: [MAT] } });
    const mode = String(req.headers.get('meterless-mode') || model);
    const answer = answerFor(body || {}, mode);
    const winning = /judge/.test(mode) ? 'qwen3-8b-judge' : /deep/.test(mode) ? 'qwen3-30b-a3b' : 'llama-3.2-3b-instruct';
    if (!body?.stream) {
      await sleep(400);
      return json(200, { id: 'c1', object: 'chat.completion', model: winning, choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: answer } }], meterless: { mode, resolved_mode: model } });
    }
    const stream = new ReadableStream<Uint8Array>({
      async start(ctl) {
        const send = (o: unknown) => ctl.enqueue(enc.encode(`data: ${typeof o === 'string' ? o : JSON.stringify(o)}\n\n`));
        send({ choices: [{ delta: {} }], meterless: { progress: { stage: 'route', pct: 0 } } });
        await sleep(300);
        for (let i = 0; i < answer.length; i += 14) {
          send({ model: winning, choices: [{ index: 0, delta: { content: answer.slice(i, i + 14) } }] });
          await sleep(12);
        }
        send({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], meterless: { mode, winner: winning } });
        send('[DONE]');
        ctl.close();
      }
    });
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' } });
  }

  if (p === '/v1/jobs' && method === 'POST') {
    const id = `job_${(++jobSeq).toString(36)}_${Date.now().toString(36)}`;
    jobs.set(id, { id, body, status: 'queued', polls: 0, generated: 0, winner_seq: null, attempts: new Map(), makes: [], artifacts: new Map() });
    return json(200, { id, status: 'queued' });
  }
  const jm = p.match(/^\/v1\/jobs\/([^/]+)(?:\/(.*))?$/);
  if (!jm) return json(404, { error: { message: 'no route' } });
  const job = jobs.get(decodeURIComponent(jm[1]));
  const rest = jm[2] || '';
  if (!job) return json(404, { error: { message: 'not found' } });

  if (!rest && method === 'GET') {
    if (++job.polls > 1 && !job.attempts.size) {
      // best_of_n: n independent drafts, one named the winner.
      const n = Math.max(1, Math.min(6, Number(job.body?.n) || 1));
      for (let s = 1; s <= n; s++) job.attempts.set(s, { seq: s, text: answerFor({ ...job.body, __seq: s }, String(job.body?.mode || '')) });
      job.generated = n; job.winner_seq = 1 + (hashStr(job.id) % n); job.status = 'completed';
    } else if (!job.attempts.size) job.status = 'running';
    return json(200, { id: job.id, status: job.status, generated: job.generated, n: Math.max(1, Number(job.body?.n) || 1), winner_seq: job.winner_seq });
  }
  if (rest === 'attempts') return json(200, { object: 'list', data: [...job.attempts.values()].map((a: any) => ({ seq: a.seq })) });
  const am = rest.match(/^attempts\/(\d+)$/);
  if (am) { const a = job.attempts.get(Number(am[1])); return a ? json(200, a) : json(404, { error: { message: 'not found' } }); }
  if (rest === 'materialize' && method === 'POST') {
    const t = TRANSFORMS.find(x => x.id === body?.transform);
    if (!t) return json(400, { error: { message: 'unknown transform', code: 'transform_unknown' } });
    if (!job.attempts.get(Number(body.seq))) return json(404, { error: { message: 'no such attempt', code: 'source_not_found' } });
    const make_id = `mk_${(++makeSeq).toString(36)}`;
    job.makes.push({ make_id, status: 'queued', source_seq: Number(body.seq), transform: t.id, outputs: [], polls: 0, text: body.media_controls?.text || '' });
    return json(200, { make_ids: [make_id], skipped: [] });
  }
  if (rest === 'makes') {
    for (const m of job.makes) {
      if (m.status === 'queued') { m.status = 'running'; continue; }
      if (m.status === 'running' && ++m.polls > 1) {
        m.status = 'done';
        const ext = m.transform === 'attempt.image.still' ? 'png' : 'wav';
        const primary = `${m.transform.split('.')[1]}-${m.make_id}.${ext}`;
        m.outputs = [`${m.make_id}.json`, primary];
        const list = job.artifacts.get(m.source_seq) || [];
        list.push({ name: `${m.make_id}.json`, kind: 'json', mime: 'application/json', output_role: 'supporting', made: { make_id: m.make_id } });
        list.push({ name: primary, kind: ext === 'png' ? 'image' : 'audio', mime: ext === 'png' ? 'image/png' : 'audio/wav', output_role: 'primary', verified: true, made: { make_id: m.make_id }, _text: m.text, _transform: m.transform });
        job.artifacts.set(m.source_seq, list);
      }
    }
    return json(200, { object: 'list', data: job.makes.map(({ polls, text, ...row }: any) => row), bulks: [] });
  }
  const al = rest.match(/^attempts\/(\d+)\/artifacts$/);
  if (al) return json(200, { object: 'list', data: (job.artifacts.get(Number(al[1])) || []).map(({ _text, _transform, ...e }: any) => e) });
  const af = rest.match(/^attempts\/(\d+)\/artifacts\/(.+)$/);
  if (af) {
    const e = (job.artifacts.get(Number(af[1])) || []).find((x: any) => x.name === decodeURIComponent(af[2]));
    if (!e) return json(404, { error: { message: 'not found' } });
    if (e._transform === 'attempt.image.still') {
      const real = await realStill(e._text);
      return real ? bytes(real, real.type || e.mime) : bytes(await stillPng(e._text, 512, 384), e.mime);
    }
    if (e._transform === 'attempt.music.score') return bytes(musicWav(), e.mime);
    if (e._transform === 'attempt.voice.narrate') return bytes(speechWav(e._text), e.mime);
    return bytes(enc.encode('{}'), e.mime);
  }
  return json(405, { error: { message: `method ${method} not allowed on ${p}` } });
}

// ---------------------------------------------------------------------
// ComfyUI
// ---------------------------------------------------------------------

export const COMFY_NODES = ['CheckpointLoaderSimple', 'CLIPTextEncode', 'EmptySD3LatentImage', 'EmptyLatentImage', 'KSampler', 'VAEDecode', 'SaveImage', 'FluxGuidance',
  'UNETLoader', 'DualCLIPLoader', 'CLIPLoader', 'VAELoader', 'LoadImage', 'LTXVImgToVideo', 'LTXVConditioning', 'LTXVScheduler', 'SamplerCustomAdvanced',
  'CFGGuider', 'RandomNoise', 'KSamplerSelect', 'CreateVideo', 'SaveVideo', 'SaveAnimatedWEBP', 'ModelSamplingSD3', 'Wan22ImageToVideoLatent', 'PreviewImage',
  'VAEEncode', 'ImageCrop', 'ImageScale', 'ReferenceLatent', 'FluxKontextImageScale', 'ConditioningZeroOut', 'UpscaleModelLoader', 'ImageUpscaleWithModel'];
export const COMFY_MODELS: Record<string, string[]> = {
  checkpoints: ['flux1-schnell-fp8.safetensors', 'ltx-video-2b-v0.9.5.safetensors'],
  diffusion_models: [], unet: [],
  text_encoders: ['t5xxl_fp8_e4m3fn.safetensors'], clip: ['t5xxl_fp8_e4m3fn.safetensors'],
  vae: [], loras: []
};
export const COMFY_STATS = { system: { os: 'web', comfyui_version: '0.3.66-demo', python_version: '3.12' }, devices: [{ name: 'Demo GPU (in your browser)', type: 'cuda', vram_total: 24 * 1024 ** 3, vram_free: 20 * 1024 ** 3 }] };

/** The fake progress socket: the shim hands every `/ws` WebSocket one of these. */
export class DemoSocket extends EventTarget {
  static readonly CONNECTING = 0; static readonly OPEN = 1; static readonly CLOSING = 2; static readonly CLOSED = 3;
  readonly CONNECTING = 0; readonly OPEN = 1; readonly CLOSING = 2; readonly CLOSED = 3;
  readyState = 0;
  binaryType: BinaryType = 'blob';
  readonly protocol = ''; readonly extensions = ''; readonly bufferedAmount = 0;
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  onclose: ((e: CloseEvent) => void) | null = null;
  constructor(readonly url: string, readonly clientId: string) {
    super();
    sockets.set(clientId, this);
    setTimeout(() => {
      if (this.readyState !== 0) return;
      this.readyState = 1;
      this.fire(new Event('open'));
      this.deliver({ type: 'status', data: { status: { exec_info: { queue_remaining: queue.length } }, sid: clientId } });
    }, 20);
  }
  private fire(e: Event) {
    const h = (this as any)[`on${e.type}`];
    if (typeof h === 'function') h.call(this, e);
    this.dispatchEvent(e);
  }
  deliver(payload: unknown) {
    if (this.readyState !== 1) return;
    const data = typeof payload === 'string' || payload instanceof ArrayBuffer ? payload : JSON.stringify(payload);
    this.fire(new MessageEvent('message', { data }));
  }
  send() { /* client frames are not needed */ }
  close() {
    if (this.readyState >= 2) return;
    this.readyState = 3;
    sockets.delete(this.clientId);
    this.fire(new CloseEvent('close', { code: 1000, wasClean: true }));
  }
}

const sockets = new Map<string, DemoSocket>();
const history: Record<string, any> = {};
const files = new Map<string, { mime: string; data: Uint8Array | Blob }>();
const queue: { id: string; graph: Record<string, any>; clientId: string }[] = [];
let running = false;

const tell = (clientId: string, obj: unknown) => sockets.get(clientId)?.deliver(obj);

async function runQueue() {
  if (running) return;
  running = true;
  while (queue.length) {
    const { id, graph, clientId } = queue.shift()!;
    queue.forEach((_, i) => tell(clientId, { type: 'status', data: { status: { exec_info: { queue_remaining: queue.length - i } } } }));
    tell(clientId, { type: 'execution_start', data: { prompt_id: id } });
    const nodes = Object.keys(graph);
    const texts: string[] = Object.values<any>(graph).filter(n => n.class_type === 'CLIPTextEncode').map(n => String(n.inputs.text || ''));
    const text = texts.find(t => comicFor(t, true)) || texts.find(Boolean) || 'stage';
    const video = Object.values<any>(graph).some(n => /Video|WEBP/.test(n.class_type));
    const sampler = nodes.find(k => /KSampler$|SamplerCustomAdvanced/.test(graph[k].class_type));
    const latent = Object.values<any>(graph).find(n => /EmptySD3LatentImage|EmptyLatentImage/.test(n.class_type));
    const portrait = !!latent && latent.inputs.height > latent.inputs.width;
    const real = await realStill(text, portrait).catch(() => null);
    for (const k of nodes) {
      tell(clientId, { type: 'executing', data: { node: k, prompt_id: id } });
      if (k === sampler) {
        const steps = video ? 12 : 6;
        for (let s = 1; s <= steps; s++) {
          await sleep(video ? 260 : 170);
          tell(clientId, { type: 'progress', data: { value: s, max: steps, prompt_id: id, node: k } });
          if (s % 2 === 0 && sockets.has(clientId)) {
            const png = real ? await noisyPreview(real, 1 - s / steps) : new Uint8Array(await (await stillPng(String(text), 192, 144, 1 - s / steps)).arrayBuffer());
            const frame = new Uint8Array(8 + png.length);
            new DataView(frame.buffer).setUint32(0, 1); new DataView(frame.buffer).setUint32(4, 2);
            frame.set(png, 8);
            sockets.get(clientId)?.deliver(frame.buffer);
          }
        }
      } else await sleep(40);
    }
    const w = latent ? Math.min(1024, latent.inputs.width) / 2 : 512, h = latent ? Math.min(1024, latent.inputs.height) / 2 : 384;
    const clip = video ? await realClip(text) : null;
    const name = `standupify_${id.slice(0, 8)}.${video ? clip?.ext || 'gif' : real ? extOf(real) : 'png'}`;
    files.set(name, video
      ? (clip ? { mime: clip.data.type || 'video/mp4', data: clip.data } : { mime: 'image/gif', data: zoomGif(String(text)) })
      : (real ? { mime: real.type || 'image/png', data: real } : { mime: 'image/png', data: await stillPng(String(text), Math.round(w), Math.round(h)) }));
    const saver = [...nodes].reverse().find(k => /Save/.test(graph[k].class_type)) || nodes[nodes.length - 1];
    history[id] = {
      prompt: [0, id, graph], status: { status_str: 'success', completed: true, messages: [] },
      outputs: { [saver]: video ? { images: [{ filename: name, subfolder: '', type: 'output' }], animated: [true] } : { images: [{ filename: name, subfolder: '', type: 'output' }] } }
    };
    tell(clientId, { type: 'executing', data: { node: null, prompt_id: id } });
    tell(clientId, { type: 'execution_success', data: { prompt_id: id } });
  }
  running = false;
}

export async function comfy(req: DemoRequest): Promise<Response> {
  const { method, path: p, body } = req;
  if (p === '/system_stats') return json(200, COMFY_STATS);
  if (p === '/object_info') return json(200, Object.fromEntries(COMFY_NODES.map(n => [n, { input: { required: {} }, output: [], name: n }])));
  if (p === '/models') return json(200, Object.keys(COMFY_MODELS));
  const mf = p.match(/^\/models\/(\w+)$/);
  if (mf) return json(200, COMFY_MODELS[mf[1]] || []);
  if (p === '/prompt' && method === 'POST') {
    if (!body || typeof body !== 'object') return json(400, { error: { message: 'invalid json' } });
    const graph = body.prompt || {};
    const bad = Object.entries<any>(graph).find(([, n]) => !COMFY_NODES.includes(n.class_type));
    if (bad) return json(400, { error: { type: 'invalid_prompt', message: 'Cannot execute because a node is missing the class_type property.' }, node_errors: { [bad[0]]: { class_type: bad[1].class_type, errors: [{ message: 'node not installed', details: `${bad[1].class_type} is not installed` }] } } });
    const id = crypto.randomUUID();
    queue.push({ id, graph, clientId: body.client_id });
    void runQueue();
    return json(200, { prompt_id: id, number: queue.length, node_errors: {} });
  }
  const hm = p.match(/^\/history\/(.+)$/);
  if (hm) { const id = decodeURIComponent(hm[1]); const h = history[id]; return json(200, h ? { [id]: h } : {}); }
  if (p === '/view') {
    const f = files.get(req.search.get('filename') || '');
    if (!f) return json(404, { error: 'not found' });
    return bytes(f.data, f.mime);
  }
  if (p === '/upload/image' && method === 'POST') return json(200, { name: `upload_${Date.now()}.png`, subfolder: '', type: 'input' });
  if (p === '/interrupt' || p === '/queue') return json(200, {});
  return json(404, { error: 'not found' });
}
