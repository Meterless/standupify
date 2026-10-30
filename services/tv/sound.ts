// =====================================================================
// The room — everything you hear on Standupify TV, made on the spot.
//
//   voice      the comic reads their set (browser speech synthesis, a stable
//              voice per comedian, word-by-word timing for the captions)
//   room tone  a quiet club: low hum and murmur
//   laughter   synthesised crowd laughs, sized by how hard the joke landed
//   applause   for the sets that earned it
//   walk-on    a short brassy sting
//
// No samples, no downloads: Web Audio + the voices the OS already has.
// =====================================================================

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let roomNodes: AudioNode[] = [];
let noise: AudioBuffer | null = null;

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
  }
  return ctx;
}

function noiseBuffer(c: AudioContext): AudioBuffer {
  if (noise) return noise;
  const b = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return (noise = b);
}

/** Must be called from a user gesture (the Tune in click) to unlock audio. */
export async function unlockSound() {
  const c = audio();
  if (c && c.state !== 'running') { try { await c.resume(); } catch { /* ignore */ } }
  // Warm up speech so the first set starts on time.
  try { window.speechSynthesis?.getVoices(); } catch { /* ignore */ }
}

export function setMuted(muted: boolean) {
  if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : 0.9, ctx.currentTime, 0.05);
  if (muted) { try { window.speechSynthesis?.cancel(); } catch { /* ignore */ } }
}

// ---------------------------------------------------------------------
// room tone
// ---------------------------------------------------------------------

export function startRoom() {
  const c = audio();
  if (!c || !master || roomNodes.length) return;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c);
  src.loop = true;
  const low = c.createBiquadFilter();
  low.type = 'lowpass';
  low.frequency.value = 380;
  const murmur = c.createBiquadFilter();
  murmur.type = 'bandpass';
  murmur.frequency.value = 520;
  murmur.Q.value = 0.8;
  const g = c.createGain();
  g.gain.value = 0.018;
  const lfo = c.createOscillator();
  lfo.frequency.value = 0.13;
  const lfoGain = c.createGain();
  lfoGain.gain.value = 0.008;
  lfo.connect(lfoGain).connect(g.gain);
  src.connect(low).connect(murmur).connect(g).connect(master);
  src.start();
  lfo.start();
  roomNodes = [src, lfo];
}

export function stopRoom() {
  for (const n of roomNodes) { try { (n as AudioScheduledSourceNode).stop(); } catch { /* ignore */ } }
  roomNodes = [];
}

// ---------------------------------------------------------------------
// laughter + applause
// ---------------------------------------------------------------------

/** One laughing person: "ha-ha-ha" as filtered noise syllables. */
function laugher(c: AudioContext, out: AudioNode, at: number, dur: number, loud: number) {
  const center = 380 + Math.random() * 900;
  const rate = 4.2 + Math.random() * 2.8;            // syllables per second
  const syll = Math.max(2, Math.floor(dur * rate));
  for (let i = 0; i < syll; i++) {
    const t = at + i / rate + Math.random() * 0.02;
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = center * (1 + (Math.random() - 0.5) * 0.15);
    bp.Q.value = 4 + Math.random() * 3;
    const g = c.createGain();
    const peak = loud * (1 - (i / syll) * 0.6) * (0.6 + Math.random() * 0.4);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.018);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.14 + Math.random() * 0.05);
    src.connect(bp).connect(g).connect(out);
    src.start(t, Math.random() * 1.5, 0.2);
  }
}

/**
 * A crowd laugh. strength 0..10 (the room's reaction): a few chuckles at 4,
 * a wave at 7, a roar at 9.
 */
export function laugh(strength: number) {
  const c = audio();
  if (!c || !master || strength < 2.5) return 0;
  const people = Math.round(Math.max(1, (strength - 2) * 2.4));
  const dur = 0.7 + Math.max(0, strength - 4) * 0.28;
  const loud = 0.05 + Math.min(1, strength / 10) * 0.07;
  const bus = c.createGain();
  bus.gain.value = 1;
  const verb = c.createBiquadFilter();
  verb.type = 'lowpass';
  verb.frequency.value = 3200;
  bus.connect(verb).connect(master);
  const t0 = c.currentTime + 0.05;
  for (let i = 0; i < people; i++) laugher(c, bus, t0 + Math.random() * 0.35, dur * (0.6 + Math.random() * 0.6), loud);
  return dur + 0.4;
}

export function applause(seconds = 2.4, strength = 8) {
  const c = audio();
  if (!c || !master) return 0;
  const claps = Math.round(seconds * (14 + strength * 3));
  const bus = c.createGain();
  bus.gain.value = 0.9;
  bus.connect(master);
  const t0 = c.currentTime + 0.05;
  for (let i = 0; i < claps; i++) {
    const t = t0 + Math.random() * seconds;
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c);
    const hp = c.createBiquadFilter();
    hp.type = 'bandpass';
    hp.frequency.value = 1200 + Math.random() * 1800;
    hp.Q.value = 1.2;
    const g = c.createGain();
    const fade = 1 - Math.max(0, (t - t0) / seconds - 0.6) * 2;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.05 * Math.max(0.15, fade), t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.05);
    src.connect(hp).connect(g).connect(bus);
    src.start(t, Math.random() * 1.8, 0.07);
  }
  return seconds;
}

/** A short walk-on sting: three brassy hits. */
export function sting() {
  const c = audio();
  if (!c || !master) return;
  const chords = [[220, 277.2, 329.6], [246.9, 311.1, 370], [293.7, 370, 440, 587.3]];
  chords.forEach((notes, k) => {
    const t = c.currentTime + 0.05 + k * 0.22;
    const len = k === 2 ? 0.9 : 0.16;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(600, t);
    lp.frequency.linearRampToValueAtTime(3200, t + 0.05);
    lp.frequency.exponentialRampToValueAtTime(700, t + len);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.07, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0005, t + len);
    lp.connect(g).connect(master!);
    for (const f of notes) {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = (Math.random() - 0.5) * 12;
      o.connect(lp);
      o.start(t);
      o.stop(t + len + 0.05);
    }
  });
}

// ---------------------------------------------------------------------
// the comic's voice
// ---------------------------------------------------------------------

const FEMALE = /aria|jenny|zira|sonia|libby|michelle|ana\b|emma|ava|samantha|victoria|karen|moira|tessa|fiona|susan|hazel|heera|natasha|clara|female|woman/i;
const MALE = /guy|davis|david|mark|ryan|thomas|george|daniel|alex|fred|tom|eric|christopher|roger|steffan|james|william|brian|male\b|man\b/i;

function hash(s: string) { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

function voices(): SpeechSynthesisVoice[] {
  try { return (window.speechSynthesis?.getVoices() || []).filter(v => /^en(-|_|$)/i.test(v.lang)); } catch { return []; }
}

/** A stable voice per comedian, matched to how they are described. */
export function voiceFor(id: string, look = ''): { voice: SpeechSynthesisVoice | null; pitch: number; rate: number } {
  const all = voices();
  const h = hash(id);
  const wantsFemale = /\b(woman|girl|she|her|female)\b/i.test(look);
  const wantsMale = /\b(man|guy|he|his|male)\b/i.test(look) && !wantsFemale;
  // Natural/neural voices sound like people; prefer them.
  const natural = all.filter(v => /natural|neural|online/i.test(v.name));
  const pool = natural.length >= 2 ? natural : all;
  const matched = pool.filter(v => (wantsFemale ? FEMALE.test(v.name) : wantsMale ? MALE.test(v.name) : true));
  const list = matched.length ? matched : pool;
  return {
    voice: list.length ? list[h % list.length] : null,
    pitch: 0.92 + ((h >> 8) % 17) / 100,
    rate: 0.98 + ((h >> 16) % 12) / 100
  };
}

export function hasSpeech(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/**
 * Speak a set. onWord gets the index of the word being spoken (boundary
 * events where the voice supports them, an even pace where it doesn't).
 * Resolves when done or cancelled.
 */
export function speak(text: string, who: { id: string; look?: string }, onWord: (i: number) => void, signal?: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (!hasSpeech() || signal?.aborted || !text.trim()) return resolve();
    const synth = window.speechSynthesis;
    synth.cancel();
    const words = text.split(/\s+/).filter(Boolean);
    const starts: number[] = [];
    let pos = 0;
    for (const w of words) { const i = text.indexOf(w, pos); starts.push(i); pos = i + w.length; }
    const u = new SpeechSynthesisUtterance(text);
    const v = voiceFor(who.id, who.look);
    if (v.voice) u.voice = v.voice;
    u.pitch = v.pitch;
    u.rate = v.rate;
    let gotBoundary = false;
    let settled = false;
    let paced: ReturnType<typeof setInterval> | undefined;
    let fallback: ReturnType<typeof setTimeout> | undefined;
    let i = 0;
    const done = (cancelled = false) => {
      if (settled) return;
      settled = true;
      if (paced) clearInterval(paced);
      if (fallback) clearTimeout(fallback);
      signal?.removeEventListener('abort', abort);
      if (!cancelled) onWord(words.length);
      resolve();
    };
    const abort = () => { done(true); synth.cancel(); };
    u.onboundary = (e: SpeechSynthesisEvent) => {
      if (settled || synth.paused || e.name && e.name !== 'word') return;
      gotBoundary = true;
      if (paced) clearInterval(paced);
      let k = starts.findIndex(s => s >= e.charIndex);
      if (k === -1) k = words.length - 1;
      onWord(k);
    };
    u.onstart = () => {
      // Voices without boundary events: an even, readable pace.
      fallback = setTimeout(() => {
        if (settled || gotBoundary) return;
        paced = setInterval(() => {
          if (!settled && !synth.paused) onWord(Math.min(words.length - 1, i++));
        }, 1000 / (2.6 * v.rate));
      }, 600);
    };
    u.onend = () => done();
    u.onerror = () => done();
    signal?.addEventListener('abort', abort, { once: true });
    try { synth.speak(u); } catch { done(true); }
  });
}

/** No voice available (or muted): read at a comfortable pace. */
export function paceWords(count: number, onWord: (i: number) => void, signal?: AbortSignal, wps = 2.7, isPaused: () => boolean = () => false): Promise<void> {
  return new Promise(resolve => {
    if (signal?.aborted) return resolve();
    let i = 0;
    const done = () => { clearInterval(id); signal?.removeEventListener('abort', done); resolve(); };
    const id = setInterval(() => {
      if (signal?.aborted) { done(); return; }
      if (isPaused()) return;
      if (i >= count) { onWord(count); done(); return; }
      onWord(i++);
    }, 1000 / wps);
    signal?.addEventListener('abort', done, { once: true });
  });
}

/** Split a set into its sentences, with the word index each one ends on. */
export function punchlines(text: string): number[] {
  const words = text.split(/\s+/).filter(Boolean);
  const ends: number[] = [];
  words.forEach((w, i) => { if (/[.!?…]["”')]*$/.test(w) && i < words.length - 1) ends.push(i); });
  return ends;
}
