// =====================================================================
// The writers' room for an Original — Nightshift designs the production
// and writes a full 12–16 minute hour, chapter by chapter, from the
// comic's proven material. Every call has a deterministic fallback, so a
// production never stalls on a model that answers with nothing: the
// fallback is built from what they have already performed.
// =====================================================================

import type { AISettings, Bit, Comedian } from '../../types';
import { chatJson, describeError } from '../nightshift/runtime';
import { getEngines } from '../engines';
import { priorityText } from '../studio';
import { venueById } from '../comfy/presets';
import type { BeatKind, Bible, Chapter, ScriptBeat } from './types';
import { countWords, WORDS_PER_SECOND } from './director';

const KINDS: BeatKind[] = ['open', 'setup', 'punch', 'tag', 'actout', 'crowdwork', 'callback', 'close'];
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const nsOnline = () => getEngines().nightshift.state === 'online';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function waitForNightshift(ms: number): Promise<boolean> {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(5000)) if (nsOnline()) return true;
  return nsOnline();
}

/**
 * Nightshift flaps offline for a few seconds while the Circuit and ComfyUI
 * share the GPU, and a thinking model sometimes answers with nothing. Wait
 * for it and ask again; only a long outage settles for the fallback.
 */
async function persist<T>(what: string, ask: () => Promise<T>, usable: (v: T) => boolean, tries = 4, partial?: (v: T) => number): Promise<T | null> {
  let best: T | null = null;
  for (let i = 0; i < tries; i++) {
    if (!(await waitForNightshift(i === 0 ? 10 * 60_000 : 3 * 60_000))) break;
    try {
      const v = await ask();
      if (usable(v)) return v;
      if (partial && partial(v) > (best ? partial(best) : 0)) best = v;
      console.warn(`[originals] ${what}: attempt ${i + 1} came back short`);
    } catch (e) { console.warn(`[originals] ${what}: attempt ${i + 1} failed — ${describeError(e)}`); }
    if (i < tries - 1) await sleep(15_000 * (i + 1));
  }
  return best;
}

// ---------------------------------------------------------------------
// production bible
// ---------------------------------------------------------------------

const THEATERS = ['The Orpheum', 'The Beacon', 'The Palace', 'The Paramount', 'The Majestic', 'The Lyric', 'The Fillmore', 'The Wiltern', 'The Tivoli', 'The Riviera'];
const CITIES = ['Chicago', 'New York', 'Los Angeles', 'Austin', 'Atlanta', 'Boston', 'Denver', 'Nashville', 'Philadelphia', 'Oakland'];
const GRADES: [string, [string, string, string]][] = [
  ['warm amber key light against deep teal shadows, rich filmic contrast', ['#ffb547', '#123844', '#07141a']],
  ['crimson velvet and gold, warm tungsten, inky blacks', ['#ffcc7a', '#6e1420', '#140507']],
  ['cool steel-blue backdrop with a single warm spotlight, crisp contrast', ['#ffd9a0', '#1d3a6b', '#060b17']],
  ['violet haze and magenta rim light, glossy concert-film look', ['#ffc2e2', '#3b1f6e', '#0b0618']],
  ['emerald and brass, art-deco warmth, soft halation', ['#ffe0a3', '#14503d', '#04140f']]
];

export function fallbackBible(c: Comedian, seed: number): Bible {
  const r = rng(seed);
  const [grade, palette] = GRADES[Math.floor(r() * GRADES.length)];
  const venue = venueById(c.venue);
  return {
    theater: THEATERS[Math.floor(r() * THEATERS.length)],
    city: CITIES[Math.floor(r() * CITIES.length)],
    stage: `a historic theater stage with a towering wall of warm marquee bulbs in an abstract art-deco pattern, a single mic stand and a stool with a water glass, ${venue.name.toLowerCase()} energy scaled up`,
    lighting: 'a hard follow spot from the balcony, warm front fill, colored backlights cutting through light haze',
    grade, palette,
    wardrobe: 'their signature look, pressed and camera-ready for the taping',
    crowd: `a sold-out house of ${c.audience || 'comedy fans'}`,
    lens: 'large-format digital cinema cameras, anamorphic primes, eight-camera live coverage',
    tagline: c.tagline || 'One night. One mic. No retakes.'
  };
}

export async function writeBible(c: Comedian, best: Bit[], seed: number, settings: AISettings): Promise<Bible> {
  const base = fallbackBible(c, seed);
  const out = await persist('production design', () => priorityText(`Original · production design for ${c.name}`, () => chatJson<Partial<Bible>>({
      task: 'copy', quality: settings.quality, maxTokens: 4000, temperature: 0.8,
      system: 'You are the production designer and director of photography for a prestige stand-up comedy special on a major streaming network. Output ONLY valid JSON.',
      prompt: `Design the taping of a one-hour-style stand-up special for ${c.name} — "${c.tagline}". Style: ${c.style}. Voice: ${c.voice}. Their look: ${c.look || 'not described'}.
Their strongest material: ${best.slice(0, 5).map(b => `"${b.title}"`).join(', ') || 'new material'}.
Pick a real-feeling historic theater and city that fit their act, and design one consistent look the whole special keeps, shot to shot.
No words, letters, logos or signs anywhere in the set: image models garble lettering.
Return ONLY JSON: { "theater": "name", "city": "city", "stage": "the set dressing in one sentence", "lighting": "the lighting plan in one sentence", "grade": "the color grade in cinematographer words", "wardrobe": "exactly what they wear for the taping, consistent with their look", "crowd": "who fills the seats", "tagline": "a 3–7 word key-art line" }`
    }), { comedianId: c.id }), o => !!o && typeof o.theater === 'string' && !!o.theater.trim());
  if (!out) return base;
  const s = (v: unknown, d: string, max = 220) => (typeof v === 'string' && v.trim() ? v.trim().replace(/^["']|["']$/g, '').slice(0, max) : d);
  return {
    ...base,
    theater: s(out.theater, base.theater, 40), city: s(out.city, base.city, 40), stage: s(out.stage, base.stage), lighting: s(out.lighting, base.lighting),
    grade: s(out.grade, base.grade, 140), wardrobe: s(out.wardrobe, base.wardrobe, 160), crowd: s(out.crowd, base.crowd, 120), tagline: s(out.tagline, base.tagline, 60)
  };
}

// ---------------------------------------------------------------------
// the outline
// ---------------------------------------------------------------------

export interface Outline { title: string; logline: string; chapters: { title: string; premise: string; from?: number }[] }

export function chaptersFor(minutes: number) { return clamp(Math.round((minutes * 60) / 75), 8, 14); }

export async function writeOutline(c: Comedian, best: Bit[], minutes: number, settings: AISettings): Promise<Outline> {
  const n = chaptersFor(minutes);
  const fallback: Outline = {
    title: `${c.name}: Live at Last`,
    logline: `${c.name} takes the biggest stage of their career and doesn't waste a second of it.`,
    // Every proven set once, never twice: a shorter hour beats a repeated one.
    chapters: best.length
      ? best.slice(0, n).map((b, i) => ({ title: b.title, premise: b.description, from: i }))
      : c.profile.material.slice(0, n).map(m => ({ title: m.name, premise: m.description }))
  };
  const list = best.slice(0, 12).map((b, i) => `${i + 1}. "${b.title}" (${(b.laughScore ?? 7).toFixed(1)}): ${b.description.slice(0, 260)}`).join('\n');
  const mats = c.profile.material.slice(0, 12).map(m => `${m.name} (${m.type}): ${m.description}`).join(' | ');
  const parsed = await persist('outline', async () => {
    const out = await priorityText(`Original · ${c.name} outlines the hour`, () => chatJson<any>({
      task: 'copy', quality: settings.quality, maxTokens: 7000, temperature: 0.85,
      system: 'You are the head writer of a prestige stand-up special. You structure an hour like the greats: a strong opener, escalating chunks, recurring callbacks, a personal turn, and a closer that ties it together. Output ONLY valid JSON.',
      prompt: `Comedian ${c.name} — "${c.tagline}". Style: ${c.style}. Voice: ${c.voice}.
PROVEN SETS (score from the clubs):
${list || '(none yet)'}
MATERIAL BANK: ${mats || '(none)'}

Outline a ${minutes}-minute special in EXACTLY ${n} chunks. Build on the proven sets (refer to them by number in "from"), invent new chunks where the arc needs them, plant a callback early that the closer pays off.
Return ONLY JSON: { "title": "the special's title, 2–5 words", "logline": "one sentence", "chapters": [ { "title": "chunk name", "premise": "what the chunk is about and its turn, one or two sentences", "from": number or null } ] }`
    }), { comedianId: c.id });
    const chapters = (Array.isArray(out?.chapters) ? out.chapters : []).map((ch: any) => ({
      title: String(ch?.title || '').slice(0, 60) || 'Untitled chunk',
      premise: String(ch?.premise || ch?.description || '').slice(0, 400),
      from: Number.isFinite(Number(ch?.from)) && Number(ch.from) >= 1 ? Number(ch.from) - 1 : undefined
    })).filter((ch: { premise: string }) => ch.premise);
    return { title: String(out?.title || fallback.title).replace(/^["']|["']$/g, '').slice(0, 60), logline: String(out?.logline || fallback.logline).slice(0, 220), chapters: chapters.slice(0, 14) as Outline['chapters'] };
  }, o => o.chapters.length >= Math.ceil(n * 0.6), 4, o => (o.chapters.length >= 4 ? o.chapters.length : 0));
  // A short outline is still a written one: each chunk simply runs longer.
  return parsed || fallback;
}

/**
 * One more chunk for an hour that is running short (small models outline
 * fewer chunks than asked): a fresh premise from their material, never a
 * repeat of what is already in the running order.
 */
export async function pitchChunk(c: Comedian, outline: Outline, settings: AISettings): Promise<{ title: string; premise: string }> {
  const taken = new Set(outline.chapters.map(ch => ch.title.toLowerCase()));
  const spare = c.profile.material.find(m => !taken.has(m.name.toLowerCase()));
  const fallback = { title: spare?.name || `Chunk ${outline.chapters.length + 1}`, premise: spare?.description || 'a story from the road that goes wrong in a new way' };
  const out = await persist('pitch', () => priorityText(`Original · ${c.name} pitches another chunk`, () => chatJson<{ title?: string; premise?: string }>({
    task: 'copy', quality: settings.quality, maxTokens: 3000, temperature: 0.95,
    system: 'You are the head writer of a prestige stand-up special. Output ONLY valid JSON.',
    prompt: `Comedian ${c.name} — "${c.tagline}". Style: ${c.style}. Voice: ${c.voice}.
MATERIAL BANK: ${c.profile.material.slice(0, 12).map(m => `${m.name}: ${m.description}`).join(' | ') || '(none)'}
THE SPECIAL SO FAR: ${outline.chapters.map((ch, i) => `${i + 1}. ${ch.title}`).join(' · ')}
The hour is running short. Pitch ONE new chunk that fits before the closer: a different subject from everything above, in their voice, ideally calling back to an earlier chunk.
Return ONLY JSON: { "title": "chunk name", "premise": "what it is about and its turn, one or two sentences" }`
  }), { comedianId: c.id }), o => !!o?.title && !!o?.premise && !taken.has(String(o.title).toLowerCase()), 2);
  return out ? { title: String(out.title).slice(0, 60), premise: String(out.premise).slice(0, 400) } : fallback;
}

// ---------------------------------------------------------------------
// a chapter, beat by beat
// ---------------------------------------------------------------------

const uid = (p: string, i: number) => `${p}${i.toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function cleanLine(s: string) {
  return s.replace(/\[[^\]]*\]/g, ' ').replace(/@(\w)/g, '$1').replace(/\s+/g, ' ').trim();
}

function guessKind(sentence: string, i: number, n: number): BeatKind {
  if (i === 0) return 'open';
  if (/\b(you|sir|ma'am|front row|where are you from|anybody here)\b/i.test(sentence) && /\?/.test(sentence)) return 'crowdwork';
  if (i === n - 1) return 'punch';
  if (/[!?]$/.test(sentence) || /\b(and then|so I|that's when)\b/i.test(sentence)) return 'punch';
  return 'setup';
}

/** Split performed text into beats: setups that build to punches, tags after. */
export function beatsFromText(text: string, prefix: string, baseLaugh = 7): ScriptBeat[] {
  const sentences = cleanLine(text).match(/[^.!?…]+[.!?…]+["”')]*|[^.!?…]+$/g)?.map(s => s.trim()).filter(Boolean) || [];
  const merged: string[] = [];
  for (const s of sentences) {
    if (merged.length && countWords(merged[merged.length - 1]) < 7) merged[merged.length - 1] += ` ${s}`;
    else merged.push(s);
  }
  return merged.map((line, i) => {
    const kind = guessKind(line, i, merged.length);
    const laugh = kind === 'punch' ? clamp(baseLaugh + (i === merged.length - 1 ? 0.8 : 0), 0, 10) : kind === 'crowdwork' ? 5.5 : kind === 'open' ? 3 : 1.5;
    return { id: uid(prefix, i), kind, line, laugh: Math.round(laugh * 10) / 10 };
  });
}

function parseBeats(raw: any, prefix: string): ScriptBeat[] {
  const list: any[] = Array.isArray(raw) ? raw : Array.isArray(raw?.beats) ? raw.beats : [];
  const out: ScriptBeat[] = [];
  list.forEach((b, i) => {
    const text = typeof b === 'string' ? b : String(b?.line || b?.text || '');
    const line = cleanLine(text);
    if (countWords(line) < 2) return;
    const kind = KINDS.includes(b?.kind) ? b.kind as BeatKind : guessKind(line, i, list.length);
    const laugh = clamp(Number(b?.laugh ?? (kind === 'punch' ? 7 : kind === 'callback' ? 7.5 : kind === 'tag' ? 6 : 1.5)) || 0, 0, 10);
    const cue = typeof b?.cue === 'string' ? b.cue.replace(/[\[\]]/g, '').trim().slice(0, 120) : undefined;
    out.push({ id: uid(prefix, i), kind, line, laugh: Math.round(laugh * 10) / 10, ...(cue ? { cue } : {}) });
  });
  return out;
}

export async function writeChapter(
  c: Comedian, outline: Outline, index: number, source: Bit | undefined, before: string, settings: AISettings, wordsTarget: number
): Promise<{ chapter: Chapter; simulated: boolean }> {
  const ch = outline.chapters[index];
  const prefix = `c${index}b`;
  const fallback = (): Chapter => {
    const text = source ? source.description : `${ch.premise}`;
    return { id: `ch${index}`, title: ch.title, beats: beatsFromText(text, prefix, source?.laughScore ?? 7) };
  };
  const last = index === outline.chapters.length - 1;
  const beats = await persist(`chunk ${index + 1}`, async () => parseBeats(await priorityText(`Original · ${c.name} writes “${ch.title}” (${index + 1}/${outline.chapters.length})`, () => chatJson<any>({
      task: 'copy', quality: settings.quality, maxTokens: 6500, temperature: 0.9,
      system: 'You write stand-up for a prestige special, word for word as it is performed: specific, surprising, conversational, with real punchlines and tags. Output ONLY valid JSON.',
      prompt: `Comedian ${c.name}. Voice: ${c.voice}. Style: ${c.style}.
SPECIAL: "${outline.title}" — ${outline.logline}
RUNNING ORDER: ${outline.chapters.map((x, i) => `${i + 1}. ${x.title}`).join(' · ')}
SO FAR: ${before || '(this is the opener — they just walked out to applause)'}

Write chunk ${index + 1}: "${ch.title}" — ${ch.premise}
${source ? `It grows out of this proven club set (keep its best lines, expand it): "${source.description}"` : ''}
${index === 0 ? 'Open by greeting the city and the room, then get into it fast.' : ''}${last ? 'This is the CLOSER: pay off the callbacks planted earlier, land the biggest laugh of the night, then say thank you and goodnight.' : ''}
About ${wordsTarget} words, as beats. kind is one of: open, setup, punch, tag, actout, crowdwork, callback, close. "cue" is what they physically do (short). "laugh" is how hard a sold-out theater laughs, 0–10.
Return ONLY JSON: { "beats": [ { "kind": "setup", "line": "exactly what they say", "cue": "short physical action", "laugh": 0 } ] }`
    }), { comedianId: c.id }), prefix),
  bs => bs.length >= 3 && bs.reduce((a, b) => a + countWords(b.line), 0) >= wordsTarget * 0.35, 4,
  bs => (bs.length >= 3 ? bs.reduce((a, b) => a + countWords(b.line), 0) : 0));
  return beats ? { chapter: { id: `ch${index}`, title: ch.title, beats }, simulated: false } : { chapter: fallback(), simulated: true };
}

/** Words a chapter should run so the whole special lands on its target length. */
export function wordsPerChapter(minutes: number, chapters: number) {
  // ~22% of the runtime is laughter, walk-on and the bow.
  return Math.round((minutes * 60 * 0.78 * WORDS_PER_SECOND) / chapters);
}
