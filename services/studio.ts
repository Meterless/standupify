// =====================================================================
// The studio — every creative action in Standupify, engine-agnostic.
//
//   words   → Nightshift chat     (cast, write, riff, judge, captions)
//   stills  → ComfyUI recipe      (FLUX / SDXL / your workflow)
//             else Nightshift     (jobs: attempt.image.still)
//   clips   → ComfyUI recipe      (LTX-Video / Wan / your workflow) + camera move
//   voice   → Nightshift          (jobs: attempt.voice.narrate)
//   walk-on → Nightshift          (jobs: attempt.music.score)
// =====================================================================

import { AISettings, Bit, Comedian, Material, Set as ComedySet } from '../types';
import { emit } from './bus';
import { chat, chatJson, describeError } from './nightshift/runtime';
import { makeMedia, planMedia, MediaOutput } from './nightshift/media';
import { runGraph, fetchFile, uploadImage, getInventory, ComfyFile } from './comfy/client';
import {
  chooseRecipe, rankRecipes, analyzeWorkflow, CustomWorkflow, RecipeStatus, ImageParams, VideoParams
} from './comfy/recipes';
import { moveById, venueById, NEGATIVE_PROMPT, VIDEO_NEGATIVE } from './comfy/presets';
import { getEngines } from './engines';
import { track, TaskHandle } from './tasks';

export { describeError };

export class StudioError extends Error {
  fix: string[];
  constructor(message: string, fix: string[] = []) { super(message); this.name = 'StudioError'; this.fix = fix; }
}

// ---------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------

export async function blobToDataUrl(blob: Blob): Promise<string> {
  if (typeof FileReader === 'undefined') {
    // The Station (Node) has no FileReader; Buffer does the same job.
    const b64 = Buffer.from(await blob.arrayBuffer()).toString('base64');
    return `data:${blob.type || 'application/octet-stream'};base64,${b64}`;
  }
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onloadend = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function hashNum(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const randomSeed = () => Math.floor(Math.random() * 2 ** 32);

// ---------------------------------------------------------------------
// Nightshift lane discipline (PRD v3 §14.4): what the user is waiting on
// goes first; background work (grading, voicing, music) runs one job at a
// time and never while a foreground request is in flight. A single local
// model lane stays responsive instead of being buried.
// ---------------------------------------------------------------------

let foreground = 0;
let idleWaiters: (() => void)[] = [];
// Grading needs the text model; makes need media engines. Separate queues,
// so a narration Nightshift is retrying never holds up the laugh meter.
type Lane = 'text' | 'media';
const laneChain: Record<Lane, Promise<unknown>> = { text: Promise.resolve(), media: Promise.resolve() };

async function inForeground<T>(work: () => Promise<T>): Promise<T> {
  foreground++;
  try { return await work(); }
  finally {
    if (--foreground === 0) { const w = idleWaiters; idleWaiters = []; w.forEach(r => r()); }
  }
}

function inBackground<T>(h: TaskHandle, lane: Lane, work: () => Promise<T>): Promise<T> {
  h.update({ stage: 'In line' });
  const run = laneChain[lane].catch(() => undefined).then(async () => {
    while (foreground > 0) await new Promise<void>(r => idleWaiters.push(r));
    if (h.signal.aborted) throw new StudioError('Cancelled.');
    return work();
  });
  laneChain[lane] = run;
  return run;
}

/** Nightshift text work that nobody is waiting on (the Circuit, gossip). */
export function backgroundText<T>(label: string, work: (h: TaskHandle) => Promise<T>, ref?: { comedianId?: string; bitId?: number }): Promise<T> {
  return track({ label, engine: 'Nightshift', kind: 'text', ref }, (h) => inBackground(h, 'text', () => work(h)));
}

/** Nightshift text that goes ahead of the background line: an Original's writers' room. */
export function priorityText<T>(label: string, work: (h: TaskHandle) => Promise<T>, ref?: { comedianId?: string; bitId?: number }): Promise<T> {
  return inForeground(() => track({ label, engine: 'Nightshift', kind: 'text', ref }, work));
}

/** The live class index (PRD v3 §8.2) — it outranks what a transform claims. */
function classRow(cls: string) {
  return getEngines().nightshift.classes?.[cls] || null;
}

export function judgeAvailable(): boolean {
  return classRow('judge')?.availability !== 'unavailable';
}

function requireNightshift() {
  const st = getEngines().nightshift.state;
  if (st === 'online') return;
  if (st === 'unauthorized') throw new StudioError('Nightshift refused the access token.', ['Open Engines and reconnect Nightshift.']);
  if (st === 'starting') throw new StudioError('Nightshift is still starting up.', ['Give it a few seconds — the button lights up when it is ready.']);
  throw new StudioError('Nightshift is not running, so nobody can write the jokes.', ['Press Start next to Nightshift.']);
}

// ---------------------------------------------------------------------
// custom workflows (dropped files + ./workflows folder)
// ---------------------------------------------------------------------

const CUSTOM_KEY = 'standupify_custom_workflows_v1';
let folderWorkflows: CustomWorkflow[] | null = null;

function droppedWorkflows(): CustomWorkflow[] {
  try { return JSON.parse(localStorage.getItem(CUSTOM_KEY) || '[]'); } catch { return []; }
}

export async function getCustomWorkflows(): Promise<CustomWorkflow[]> {
  if (folderWorkflows == null) {
    folderWorkflows = [];
    try {
      const r = await fetch('./api/workflows');
      const body = r.ok ? await r.json() : { data: [] };
      for (const f of body.data || []) {
        try { folderWorkflows.push({ ...analyzeWorkflow(f.graph, f.file), source: 'folder' }); } catch { /* skip non-API files */ }
      }
    } catch { /* static host */ }
  }
  return [...droppedWorkflows(), ...folderWorkflows];
}

export async function addWorkflowFile(file: File): Promise<CustomWorkflow> {
  const json = JSON.parse(await file.text());
  const wf = analyzeWorkflow(json, file.name);
  const list = droppedWorkflows().filter(w => w.id !== wf.id);
  localStorage.setItem(CUSTOM_KEY, JSON.stringify([wf, ...list]));
  emit('standupify:comfy-changed');
  return wf;
}

export function removeWorkflow(id: string) {
  localStorage.setItem(CUSTOM_KEY, JSON.stringify(droppedWorkflows().filter(w => w.id !== id)));
  emit('standupify:comfy-changed');
}

// ---------------------------------------------------------------------
// capabilities — what this machine can do right now (drives the whole UI)
// ---------------------------------------------------------------------

export interface Capabilities {
  write: boolean;
  stills: { engine: 'ComfyUI' | 'Nightshift'; name: string } | null;
  clips: { name: string; speed: string } | null;
  voice: boolean;
  music: boolean;
  imageRecipes: RecipeStatus[];
  videoRecipes: RecipeStatus[];
  reasons: { stills?: string; clips?: string; voice?: string; music?: string };
}

export async function getCapabilities(settings: AISettings): Promise<Capabilities> {
  const eng = getEngines();
  const nsOnline = eng.nightshift.state === 'online';
  const comfyOnline = eng.comfy.state === 'online';
  const caps: Capabilities = { write: nsOnline, stills: null, clips: null, voice: false, music: false, imageRecipes: [], videoRecipes: [], reasons: {} };

  if (comfyOnline) {
    const inv = await getInventory();
    const custom = await getCustomWorkflows();
    caps.imageRecipes = rankRecipes('image', inv, custom);
    caps.videoRecipes = rankRecipes('video', inv, custom);
    const img = chooseRecipe('image', inv, custom, settings.imageRecipe);
    const vid = chooseRecipe('video', inv, custom, settings.videoRecipe);
    if (img && settings.imageEngine !== 'nightshift') caps.stills = { engine: 'ComfyUI', name: img.recipe.name };
    if (vid) caps.clips = { name: vid.recipe.name, speed: vid.recipe.speed };
    else caps.reasons.clips = 'ComfyUI has no video model yet — add LTX-Video or Wan 2.2.';
    if (!img) caps.reasons.stills = 'ComfyUI has no image model yet.';
  } else {
    caps.reasons.clips = 'Start ComfyUI to animate bits.';
  }

  if (nsOnline) {
    const plan = (o: MediaOutput) => planMedia(o).catch(() => ({ carrier: 'none' as const, reason: 'Nightshift did not answer.' }));
    const [image, speech, music] = await Promise.all([plan('image'), plan('speech'), plan('music')]);
    // A transform can exist while its class has no room right now; the
    // class index is the live truth and its `why` is the honest reason.
    const usable = (p: { carrier: string; reason?: string }, cls: string) => {
      const row = classRow(cls);
      if (p.carrier !== 'jobs') return { ok: false, reason: p.reason };
      if (row?.availability === 'unavailable') return { ok: false, reason: row.why || `Nightshift can't make ${cls} right now.` };
      return { ok: true, reason: undefined };
    };
    const img = usable(image, 'image'), voice = usable(speech, 'speech'), mus = usable(music, 'music');
    if (!caps.stills && settings.imageEngine !== 'comfy' && img.ok) caps.stills = { engine: 'Nightshift', name: 'Nightshift stills' };
    caps.voice = voice.ok;
    caps.music = mus.ok;
    if (!caps.voice) caps.reasons.voice = voice.reason;
    if (!caps.music) caps.reasons.music = mus.reason;
    if (!caps.stills && !img.ok) caps.reasons.stills ||= img.reason;
  } else {
    caps.reasons.voice = 'Start Nightshift to give comedians a voice.';
  }
  if (!caps.stills) caps.reasons.stills ||= 'Start ComfyUI (or Nightshift) to shoot stills.';
  return caps;
}

// ---------------------------------------------------------------------
// Writing (Nightshift)
// ---------------------------------------------------------------------

export interface CastDraft {
  name: string; tagline: string; voice: string; style: string; audience: string; look: string;
  material: { name: string; type: string; description: string }[];
  setTitle: string; setLogline: string;
  bits: { title: string; description: string; action: string }[];
}

const CAST_SHAPE = `{
  "name": "stage name",
  "tagline": "one-line club billing",
  "voice": "delivery + point of view, e.g. deadpan, self-deprecating",
  "style": "observational | absurdist | crowd-work | storytelling | one-liners | dark | prop",
  "audience": "who loves them",
  "look": "a precise physical description reused in every photo: age, build, face, hair, outfit, one signature detail",
  "material": [ { "name": "short name", "type": "PERSONA|PROP|VENUE|THEME|BIT|CATCHPHRASE", "description": "detail" } ],
  "setTitle": "punchy title for the debut special",
  "setLogline": "one-line theme of the set",
  "bits": [ { "title": "bit name", "description": "the joke as they'd say it on stage: 2–4 sentences, setup then a sharp punchline", "action": "what they physically do while delivering it" } ]
}`;

export async function castComedian(
  input: { vibe?: string; photo?: string },
  settings: AISettings,
  onWriting?: (text: string) => void
): Promise<CastDraft> {
  requireNightshift();
  const seed = input.photo
    ? 'Build the comedian AROUND the person in the photo — their look, age, energy and attitude — so the headshot and the act match. Describe them precisely in "look".'
    : input.vibe ? `Build the comedian around this idea: "${input.vibe}".` : 'Invent a fresh, original stand-up comedian from scratch — surprise me.';
  return inForeground(() => track({ label: 'Casting a comedian', engine: 'Nightshift', kind: 'text' }, async (h) => {
    const draft = await chatJson<CastDraft>({
      task: 'cast',
      quality: settings.quality,
      system: 'You are a comedy talent scout and head writer for a stand-up special. The jokes must actually be funny: specific, surprising, tight. Output ONLY valid JSON.',
      prompt: `Discover a brand-new stand-up comedian. ${seed}\n\nWrite 8–12 pieces of material and EXACTLY 4 bits.\nReturn ONLY this JSON shape:\n${CAST_SHAPE}`,
      images: input.photo ? [input.photo] : undefined,
      maxTokens: 4096,
      onDelta: (t) => { onWriting?.(t); h.update({ progress: Math.min(0.95, t.length / 2600) }); },
      signal: h.signal
    });
    if (!draft?.name || !Array.isArray(draft.bits) || !draft.bits.length) throw new StudioError('Nightshift wrote a comedian without any bits. Try again.');
    draft.bits = draft.bits.slice(0, 6).map(b => ({ title: b.title || 'Untitled bit', description: b.description || '', action: b.action || 'gesturing at the crowd' }));
    draft.look ||= `${draft.name}, a stand-up comedian`;
    return draft;
  }));
}

function materialLine(material: Material[]) {
  return material.map(m => `@${m.name} (${m.type}): ${m.description}`).join(' | ');
}

export async function writeBit(comedian: Comedian, set: ComedySet, instruction: string, settings: AISettings): Promise<{ title: string; description: string; action: string }> {
  requireNightshift();
  const recent = set.bits.slice(-3).map(b => `"${b.title}": ${b.description}`).join('\n');
  return inForeground(() => track({ label: `Writing “${instruction.slice(0, 40)}”`, engine: 'Nightshift', kind: 'text', ref: { comedianId: comedian.id } }, async (h) => {
    const out = await chatJson<{ title: string; description: string; action: string }>({
      task: 'writeBit',
      quality: settings.quality,
      system: 'You are a stand-up comedy writer. Specific, surprising, tight. Output ONLY valid JSON.',
      prompt: `Comedian "${comedian.name}" — ${comedian.tagline}. Voice: ${comedian.voice}. Style: ${comedian.style}.
MATERIAL: ${materialLine(comedian.profile.material)}
THE SET SO FAR:
${recent || '(nothing yet)'}

Write the NEXT bit, based on: "${instruction}". Honor any @mentions. Callbacks to earlier bits are welcome.
Return ONLY JSON: { "title": "...", "description": "the joke as said on stage, 2–4 sentences, sharp punchline", "action": "what they physically do while delivering it" }`,
      signal: h.signal
    });
    return { title: out.title || 'New bit', description: out.description || '', action: out.action || 'leaning into the mic' };
  }));
}

export async function riff(comedian: Comedian, set: ComedySet, settings: AISettings): Promise<string> {
  requireNightshift();
  const shuffled = [...comedian.profile.material].sort(() => Math.random() - 0.5).slice(0, 3);
  const last = set.bits[set.bits.length - 1];
  const out = await inForeground(() => chatJson<{ instruction: string }>({
    task: 'riff',
    quality: settings.quality,
    system: 'You are in a stand-up writers room. Output ONLY valid JSON.',
    prompt: `Comedian "${comedian.name}" (${comedian.voice}; ${comedian.style}).
PREVIOUS BIT: ${last?.title} — ${last?.description}
PULL FROM: ${materialLine(shuffled)}
Pitch the next bit — escalate, call back, or work the crowd — combining the material above with @Name mentions.
Return ONLY JSON: { "instruction": "one punchy sentence describing the next bit" }`
  }));
  return out.instruction || 'Call back to the opener and top it.';
}

export async function inventMaterial(comedian: Pick<Comedian, 'name' | 'tagline' | 'voice' | 'style'>, existing: Material[], settings: AISettings) {
  requireNightshift();
  return chatJson<{ name: string; type: string; description: string }>({
    task: 'material',
    quality: settings.quality,
    system: 'You are a stand-up comedy writer. Output ONLY valid JSON.',
    prompt: `Comedian "${comedian.name}" (${comedian.tagline}). Voice: ${comedian.voice}. Style: ${comedian.style}.
Existing material: ${existing.map(m => m.name).join(', ') || 'none'}.
Invent ONE new piece of material that fits perfectly.
Return ONLY JSON: { "name": "...", "type": "PERSONA|PROP|VENUE|THEME|BIT|CATCHPHRASE", "description": "..." }`
  });
}

/** The laugh meter: Nightshift's judge class grades the joke 0–10. */
export async function judgeBit(comedian: Comedian, bit: Bit, settings: AISettings): Promise<{ score: number; note: string }> {
  requireNightshift();
  return track({ label: `Laugh meter · ${bit.title}`, engine: 'Nightshift', kind: 'text', ref: { comedianId: comedian.id, bitId: bit.id } }, (h) => inBackground(h, 'text', async () => {
    h.update({ stage: 'Grading' });
    // Grading is judge-class work; a box with no judge lane grades with its
    // text model instead of losing the laugh meter.
    const judgeLane = judgeAvailable();
    const ask = (task: 'judge' | 'copy') => chatJson<{ score: number; note: string }>({
      task,
      quality: settings.quality === 'local' ? 'local' : 'auto',
      temperature: 0.2,
      maxTokens: 1500,          // thinking models reason before they answer
      system: 'You are a tough, fair comedy club booker. You grade jokes by how hard a real room would laugh. Output ONLY valid JSON.',
      prompt: `Comedian style: ${comedian.style}, voice: ${comedian.voice}.
JOKE: "${bit.title}" — ${bit.description}
Grade it. 0 = silence, 5 = polite chuckle, 8 = big laugh, 10 = applause break.
Return ONLY JSON: { "score": number, "note": "one short line of punch-up advice" }`
    });
    let out: { score: number; note: string };
    try {
      out = await ask(judgeLane ? 'judge' : 'copy');
    } catch (e: any) {
      const noLane = judgeLane && ['class_no_route', 'class_not_ready', 'class_gated', 'class_no_capacity'].includes(e?.code);
      // A busy small model sometimes answers with nothing; one calm retry.
      if (!noLane) throw e;
      out = await ask('copy');
    }
    const score = Math.max(0, Math.min(10, Number(out.score) || 0));
    return { score: Math.round(score * 10) / 10, note: String(out.note || '').slice(0, 160) };
  }));
}

export async function writeCopy(prompt: string, settings: AISettings): Promise<string> {
  requireNightshift();
  return (await chat({ task: 'copy', quality: settings.quality, prompt, maxTokens: 1200 })).text;
}

// ---------------------------------------------------------------------
// Stills
// ---------------------------------------------------------------------

export function stillPrompt(comedian: Pick<Comedian, 'look' | 'name'>, action: string, venueId?: string): string {
  const venue = venueById(venueId);
  return `Photo of ${comedian.look || comedian.name}, a stand-up comedian performing live on stage with a microphone, ${action}. ${venue.style}`;
}

export function headshotPrompt(comedian: Pick<Comedian, 'look' | 'name'>, venueId?: string): string {
  const venue = venueById(venueId);
  return `Portrait headshot of ${comedian.look || comedian.name}, a stand-up comedian, confident expression, holding a microphone, shallow depth of field. ${venue.style}`;
}

export interface StillOptions {
  label: string;
  itemKey: string;              // stable key — reconnects Nightshift renders after a reload
  seed?: number;
  portrait?: boolean;
  ref?: { comedianId?: string; bitId?: number };
  force?: boolean;
}

/** Render one still with whatever engine can. Resolves to a data: URL. */
export async function renderStill(prompt: string, settings: AISettings, o: StillOptions): Promise<string> {
  const eng = getEngines();
  const wantComfy = settings.imageEngine !== 'nightshift' && eng.comfy.state === 'online';
  if (wantComfy) {
    const inv = await getInventory();
    const pick = chooseRecipe('image', inv, await getCustomWorkflows(), settings.imageRecipe);
    if (pick) {
      return track({ label: o.label, engine: 'ComfyUI', kind: 'image', ref: o.ref }, async (h) => {
        const params: ImageParams = {
          prompt, negative: NEGATIVE_PROMPT,
          width: o.portrait ? 832 : 1024, height: o.portrait ? 1024 : 768,
          seed: o.seed ?? randomSeed()
        };
        return comfyRender(pick.recipe.build(params, pick.picks || {}, inv), 'image', h);
      });
    }
  }
  if (settings.imageEngine !== 'comfy' && eng.nightshift.state === 'online') {
    const row = classRow('image');
    if (row?.availability === 'unavailable') {
      throw new StudioError(row.why || 'Nightshift has no room for an image engine right now.', ['Start ComfyUI from Engines to shoot stills.']);
    }
    const plan = await planMedia('image');
    if (plan.carrier === 'jobs') {
      return track({ label: o.label, engine: 'Nightshift', kind: 'image', ref: o.ref }, (h) => inBackground(h, 'media', async () => {
        const blob = await makeMedia({ output: 'image', itemKey: o.itemKey, text: prompt, force: o.force, onProgress: (p) => h.update({ stage: p.step || p.stage }) });
        return blobToDataUrl(blob);
      }));
    }
    throw new StudioError(plan.reason || 'Nightshift cannot make stills on this machine.', plan.fix || []);
  }
  throw new StudioError('Nothing can shoot stills yet.', ['Start ComfyUI from Engines — or Nightshift, which can shoot stills too.']);
}

/** Nightshift media work nobody is waiting on (an Original's voice track). */
export function backgroundMedia<T>(label: string, work: (h: TaskHandle) => Promise<T>, ref?: { comedianId?: string; bitId?: number }): Promise<T> {
  return track({ label, engine: 'Nightshift', kind: 'audio', ref }, (h) => inBackground(h, 'media', () => work(h)));
}

export async function comfyRender(graph: Record<string, any>, want: 'image' | 'video', h: TaskHandle): Promise<string> {
  const { files } = await runGraph(graph, {
    signal: h.signal,
    onProgress: (p) => h.update({ progress: p.phase === 'queued' ? -1 : p.overall, stage: p.queueAhead ? `${p.label} · ${p.queueAhead} ahead` : p.label }),
    onPreview: (url) => h.update({ preview: url })
  });
  const pick = (k: ComfyFile['kind']) => files.find(f => f.kind === k && f.type === 'output') || files.find(f => f.kind === k);
  const file = pick(want) || (want === 'video' ? pick('image') : null);
  if (!file) throw new StudioError(`ComfyUI finished but saved no ${want}.`);
  return blobToDataUrl(await fetchFile(file));
}

// ---------------------------------------------------------------------
// Clips (ComfyUI image → video)
// ---------------------------------------------------------------------

export async function animateBit(comedian: Comedian, bit: Bit, moveId: string, settings: AISettings): Promise<string> {
  if (getEngines().comfy.state !== 'online') throw new StudioError('ComfyUI is not running, so nothing can animate the bit.', ['Press Start next to ComfyUI in Engines.']);
  if (!bit.imageUrl || /^https?:/.test(bit.imageUrl)) throw new StudioError('This bit needs a still before it can move. Shoot it first.');
  const inv = await getInventory();
  const pick = chooseRecipe('video', inv, await getCustomWorkflows(), settings.videoRecipe);
  if (!pick) throw new StudioError('ComfyUI has no video model yet.', ['Add LTX-Video (fast) or Wan 2.2 — `npm run setup:comfy -- --video` downloads one.']);
  const move = moveById(moveId);
  return track({ label: `${move.name} · ${bit.title}`, engine: 'ComfyUI', kind: 'video', ref: { comedianId: comedian.id, bitId: bit.id } }, async (h) => {
    h.update({ stage: 'Uploading start frame' });
    const image = await uploadImage(bit.imageUrl!, `standupify_${bit.id}.png`);
    const wan = pick.recipe.id.startsWith('wan');
    const params: VideoParams = {
      // Video models weight the start of the prompt most: lead with the camera move,
      // keep the subject short, and leave the joke text out (it doesn't render).
      prompt: `${move.motion[0].toUpperCase()}${move.motion.slice(1)}. ${comedian.look || comedian.name}, a stand-up comedian holding a microphone on stage, ${bit.visualPrompt || 'gesturing to the crowd'}, talking with an expressive face while the audience laughs. Cinematic, realistic, steady subject, one microphone.`,
      negative: VIDEO_NEGATIVE,
      image,
      width: wan ? 960 : 768,
      height: wan ? 544 : 512,
      seconds: settings.clipSeconds || 4,
      seed: randomSeed()
    };
    return comfyRender(pick.recipe.build(params, pick.picks || {}, inv), 'video', h);
  });
}

// ---------------------------------------------------------------------
// Voice + walk-on music (Nightshift jobs)
// ---------------------------------------------------------------------

function requireClass(cls: string, what: string) {
  const row = classRow(cls);
  if (row?.availability === 'unavailable') throw new StudioError(row.why || `Nightshift can't make ${what} right now.`);
}

export async function voiceBit(comedian: Comedian, bit: Bit, force = false): Promise<string> {
  requireNightshift();
  requireClass('speech', 'narration');
  return track({ label: `Voicing · ${bit.title}`, engine: 'Nightshift', kind: 'audio', ref: { comedianId: comedian.id, bitId: bit.id } }, (h) => inBackground(h, 'media', async () => {
    const blob = await makeMedia({
      output: 'speech',
      itemKey: `bit:${bit.id}:${hashNum(bit.description).toString(36)}`,
      text: bit.description,
      context: `${comedian.name}, ${comedian.voice} stand-up comedian, performing "${bit.title}"`,
      force,
      onProgress: (p) => h.update({ stage: p.step || (p.stage === 'render' ? 'Recording' : p.stage === 'source' ? 'Warming up' : 'In line') })
    });
    return blobToDataUrl(blob);
  }));
}

export async function walkOnMusic(comedian: Comedian, force = false): Promise<string> {
  requireNightshift();
  requireClass('music', 'walk-on music');
  return track({ label: `Walk-on music · ${comedian.name}`, engine: 'Nightshift', kind: 'audio', ref: { comedianId: comedian.id } }, (h) => inBackground(h, 'media', async () => {
    const blob = await makeMedia({
      output: 'music',
      itemKey: `walkon:${comedian.id}`,
      text: `Short punchy walk-on music for a stand-up comedian: ${comedian.style}, ${comedian.voice}. Brass stabs, upbeat, 15 seconds, ends on a button.`,
      context: `${comedian.name} — ${comedian.tagline}`,
      force,
      onProgress: (p) => h.update({ stage: p.step || p.stage })
    });
    return blobToDataUrl(blob);
  }));
}

/** Stable per-comedian seed: same look + same seed keeps stills consistent. */
export function comedianSeed(c: Pick<Comedian, 'id'>): number { return hashNum(c.id) % 2 ** 31; }
