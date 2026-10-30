// =====================================================================
// Standupify Originals — the premium tier.
//
// A regular special is a playlist of club sets. An Original is produced
// like a streaming-network hour: a production bible, a 12–16 minute
// script with real structure, a fixed theater shot by eight locked
// cameras, multi-cam coverage cut on the beat, the comic's own voice, a
// room that laughs where the jokes land, a title sequence and credits.
//
// The production lives on its Set (`set.premium`) so it travels with
// the roster, the Station and the exports, and resumes after any restart.
// =====================================================================

/** The eight cameras of an Original. Every one is derived from the master plate. */
export type CameraId = 'master' | 'medium' | 'close' | 'left' | 'right' | 'wide' | 'jib' | 'crowd';

export type BeatKind = 'open' | 'setup' | 'punch' | 'tag' | 'actout' | 'crowdwork' | 'callback' | 'close';

export interface ScriptBeat {
  id: string;
  kind: BeatKind;
  line: string;                  // exactly what they say
  cue?: string;                  // what they do while they say it
  laugh: number;                 // predicted room reaction 0–10 (drives the cut and the laugh track)
}

export interface Chapter {
  id: string;
  title: string;                 // the chunk's name (shown on the scrubber, never on screen)
  beats: ScriptBeat[];
  audioUrl?: string;             // Nightshift reading the whole chapter
  audioSeconds?: number;
  voiceTries?: number;           // a speech lane that keeps failing is not asked forever
}

export interface Script {
  title: string;
  logline: string;
  chapters: Chapter[];
  words: number;
  seconds: number;               // estimated runtime, laughs included
  simulated: boolean;            // built from their material because Nightshift could not write it
}

export interface Bible {
  theater: string;               // "The Orpheum"
  city: string;
  stage: string;                 // set dressing, one sentence
  lighting: string;
  grade: string;                 // the color grade, in cinematographer words
  wardrobe: string;              // what they wear for the taping
  crowd: string;                 // who fills the seats
  lens: string;                  // the camera package
  palette: [string, string, string];   // hex: key light, backdrop, shadow (UI + title card)
  tagline: string;               // the key-art line
}

export interface Plate {
  camera: CameraId;
  imageUrl?: string;
  seed: number;
  status: 'todo' | 'done' | 'failed';
  method?: 'reference' | 'kontext' | 'img2img' | 'text' | 'nightshift';
  error?: string;
}

export interface Shot {
  id: string;
  chapter: number;               // -1 = title + walk-on, chapters.length = the bow
  beat: string | null;           // ScriptBeat id (null for title / walk-on / bow)
  phase: 'line' | 'laugh' | 'title' | 'walkon' | 'bow';
  camera: CameraId;
  seconds: number;               // estimated screen time
  motion: string;                // what the camera and the comic do (video prompt)
  pass: 1 | 2;                   // 1 = coverage (one clip per camera per chapter), 2 = every shot unique
  clipUrl?: string;
  status: 'todo' | 'done' | 'failed';
  attempts: number;
  error?: string;
}

export type ProductionStage = 'greenlit' | 'bible' | 'script' | 'plates' | 'voice' | 'shooting' | 'premiered';

// Recording runs alongside the shoot (Nightshift voices while ComfyUI films), so it is not a step here.
export const STAGE_ORDER: ProductionStage[] = ['greenlit', 'bible', 'script', 'plates', 'shooting', 'premiered'];

export const STAGE_LABEL: Record<ProductionStage, string> = {
  greenlit: 'Greenlit', bible: 'Production design', script: 'Writers’ room', plates: 'Camera plates',
  voice: 'Recording', shooting: 'Shooting', premiered: 'Premiered'
};

export type Budget = 'full' | 'coverage';

export interface Production {
  version: 1;
  stage: ProductionStage;
  seed: number;
  targetMinutes: number;         // 12–16
  budget: Budget;                // full = every shot its own clip; coverage = one clip per camera per chapter
  source: 'circuit' | 'studio';  // greenlit by the Circuit's network, or by you
  bible?: Bible;
  outline?: { title: string; logline: string; chapters: { title: string; premise: string; from?: number }[] };
  script?: Script;
  plates: Plate[];
  shots: Shot[];
  keyArt?: string;               // the poster frame (upscaled master when the rig allows)
  masterEssence?: string;        // the comic as the master plate actually drew them (vision read): text-only cameras describe this
  rig?: { plates?: string; clips?: string; finishing?: string[] };
  renderSeconds?: number;        // running average per clip, for the ETA
  log: { at: number; text: string }[];
  paused?: boolean;
  error?: string;
  startedAt: number;
  updatedAt: number;
  premieredAt?: number;
}

/** A light summary for lists (no script text, no shot list). */
export interface OriginalCard {
  setId: string;
  comedianId: string;
  comedianName: string;
  title: string;
  logline: string;
  stage: ProductionStage;
  paused: boolean;
  keyArt?: string;
  palette?: [string, string, string];
  minutes: number;               // estimated runtime
  plates: { done: number; total: number };
  shots: { done: number; total: number; pass1: number; pass1Total: number };
  chapters: number;
  voiced: number;
  etaMinutes: number | null;
  log: { at: number; text: string }[];
  error?: string;
  source: Production['source'];
  startedAt: number;
  premieredAt?: number;
}
