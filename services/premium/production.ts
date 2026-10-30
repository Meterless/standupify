// =====================================================================
// The production office — takes an Original from greenlight to premiere
// on its own, and picks up exactly where it stopped after any restart.
//
//   greenlit → bible (Nightshift) → script (Nightshift, chapter by chapter)
//   → plates (ComfyUI consistency ladder: master, then 7 derived cameras)
//   → shooting (ComfyUI image→video, coverage pass first) → premiere
//   → remaster (pass 2: every shot its own clip)
//
//   recording runs alongside the shoot: Nightshift voices each chapter
//   while ComfyUI films, so neither engine waits on the other.
//
// One production at a time. While it holds the camera the Reel waits,
// but every few clips the production steps aside so the night's best
// club sets still get shot.
// =====================================================================

import type { AISettings, Bit, Comedian, Set as ComedySet } from '../../types';
import { getRepository } from '../repository';
import { getEngines } from '../engines';
import { describeError } from '../nightshift/runtime';
import { makeMedia, planMedia } from '../nightshift/media';
import { backgroundMedia, blobToDataUrl, comfyRender, comedianSeed, getCustomWorkflows, priorityText, renderStill } from '../studio';
import { chatJson } from '../nightshift/runtime';
import { mediaBlob } from '../bus';
import { ESSENCE_PROMPT, vision, noteVisionError } from '../world/model';
import { getInventory, uploadImage } from '../comfy/client';
import { chooseRecipe, type VideoParams } from '../comfy/recipes';
import {
  buildPlateGraph, finishingPasses, ladderAdvice, plateLadder, shotSize, upscaleGraph, withInterpolation, type PlateEngine, type Rung
} from '../comfy/consistency';
import { NEGATIVE_PROMPT, VIDEO_NEGATIVE } from '../comfy/presets';
import { track } from '../tasks';
import { CAMERAS, CAMERA_ORDER, coverage, scriptStats, shootingOrder } from './director';
import { chaptersFor, pitchChunk, writeBible, writeChapter, writeOutline, wordsPerChapter } from './script';
import type { Budget, CameraId, OriginalCard, Plate, Production, Shot } from './types';

const repo = () => getRepository();
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const uid = (p: string) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const PLATE = { width: 1344, height: 768 };
const KEY_ART = { width: 1920, height: 1088 };
const BREATHE_EVERY = 8;           // clips between the Reel's turns

// ---------------------------------------------------------------------
// wiring: the Circuit's news desk and the Reel (set by the engine), the Station
// ---------------------------------------------------------------------

type News = (text: string, actors: string[]) => void;
interface ReelLink { kick(): void; busy(): boolean }
interface WorldLink {
  canon(comedianId: string, theater?: { theater: string; city: string }): string;
  essence(comedianId: string): string | null;
  anchor(comedianId: string): string | null;
  theater(bible: { theater: string; city: string; stage: string; lighting: string; grade: string }, anchor?: string): void;
}
interface StationCmd { (name: string, ...args: unknown[]): Promise<any> }

const G = globalThis as any;
const W: {
  running: boolean; holding: boolean; getSettings: (() => AISettings) | null; voicing: Set<string>;
  paused: Set<string>; news: News | null; reel: ReelLink | null; world: WorldLink | null; station: StationCmd | null; clips: number;
} = (G.__standupifyOriginals ||= { running: false, holding: false, getSettings: null, voicing: new Set(), paused: new Set(), news: null, reel: null, world: null, station: null, clips: 0 });

export function connectCircuit(link: { news: News; reel: ReelLink; world?: WorldLink }) { W.news = link.news; W.reel = link.reel; W.world = link.world || null; }
export function attachOriginalsStation(cmd: StationCmd) { W.station = cmd; }

/** True while an Original is filming: the Reel waits its turn. */
export const originalsHoldCamera = () => W.holding;

const settings = (): AISettings => W.getSettings!();

// ---------------------------------------------------------------------
// public API (the page forwards to the Station when there is one)
// ---------------------------------------------------------------------

export interface GreenlightOptions { minutes?: number; budget?: Budget; source?: Production['source'] }

export async function greenlightOriginal(comedianId: string, o: GreenlightOptions = {}): Promise<string> {
  if (W.station) return W.station('originalsGreenlight', comedianId, o);
  const c = await repo().getComedian(comedianId);
  if (!c) throw new Error('That comedian is not on the roster.');
  const sets = await repo().listSets(comedianId);
  const open = sets.find(s => s.premium && s.premium.stage !== 'premiered');
  if (open) return open.id;
  const now = Date.now();
  const prod: Production = {
    version: 1, stage: 'greenlit', seed: (comedianSeed(c) ^ now) >>> 0,
    targetMinutes: Math.max(12, Math.min(16, Math.round(o.minutes || 14))), budget: o.budget || 'full', source: o.source || 'studio',
    plates: [], shots: [], log: [{ at: now, text: o.source === 'circuit' ? 'The network called: greenlit off the back of the Circuit.' : 'Greenlit.' }],
    startedAt: now, updatedAt: now
  };
  const set: ComedySet = {
    id: uid('orig'), comedianId, title: `${c.name}: an Original`, logline: 'In production.',
    status: 'rendering', bits: [], clipIds: [], promoIds: [], publishedUrls: [], analytics: {},
    generatedBy: o.source === 'circuit' ? 'autopilot' : 'manual', createdAt: now, updatedAt: now, premium: prod
  };
  await repo().saveSet(set);
  W.news?.(`${c.name} is greenlit for a Standupify Original — a ${prod.targetMinutes}-minute special, eight cameras, one night.`, [c.id]);
  void loop();
  return set.id;
}

export async function pauseOriginal(setId: string, paused: boolean): Promise<boolean> {
  if (W.station) return W.station('originalsPause', setId, paused);
  const set = await repo().getSet(setId);
  if (!set?.premium) return false;
  if (paused) W.paused.add(setId); else W.paused.delete(setId);
  set.premium.paused = paused;
  set.premium.log = [{ at: Date.now(), text: paused ? 'Production paused.' : 'Back in production.' }, ...set.premium.log].slice(0, 40);
  await repo().saveSet(set);
  if (!paused) void loop();
  return true;
}

/** Every Original on the roster, newest first, as light cards. */
export async function listOriginals(): Promise<OriginalCard[]> {
  if (W.station) return (await W.station('originalsList')) || [];
  const out: OriginalCard[] = [];
  for (const c of await repo().listComedians()) {
    for (const s of await repo().listSets(c.id)) if (s.premium) out.push(cardFor(s, c));
  }
  return out.sort((a, b) => b.startedAt - a.startedAt);
}

/** Start (or resume) the production office. Safe to call more than once. */
export function startOriginals(getSettings: () => AISettings) {
  W.getSettings = getSettings;
  if (W.station) return;
  setTimeout(() => { void loop(); }, 8000);
}

/** What this machine will shoot Originals with — for the rig card. */
export async function describeRig(s: AISettings): Promise<{ plates: string | null; rung: Rung | null; clips: string | null; finishing: string[]; advice: string | null; voice: boolean; comfy: boolean }> {
  const eng = getEngines();
  const voice = eng.nightshift.state === 'online' && eng.nightshift.classes?.speech?.availability !== 'unavailable';
  if (eng.comfy.state !== 'online') return { plates: null, rung: null, clips: null, finishing: [], advice: 'Start ComfyUI to shoot Originals.', voice, comfy: false };
  const inv = await getInventory();
  const custom = await getCustomWorkflows();
  const ladder = plateLadder(inv, custom, s.imageRecipe);
  const vid = chooseRecipe('video', inv, custom, s.videoRecipe);
  return {
    plates: ladder[0]?.name || null, rung: ladder[0]?.rung || null, clips: vid?.recipe.name || null,
    finishing: finishingPasses(inv), advice: vid ? ladderAdvice(inv) : 'Add a video model (LTX-Video or Wan 2.2) to film Originals.', voice, comfy: true
  };
}

// ---------------------------------------------------------------------
// the Circuit's network: legends and champions get an Original
// ---------------------------------------------------------------------

export interface Candidate { comedianId: string; legend: boolean; champion: boolean; titles: number; specials: number; pitched?: boolean }

/** Called after every Circuit show. Greenlights at most one Original, never two at once. */
export async function considerOriginals(candidates: Candidate[], s: AISettings): Promise<string | null> {
  if (s.autoOriginals === false || W.station) return null;
  const all = await listOriginals();
  if (all.some(o => o.stage !== 'premiered')) return null;
  for (const k of candidates) {
    // The network greenlights its legends and champions, and listens to a headliner who pitches.
    if (!(k.legend || k.champion || k.titles > 0 || k.pitched)) continue;
    const mine = all.filter(o => o.comedianId === k.comedianId).length;
    if (k.specials < 1 + mine * 2) continue;
    return greenlightOriginal(k.comedianId, { source: 'circuit', minutes: k.champion || k.legend ? 15 : 13 });
  }
  return null;
}

// ---------------------------------------------------------------------
// the worker
// ---------------------------------------------------------------------

function log(prod: Production, text: string) {
  prod.log = [{ at: Date.now(), text }, ...prod.log].slice(0, 40);
}

async function save(set: ComedySet) {
  const prod = set.premium!;
  prod.updatedAt = Date.now();
  set.bits = bitsOf(set);
  set.status = prod.stage === 'premiered' ? 'ready' : 'rendering';
  await repo().saveSet(set);
}

function remaining(prod: Production): Shot[] {
  return prod.stage === 'shooting' || prod.stage === 'premiered' ? shootingOrder(prod.shots, prod.budget).filter(s => s.status === 'todo') : [];
}

/** The next production with work left: unpremiered first, then remasters. */
async function nextProduction(): Promise<{ set: ComedySet; comedian: Comedian } | null> {
  let remaster: { set: ComedySet; comedian: Comedian } | null = null;
  const comics = await repo().listComedians();
  const all: { set: ComedySet; comedian: Comedian }[] = [];
  for (const c of comics) for (const s of await repo().listSets(c.id)) if (s.premium && !s.premium.paused && !W.paused.has(s.id)) all.push({ set: s, comedian: c });
  all.sort((a, b) => a.set.premium!.startedAt - b.set.premium!.startedAt);
  for (const x of all) {
    const p = x.set.premium!;
    if (p.stage !== 'premiered') return x;
    if (!remaster && remaining(p).length) remaster = x;
  }
  return remaster;
}

async function loop() {
  if (W.running || !W.getSettings) return;
  W.running = true;
  try {
    for (;;) {
      const next = await nextProduction();
      if (!next) break;
      try {
        const done = await advance(next.set, next.comedian);
        // Waiting on an engine: look again shortly. Even after real progress, yield to the
        // event loop so the Station keeps answering (the repository can resolve synchronously).
        await sleep(done ? 500 : 15_000);
      } catch (e) {
        const p = next.set.premium!;
        p.error = describeError(e);
        log(p, `Stalled: ${p.error} Trying again in a minute.`);
        await save(next.set).catch(() => { /* next pass */ });
        await sleep(60_000);
      }
    }
  } finally { W.running = false; W.holding = false; }
}

const isPaused = (set: ComedySet) => W.paused.has(set.id) || !!set.premium?.paused;

/** Run a production as far as the engines allow. True = progressed or finished; false = blocked. */
async function advance(set: ComedySet, c: Comedian): Promise<boolean> {
  const prod = set.premium!;
  prod.error = undefined;
  const ns = () => getEngines().nightshift.state === 'online';
  const comfy = () => getEngines().comfy.state === 'online';

  if (prod.stage === 'greenlit' || prod.stage === 'bible') {
    prod.stage = 'bible';
    const best = await bestMaterial(c);
    prod.bible = await writeBible(c, best, prod.seed, settings());
    log(prod, `Production design: ${prod.bible.theater}, ${prod.bible.city}. ${prod.bible.grade}.`);
    prod.stage = 'script';
    await save(set);
  }

  if (prod.stage === 'script') {
    if (!ns()) log(prod, 'Nightshift is off — the hour is cut from their proven club sets.');
    await writeScript(set, c);
    if (isPaused(set)) return true;
    prod.shots = coverage(prod.script!, prod.seed);
    prod.stage = 'plates';
    const pass1 = prod.shots.filter(s => s.pass === 1).length;
    log(prod, `Shot list: ${prod.shots.length} shots across eight cameras (${pass1} in the coverage pass), ~${Math.round(prod.script!.seconds / 60)} min.`);
    await save(set);
  }

  // Recording rides alongside everything after the script.
  void recordVoice(set, c);

  if (prod.stage === 'plates') {
    if (!comfy() && getEngines().nightshift.classes?.image?.availability !== 'ready') return false;
    const ok = await shootPlates(set, c);
    if (!ok) return false;
    prod.stage = 'shooting';
    log(prod, 'Cameras locked. Rolling.');
    await save(set);
  }

  if (prod.stage === 'shooting' || prod.stage === 'premiered') {
    if (!comfy()) return false;
    // shoot() is false when it could not film (paused, ComfyUI gone, no video model): that is waiting, not progress.
    const finished = await shoot(set, c);
    if (!finished) return false;
  }
  return true;
}

async function bestMaterial(c: Comedian): Promise<Bit[]> {
  const sets = (await repo().listSets(c.id)).filter(s => !s.premium);
  const seen = new Set<string>();
  return sets.flatMap(s => s.bits)
    .filter(b => b.description && b.description.split(/\s+/).length > 12)
    .sort((a, b) => (b.laughScore ?? 6) - (a.laughScore ?? 6))
    .filter(b => { const k = b.title.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, 14);
}

async function writeScript(set: ComedySet, c: Comedian) {
  const prod = set.premium!;
  const best = await bestMaterial(c);
  // The outline is kept, so a production resumed mid-script keeps the same running order.
  const outline = prod.outline || (prod.outline = await writeOutline(c, best, prod.targetMinutes, settings()));
  set.title = outline.title;
  set.logline = outline.logline;
  const n = Math.min(outline.chapters.length, chaptersFor(prod.targetMinutes) + 2);
  const target = wordsPerChapter(prod.targetMinutes, n);
  const chapters = prod.script?.chapters || [];
  let simulated = prod.script?.simulated || false;
  log(prod, `Outline: “${outline.title}” in ${n} chunks.`);
  await save(set);
  for (let i = chapters.length; i < n; i++) {
    if (isPaused(set)) break;
    const before = chapters.slice(-2).map(ch => `“${ch.title}”: ${ch.beats.slice(-2).map(b => b.line).join(' ')}`).join(' … ');
    const ch = outline.chapters[i];
    const { chapter, simulated: sim } = await writeChapter(c, outline, i, ch.from != null ? best[ch.from] : undefined, before, settings(), target);
    simulated ||= sim;
    chapters.push(chapter);
    const stats = scriptStats(chapters);
    prod.script = { title: outline.title, logline: outline.logline, chapters, words: stats.words, seconds: stats.seconds, simulated };
    log(prod, `Wrote “${chapter.title}” — ${chapter.beats.length} beats (${i + 1}/${n}).`);
    await save(set);
  }
  // Top up an hour that runs short: new chunks go in before the closer until it reaches its length.
  for (let extra = 0; extra < 8 && !isPaused(set) && chapters.length >= n && (prod.script?.seconds || 0) < prod.targetMinutes * 60 * 0.92; extra++) {
    const pitch = await pitchChunk(c, outline, settings());
    const at = Math.max(0, chapters.length - 1);
    outline.chapters.splice(at, 0, pitch);
    const before = chapters.slice(Math.max(0, at - 2), at).map(ch => `“${ch.title}”: ${ch.beats.slice(-2).map(b => b.line).join(' ')}`).join(' … ');
    const { chapter, simulated: sim } = await writeChapter(c, outline, at, undefined, before, settings(), target);
    chapter.id = `ch${chapters.length}x${extra}`;
    simulated ||= sim;
    chapters.splice(at, 0, chapter);
    const stats = scriptStats(chapters);
    prod.script = { title: outline.title, logline: outline.logline, chapters, words: stats.words, seconds: stats.seconds, simulated };
    log(prod, `Running ${Math.round(stats.seconds / 60)} of ${prod.targetMinutes} min — added “${chapter.title}” before the closer.`);
    await save(set);
  }
}

// ---------------------------------------------------------------------
// plates — the master, then every camera derived from it
// ---------------------------------------------------------------------

function platePrompt(c: Comedian, prod: Production, cam: CameraId): string {
  const b = prod.bible!;
  const spec = CAMERAS[cam];
  const tail = `${b.lighting}. Color grade: ${b.grade}. Shot on ${b.lens}. Photorealistic, natural skin texture, a real live taping. No lettering, no signs, no logos, no text anywhere.`;
  if (cam === 'crowd') return `Cinematic still from a stand-up comedy special taped live at ${b.theater} in ${b.city}: ${spec.framing}, ${b.crowd}. ${tail}`;
  // Who the cameras show: once the master exists, the comic exactly as it drew them (so a text-only wide
  // cannot drift to a different person); before that, the world model's canon, then their written look.
  const look = (cam !== 'master' && prod.masterEssence) || W.world?.essence(c.id) || c.look || c.name;
  const canon = W.world?.canon(c.id, b) || '';
  return `Cinematic still from a stand-up comedy special taped live at ${b.theater} in ${b.city}: ${spec.framing}. ${look}, wearing ${b.wardrobe}, holding a microphone. ${b.stage}. ${tail} ${canon}`.trim();
}

/** The best rung for this camera: crops want a re-detail rung, angle changes want an editor. */
function rungFor(ladder: PlateEngine[], cam: CameraId, hasRef: boolean): PlateEngine | null {
  const spec = CAMERAS[cam];
  const by = (r: Rung) => ladder.find(e => e.rung === r) || null;
  if (!hasRef || !spec.from) return by('text');
  if (spec.crop) return by('kontext') || by('img2img') || by('text');
  // Angle changes: an editor keeps the face; img2img can only nudge the master; a wide is better from text.
  // A wide needs more room than the master has: an editor, else text that describes the master's own comic.
  if (cam === 'wide') return by('reference') || by('kontext') || by('text');
  return by('reference') || by('kontext') || by('img2img') || by('text');
}

async function shootPlates(set: ComedySet, c: Comedian): Promise<boolean> {
  const prod = set.premium!;
  const comfyUp = getEngines().comfy.state === 'online';
  const inv = comfyUp ? await getInventory() : null;
  const ladder = inv ? plateLadder(inv, await getCustomWorkflows(), settings().imageRecipe) : [];
  prod.rig = { ...(prod.rig || {}), plates: ladder[0]?.name || 'Nightshift stills', finishing: inv ? finishingPasses(inv) : [] };
  const plate = (cam: CameraId): Plate => {
    let p = prod.plates.find(x => x.camera === cam);
    if (!p) { p = { camera: cam, seed: (prod.seed + CAMERA_ORDER.indexOf(cam) * 7919) >>> 0, status: 'todo' }; prod.plates.push(p); }
    return p;
  };
  const uploads = new Map<CameraId, string>();
  // A production resumed after its master was shot still describes the comic from it.
  const masterDone = prod.plates.find(x => x.camera === 'master' && x.imageUrl);
  if (masterDone && !prod.masterEssence && prod.plates.some(x => x.status !== 'done')) prod.masterEssence = await readMaster(c, masterDone.imageUrl!) || undefined;
  for (const cam of CAMERA_ORDER) {
    if (isPaused(set)) return false;
    const p = plate(cam);
    if (p.status === 'done' && p.imageUrl) continue;
    const spec = CAMERAS[cam];
    const parent = spec.from ? prod.plates.find(x => x.camera === spec.from && x.imageUrl) : undefined;
    const prompt = platePrompt(c, prod, cam);
    try {
      if (!ladder.length) {
        // No ComfyUI image model: Nightshift shoots every plate from the bible (seeded, not derived).
        p.imageUrl = await renderStill(prompt, settings(), { label: `${set.title} · ${spec.name} plate`, itemKey: `original:${set.id}:${cam}`, seed: p.seed, ref: { comedianId: c.id } });
        p.method = 'nightshift';
      } else {
        // With a face-locking rung installed, the master is edited from the comic's own headshot (the world
        // model's anchor), so an Original shows the same face the Circuit does.
        const anchor = cam === 'master' ? W.world?.anchor(c.id) : null;
        const editor = anchor ? ladder.find(e => e.rung === 'reference' || e.rung === 'kontext') : undefined;
        const engine = editor || rungFor(ladder, cam, !!parent)!;
        let reference: string | undefined;
        if (editor && anchor) reference = await uploadImage(anchor, `standupify_orig_${set.id}_anchor.png`);
        else if (parent && engine.rung !== 'text') {
          reference = uploads.get(parent.camera) || await uploadImage(parent.imageUrl!, `standupify_orig_${set.id}_${parent.camera}.png`);
          uploads.set(parent.camera, reference);
        }
        const b = prod.bible!;
        const graph = buildPlateGraph(engine, {
          prompt, negative: NEGATIVE_PROMPT, width: PLATE.width, height: PLATE.height,
          seed: cam === 'master' ? (comedianSeed(c) ^ prod.seed) >>> 0 : p.seed,
          reference, refSize: editor ? undefined : PLATE, crop: editor ? undefined : spec.crop,
          edit: editor ? `Put this exact person on stage at ${b.theater}: ${spec.framing}, holding a microphone, wearing ${b.wardrobe}. ${b.stage}. ${b.lighting}. ${b.grade}.` : spec.edit,
          denoise: spec.crop ? 0.42 : cam === 'jib' ? 0.45 : 0.6
        }, inv!);
        p.imageUrl = await track({ label: `${set.title} · ${spec.name} plate (${engine.name})`, engine: 'ComfyUI', kind: 'image', ref: { comedianId: c.id } }, (h) => comfyRender(graph, 'image', h));
        p.method = engine.rung;
      }
      p.status = 'done';
      p.error = undefined;
      log(prod, `${spec.name} plate locked (${p.method}).`);
      if (cam === 'wide' && prod.bible) W.world?.theater(prod.bible, p.imageUrl);   // the theater joins the world
      if (cam === 'master' && !prod.masterEssence) prod.masterEssence = await readMaster(c, p.imageUrl!) || undefined;
    } catch (e) {
      p.status = 'failed';
      p.error = describeError(e);
      log(prod, `${spec.name} plate failed: ${p.error}`);
      if (cam === 'master') { await save(set); throw e; }
      // A derived camera that fails falls back to its parent's frame: same look, the motion prompt does the rest.
      if (parent?.imageUrl) { p.imageUrl = parent.imageUrl; p.status = 'done'; p.method = 'text'; }
    }
    await save(set);
  }

  // Key art: the master, upscaled when a 4x model is installed.
  const master = prod.plates.find(x => x.camera === 'master')?.imageUrl;
  if (master && !prod.keyArt) {
    prod.keyArt = master;
    const name = inv && finishingPasses(inv).length ? await uploadImage(master, `standupify_orig_${set.id}_keyart.png`).catch(() => '') : '';
    const g = name && inv ? upscaleGraph(name, inv, KEY_ART) : null;
    if (g) {
      try { prod.keyArt = await track({ label: `${set.title} · key art (4x)`, engine: 'ComfyUI', kind: 'image', ref: { comedianId: c.id } }, (h) => comfyRender(g, 'image', h)); } catch { /* the master is the poster */ }
    }
  }
  return prod.plates.filter(x => x.status === 'done').length === CAMERA_ORDER.length;
}

/** Read the comic off the master plate (Nightshift vision), so every text-only camera describes the same person. */
async function readMaster(c: Comedian, url: string): Promise<string | null> {
  if (vision.broken || getEngines().nightshift.state !== 'online' || getEngines().nightshift.classes?.vision?.availability === 'unavailable') return null;
  try {
    const image = await blobToDataUrl(await mediaBlob(url));
    const out = await priorityText(`Original · reading ${c.name} off the master`, () => chatJson<{ essence?: string; wardrobe?: string }>({
      task: 'cast', quality: settings().quality, maxTokens: 4000, images: [image],
      system: 'You are a continuity supervisor for a film. Output ONLY valid JSON.', prompt: ESSENCE_PROMPT
    }), { comedianId: c.id });
    return out?.essence && out.essence.length > 40 ? out.essence.slice(0, 420) : null;
  } catch (e) { noteVisionError(e); return null; }
}

// ---------------------------------------------------------------------
// shooting — coverage first, then every shot its own clip
// ---------------------------------------------------------------------

function shotPrompt(c: Comedian, prod: Production, shot: Shot): string {
  const b = prod.bible!;
  const look = prod.masterEssence || `${W.world?.essence(c.id) || c.look || c.name}, wearing ${b.wardrobe}`;
  if (shot.camera === 'crowd') return `${cap(shot.motion)}. ${b.crowd} at ${b.theater}, lit by the spill of the stage lights. ${b.lighting}. ${b.grade}. Live comedy special, photorealistic, cinematic.`;
  return `${cap(shot.motion)}. ${look}, a stand-up comedian performing a live comedy special at ${b.theater}, holding one microphone. ${CAMERAS[shot.camera].framing}. ${b.lighting}. ${b.grade}. Photorealistic concert film, the same person throughout, natural lip movement, steady identity.`;
}

const hashNum = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

async function shoot(set: ComedySet, c: Comedian): Promise<boolean> {
  const prod = set.premium!;
  const inv = await getInventory();
  const pick = chooseRecipe('video', inv, await getCustomWorkflows(), settings().videoRecipe);
  if (!pick) {
    if (!prod.log[0]?.text.startsWith('Waiting for a video model')) { log(prod, 'Waiting for a video model — add LTX-Video or Wan 2.2.'); await save(set); }
    return false;
  }
  prod.rig = { ...(prod.rig || {}), clips: pick.recipe.name, finishing: finishingPasses(inv) };
  const size = shotSize(pick.recipe.id);
  const uploads = new Map<CameraId, string>();
  const todo = remaining(prod);
  let n = 0;
  try {
    for (const shot of todo) {
      if (isPaused(set) || getEngines().comfy.state !== 'online') return false;
      // Every few clips, step aside for the Reel's best club sets.
      if (W.clips && W.clips % BREATHE_EVERY === 0 && W.reel?.busy()) {
        W.holding = false;
        W.reel.kick();
        for (let t = 0; t < 180 && W.reel.busy(); t++) await sleep(1000);
      }
      W.holding = true;
      const plate = prod.plates.find(p => p.camera === shot.camera)?.imageUrl || prod.plates.find(p => p.camera === 'master')?.imageUrl;
      if (!plate) throw new Error('The camera plates are missing.');
      let image = uploads.get(shot.camera);
      if (!image) { image = await uploadImage(plate, `standupify_orig_${set.id}_${shot.camera}.png`); uploads.set(shot.camera, image); }
      const params: VideoParams = {
        prompt: shotPrompt(c, prod, shot),
        negative: `${VIDEO_NEGATIVE}, different person, changing face, changing outfit, scene cut, text overlay, subtitles`,
        image, width: size.width, height: size.height,
        seconds: Math.max(2.5, Math.min(7, shot.seconds + 0.6)),
        seed: (hashNum(shot.id) ^ prod.seed) >>> 0
      };
      const graph = withInterpolation(pick.recipe.build(params, pick.picks || {}, inv), inv);
      const total = prod.shots.filter(s => prod.budget === 'full' || s.pass === 1).length;
      const done = prod.shots.filter(s => s.status === 'done').length;
      const t0 = Date.now();
      try {
        shot.clipUrl = await track({ label: `${set.title} · ${CAMERAS[shot.camera].name} · shot ${done + 1}/${total}`, engine: 'ComfyUI', kind: 'video', ref: { comedianId: c.id } }, (h) => comfyRender(graph, 'video', h));
        shot.status = 'done';
        shot.error = undefined;
        const took = (Date.now() - t0) / 1000;
        prod.renderSeconds = prod.renderSeconds ? Math.round(prod.renderSeconds * 0.8 + took * 0.2) : Math.round(took);
        W.clips++;
        n++;
      } catch (e) {
        shot.attempts++;
        shot.error = describeError(e);
        if (getEngines().comfy.state !== 'online') { await save(set); return false; }
        if (shot.attempts >= 2) { shot.status = 'failed'; log(prod, `Shot ${shot.id} (${CAMERAS[shot.camera].name}) failed twice — it borrows a sibling clip.`); }
      }
      if (prod.stage === 'shooting' && !prod.shots.some(s => s.pass === 1 && s.status === 'todo')) premiere(set, c);
      await save(set);
    }
  } finally { W.holding = false; W.reel?.kick(); }
  if (prod.stage === 'shooting') premiere(set, c);
  if (n) log(prod, prod.budget === 'full' ? 'Remaster complete: every shot has its own clip.' : 'Coverage complete.');
  await save(set);
  return true;
}

function premiere(set: ComedySet, c: Comedian) {
  const prod = set.premium!;
  if (prod.stage === 'premiered') return;
  prod.stage = 'premiered';
  prod.premieredAt = Date.now();
  const mins = Math.round((prod.script?.seconds || 0) / 60);
  log(prod, prod.budget === 'full' ? `Premiered. ${mins} minutes. Remastering every shot in the background.` : `Premiered. ${mins} minutes.`);
  W.news?.(`Premiere tonight: “${set.title}” — ${c.name}'s Standupify Original, ${mins} minutes live from ${prod.bible?.theater}.`, [c.id]);
}

// ---------------------------------------------------------------------
// recording — Nightshift voices each chapter while ComfyUI films
// ---------------------------------------------------------------------

/** Seconds of audio in a PCM WAV (the format Nightshift's narration ships as); null for anything else. */
async function wavSeconds(blob: Blob): Promise<number | null> {
  try {
    const head = new DataView(await blob.slice(0, 44).arrayBuffer());
    if (head.getUint32(0, false) !== 0x52494646) return null;   // "RIFF"
    const byteRate = head.getUint32(28, true);
    return byteRate ? (blob.size - 44) / byteRate : null;
  } catch { return null; }
}

async function recordVoice(set: ComedySet, c: Comedian) {
  const prod = set.premium!;
  if (W.voicing.has(set.id) || !prod.script) return;
  if (getEngines().nightshift.state !== 'online' || getEngines().nightshift.classes?.speech?.availability === 'unavailable') return;
  const plan = await planMedia('speech').catch((e) => ({ carrier: 'none' as const, reason: describeError(e) }));
  if (plan?.carrier !== 'jobs') {
    // Say why once, instead of skipping the voice track in silence.
    const why = `Voice track waiting: ${plan?.reason || 'Nightshift offers no speech jobs route right now'}. The theater uses the system voice meanwhile.`;
    if (!prod.log.some(l => l.text === why)) { log(prod, why); await save(set); }
    return;
  }
  W.voicing.add(set.id);
  try {
    for (const [i, ch] of prod.script.chapters.entries()) {
      if (ch.audioUrl || isPaused(set) || (ch.voiceTries || 0) >= 2) continue;
      ch.voiceTries = (ch.voiceTries || 0) + 1;
      const text = ch.beats.map(b => b.line).join(' ');
      try {
        const blob = await backgroundMedia(`${set.title} · recording “${ch.title}”`, (h) => makeMedia({
          output: 'speech', itemKey: `original:${set.id}:${ch.id}`, text,
          context: `${c.name}, ${c.voice} stand-up comedian, performing live in a sold-out theater: conversational, confident, real comic timing`,
          onProgress: (p) => h.update({ stage: p.step || (p.stage === 'render' ? 'Recording' : 'In line') })
        }), { comedianId: c.id });
        ch.audioUrl = await blobToDataUrl(blob);
        ch.audioSeconds = (await wavSeconds(blob)) ?? undefined;
        log(prod, `Recorded “${ch.title}” (${i + 1}/${prod.script.chapters.length}).`);
        await save(set);
      } catch (e) {
        log(prod, `“${ch.title}” could not be recorded (${describeError(e)}); it plays with the system voice.`);
      }
    }
  } finally { W.voicing.delete(set.id); }
}

// ---------------------------------------------------------------------
// cards + compatibility
// ---------------------------------------------------------------------

/** One bit per chapter, so the TV, the exporter and the classic player can all play an Original. */
function bitsOf(set: ComedySet): Bit[] {
  const prod = set.premium!;
  const plates = new Map(prod.plates.map(p => [p.camera, p.imageUrl]));
  return (prod.script?.chapters || []).map((ch, i) => {
    const clips = prod.shots.filter(s => s.chapter === i && s.clipUrl).map(s => ({ url: s.clipUrl!, move: s.camera }));
    const punches = ch.beats.filter(b => b.kind === 'punch' || b.kind === 'callback');
    return {
      id: prod.startedAt + i,
      title: ch.title,
      description: ch.beats.map(b => b.line).join(' '),
      visualPrompt: `performing “${ch.title}” at ${prod.bible?.theater || 'the theater'}`,
      imageUrl: plates.get('medium') || plates.get('master'),
      videoUrl: clips[0]?.url,
      videoStatus: clips.length ? 'completed' as const : undefined,
      cameraMove: clips[0] ? 'locked-off' : undefined,
      clips,
      audioUrl: ch.audioUrl,
      laughScore: punches.length ? Math.round((punches.reduce((a, b) => a + b.laugh, 0) / punches.length) * 10) / 10 : undefined
    };
  });
}

export function cardFor(set: ComedySet, c: Comedian): OriginalCard {
  const p = set.premium!;
  const inPlan = p.shots.filter(s => p.budget === 'full' || s.pass === 1);
  const done = inPlan.filter(s => s.status === 'done').length;
  const left = inPlan.filter(s => s.status === 'todo').length;
  const pass1 = p.shots.filter(s => s.pass === 1);
  return {
    setId: set.id, comedianId: c.id, comedianName: c.name, title: set.title, logline: set.logline,
    stage: p.stage, paused: !!p.paused, keyArt: p.keyArt || p.plates.find(x => x.camera === 'master')?.imageUrl,
    palette: p.bible?.palette, minutes: Math.round(((p.script?.seconds || p.targetMinutes * 60) / 60) * 10) / 10,
    plates: { done: p.plates.filter(x => x.status === 'done').length, total: CAMERA_ORDER.length },
    shots: { done, total: inPlan.length, pass1: pass1.filter(s => s.status === 'done').length, pass1Total: pass1.length },
    chapters: p.script?.chapters.length || 0, voiced: p.script?.chapters.filter(ch => ch.audioUrl).length || 0,
    etaMinutes: p.renderSeconds && left ? Math.round((p.renderSeconds * left) / 60) : null,
    log: p.log.slice(0, 8), error: p.error, source: p.source, startedAt: p.startedAt, premieredAt: p.premieredAt
  };
}
