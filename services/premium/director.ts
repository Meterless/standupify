// =====================================================================
// The director — pure, seeded. Turns a script into multi-camera coverage
// the way a live-special director calls it from the truck:
//
//   setups ride the master and the medium, swapping to a 3/4 angle on
//   long runs · punchlines land on the close-up · a big laugh cuts to the
//   crowd, then back out to the wide · act-outs go wide so you see the
//   body · crowd work cuts to the audience · nobody holds a shot past ~5 s
//
// Pass 1 is coverage (the first shot of each camera in each chapter, plus
// the title, walk-on and bow); pass 2 makes every remaining shot unique.
// Until a shot has its own clip, the player borrows the nearest clip from
// the same camera, so a production is watchable — and moving — early.
// =====================================================================

import type { CameraId, Chapter, Production, Script, ScriptBeat, Shot } from './types';

export const WORDS_PER_SECOND = 2.55;   // a stand-up's talking pace
export const MAX_SHOT = 5.5;
export const TITLE_SECONDS = 7;
export const WALKON_SECONDS = 9;
export const BOW_SECONDS = 8;
export const IDENT_SECONDS = 3.5;
export const CREDITS_SECONDS = 16;

export const countWords = (s: string) => s.split(/\s+/).filter(Boolean).length;
export const lineSeconds = (line: string) => Math.max(1.4, countWords(line) / WORDS_PER_SECOND);

/** How long the room laughs before the comic talks again. */
export function laughSeconds(b: Pick<ScriptBeat, 'kind' | 'laugh'>): number {
  if (b.kind === 'setup' || b.kind === 'open') return b.laugh >= 6 ? 1 : 0.2;
  if (b.laugh >= 9) return 4.2;
  if (b.laugh >= 8) return 3.2;
  if (b.laugh >= 6.5) return 2.2;
  if (b.laugh >= 5) return 1.2;
  return 0.5;
}

export function beatSeconds(b: ScriptBeat) { return lineSeconds(b.line) + laughSeconds(b); }

export function scriptStats(chapters: Chapter[]): { words: number; seconds: number } {
  let words = 0, seconds = TITLE_SECONDS + WALKON_SECONDS + BOW_SECONDS;
  for (const c of chapters) for (const b of c.beats) { words += countWords(b.line); seconds += beatSeconds(b); }
  return { words, seconds: Math.round(seconds) };
}

// ---------------------------------------------------------------------
// cameras
// ---------------------------------------------------------------------

export interface CameraSpec { name: string; framing: string; crop?: { x: number; y: number; w: number; h: number }; edit?: string; from: 'master' | 'wide' | null }

export const CAMERAS: Record<CameraId, CameraSpec> = {
  master: { name: 'Master', from: null, framing: 'medium-wide shot from the center aisle at stage height, the comedian framed knees-up at center stage beside the mic stand, the stage backdrop behind them' },
  medium: { name: 'Medium', from: 'master', crop: { x: 0.19, y: 0.06, w: 0.62, h: 0.62 }, framing: 'medium shot, waist-up, centered, shallow depth of field' },
  close:  { name: 'Close-up', from: 'master', crop: { x: 0.33, y: 0.03, w: 0.34, h: 0.34 }, framing: 'tight close-up on the face and the microphone, eyes sharp, backdrop melting into bokeh' },
  left:   { name: 'Stage left', from: 'master', edit: 'Move the camera to stage left: a 3/4 profile of the comedian from the side of the stage, the audience softly visible beyond them.', framing: 'three-quarter profile from stage left, long lens, the audience out of focus beyond them' },
  right:  { name: 'Stage right', from: 'master', edit: 'Move the camera to stage right: a 3/4 profile of the comedian from the other side of the stage, the backdrop glowing behind them.', framing: 'three-quarter profile from stage right, long lens, backdrop lights glowing behind them' },
  wide:   { name: 'Wide', from: 'master', edit: 'Pull the camera all the way back to the rear of the theater: a wide shot of the whole stage over the silhouetted heads of a packed audience, the comedian small at center stage.', framing: 'wide shot from the back of the house, the full stage over the silhouetted heads of a packed audience, the comedian small at center stage' },
  jib:    { name: 'Jib', from: 'wide', edit: 'Raise the camera high above the audience on a crane: a sweeping high-angle wide of the theater, stage lights and haze, the comedian at center stage.', framing: 'high crane angle above the audience, sweeping view of the whole theater, haze in the stage lights' },
  crowd:  { name: 'Crowd', from: null, framing: 'reaction shot of the audience from the edge of the stage, rows of people laughing hard in the spill of the stage lights' }
};

export const CAMERA_ORDER: CameraId[] = ['master', 'medium', 'close', 'left', 'right', 'wide', 'jib', 'crowd'];

// ---------------------------------------------------------------------
// coverage
// ---------------------------------------------------------------------

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cueText(b: ScriptBeat) {
  return (b.cue || '').replace(/[\[\]]/g, '').trim().slice(0, 120);
}

function motionFor(camera: CameraId, phase: Shot['phase'], b: ScriptBeat | null, r: () => number): string {
  const cue = b ? cueText(b) : '';
  const talk = cue ? `${cue}, talking to the room` : 'talking to the room with an expressive face and natural hand gestures';
  switch (phase) {
    case 'title': return 'a slow crane move drifting over the audience toward the empty, lit stage as the house lights go down, haze in the beams';
    case 'walkon': return 'the comedian walks out from the wings to the microphone stand, waving to the cheering audience, the camera tracks them in';
    case 'bow': return 'the comedian takes a bow, puts the mic back in the stand and waves, the audience on its feet applauding, the camera cranes up and back';
    case 'laugh':
      return camera === 'crowd'
        ? 'the audience bursts into big laughter, people doubled over and clapping, a slight handheld drift'
        : 'the comedian pauses and grins while the room roars with laughter, holding the mic, a slow push in';
  }
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  switch (camera) {
    case 'close': return `${pick(['a slow push in', 'a locked-off close-up', 'a gentle drift'])} on the comedian's face as they deliver the punchline, ${cue || 'eyes locked on the crowd'}, lips moving with the words`;
    case 'medium': return `${pick(['a subtle dolly in', 'a slow lateral slide', 'a steady tripod frame'])}, the comedian ${talk}`;
    case 'master': return `${pick(['a steady frame with a slow drift', 'a gentle push in', 'a locked-off frame'])}, the comedian ${talk}, shifting their weight by the mic stand`;
    case 'left': case 'right': return `${pick(['a slow arc around the comedian', 'a long-lens hold with a slight drift', 'a slow push'])}, the comedian ${talk}`;
    case 'wide': return `${pick(['a slow push toward the stage', 'a static wide', 'a slow lateral track'])} over the audience's heads, the comedian ${cue || 'pacing the stage and acting it out'}`;
    case 'jib': return 'a sweeping crane move across the theater, the comedian performing at center stage, the audience laughing';
    case 'crowd': return 'audience members leaning forward, reacting and laughing, a slight handheld drift';
  }
}

/** Multi-camera coverage for a whole script. Stable: same script + seed, same shots. */
export function coverage(script: Script, seed: number): Shot[] {
  const r = rng(seed ^ 0x2c1b3c6d);
  const shots: Shot[] = [];
  const firstUse = new Set<string>();
  const push = (s: Omit<Shot, 'id' | 'pass' | 'status' | 'attempts' | 'motion'> & { motion?: string }, b: ScriptBeat | null) => {
    const key = `${s.chapter}:${s.camera}`;
    const pass: 1 | 2 = firstUse.has(key) && s.phase !== 'title' && s.phase !== 'walkon' && s.phase !== 'bow' ? 2 : 1;
    firstUse.add(key);
    shots.push({ ...s, id: `sh${shots.length.toString(36)}`, pass, status: 'todo', attempts: 0, motion: s.motion || motionFor(s.camera, s.phase, b, r), seconds: Math.round(s.seconds * 10) / 10 });
  };

  push({ chapter: -1, beat: null, phase: 'title', camera: 'jib', seconds: TITLE_SECONDS }, null);
  push({ chapter: -1, beat: null, phase: 'walkon', camera: 'wide', seconds: WALKON_SECONDS * 0.6 }, null);
  push({ chapter: -1, beat: null, phase: 'walkon', camera: 'master', seconds: WALKON_SECONDS * 0.4 }, null);

  let last: CameraId = 'master';
  script.chapters.forEach((ch, ci) => {
    for (const b of ch.beats) {
      const total = lineSeconds(b.line);
      const n = Math.max(1, Math.ceil(total / MAX_SHOT));
      const cams: CameraId[] = [];
      const away = (xs: CameraId[]) => { const ok = xs.filter(x => x !== (cams[cams.length - 1] || last)); return ok[Math.floor(r() * ok.length)] || xs[0]; };
      for (let k = 0; k < n; k++) {
        const lastChunk = k === n - 1;
        switch (b.kind) {
          case 'punch': case 'callback':
            cams.push(lastChunk ? 'close' : away(['medium', 'master', 'left', 'right'])); break;
          case 'actout':
            cams.push(away(['wide', 'left', 'right', 'wide'])); break;
          case 'crowdwork':
            cams.push(k % 2 === 1 ? 'crowd' : away(['medium', 'left', 'right'])); break;
          case 'tag':
            cams.push(away(['medium', 'right', 'left', 'close'])); break;
          case 'close':
            cams.push(lastChunk ? 'close' : away(['master', 'medium'])); break;
          case 'open':
            cams.push(ci === 0 && k === 0 ? 'master' : away(['master', 'medium', 'wide'])); break;
          default:
            cams.push(away(['master', 'medium', 'medium', 'left', 'right']));
        }
      }
      for (const cam of cams) {
        push({ chapter: ci, beat: b.id, phase: 'line', camera: cam, seconds: total / n }, b);
        last = cam;
      }
      const laugh = laughSeconds(b);
      if (laugh >= 2.2) {
        push({ chapter: ci, beat: b.id, phase: 'laugh', camera: 'crowd', seconds: Math.min(2.2, laugh * 0.55) }, b);
        push({ chapter: ci, beat: b.id, phase: 'laugh', camera: r() < 0.35 ? 'jib' : 'wide', seconds: laugh - Math.min(2.2, laugh * 0.55) }, b);
        last = 'wide';
      } else if (laugh >= 1.2) {
        const cam: CameraId = last === 'close' ? (r() < 0.5 ? 'crowd' : 'wide') : 'close';
        push({ chapter: ci, beat: b.id, phase: 'laugh', camera: cam, seconds: laugh }, b);
        last = cam;
      }
    }
  });

  const end = script.chapters.length;
  push({ chapter: end, beat: null, phase: 'bow', camera: 'close', seconds: BOW_SECONDS * 0.35 }, null);
  push({ chapter: end, beat: null, phase: 'bow', camera: 'jib', seconds: BOW_SECONDS * 0.65 }, null);
  return shots;
}

/** The order clips get shot: coverage first (chapter by chapter), then every other shot. */
export function shootingOrder(shots: Shot[], budget: Production['budget']): Shot[] {
  const pass1 = shots.filter(s => s.pass === 1);
  const pass2 = budget === 'full' ? shots.filter(s => s.pass === 2) : [];
  return [...pass1, ...pass2].filter(s => s.status !== 'done');
}

function hashStr(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

/**
 * What to put on screen for a shot right now: its own clip, else a clip from
 * the same camera (same chapter first), started at a different moment so a
 * borrowed clip never looks like a repeat. `offset` is 0..1 of the spare time.
 */
export function clipFor(prod: Pick<Production, 'shots'>, shot: Shot): { url: string; offset: number; borrowed: boolean } | null {
  if (shot.clipUrl) return { url: shot.clipUrl, offset: 0, borrowed: false };
  const h = hashStr(shot.id);
  const pool = prod.shots.filter(s => s.clipUrl && s.camera === shot.camera && (s.phase === 'laugh') === (shot.phase === 'laugh'));
  const near = pool.filter(s => s.chapter === shot.chapter);
  const from = near.length ? near : pool;
  if (!from.length) return null;
  const pick = from[h % from.length];
  return { url: pick.clipUrl!, offset: ((h >>> 8) % 1000) / 1000, borrowed: true };
}

// ---------------------------------------------------------------------
// the running order the player follows
// ---------------------------------------------------------------------

export type Cue =
  | { kind: 'ident'; seconds: number }
  | { kind: 'title'; shots: Shot[]; seconds: number }
  | { kind: 'walkon'; shots: Shot[]; seconds: number }
  | { kind: 'beat'; chapter: number; beat: ScriptBeat; index: number; line: Shot[]; laugh: Shot[]; seconds: number; wordsBefore: number }
  | { kind: 'bow'; shots: Shot[]; seconds: number }
  | { kind: 'credits'; seconds: number };

export function runningOrder(prod: Pick<Production, 'script' | 'shots'>): Cue[] {
  const script = prod.script;
  if (!script) return [];
  const byBeat = new Map<string, Shot[]>();
  for (const s of prod.shots) if (s.beat) byBeat.set(s.beat, [...(byBeat.get(s.beat) || []), s]);
  const cues: Cue[] = [{ kind: 'ident', seconds: IDENT_SECONDS }];
  const title = prod.shots.filter(s => s.phase === 'title');
  const walk = prod.shots.filter(s => s.phase === 'walkon');
  cues.push({ kind: 'title', shots: title, seconds: TITLE_SECONDS });
  cues.push({ kind: 'walkon', shots: walk, seconds: WALKON_SECONDS });
  script.chapters.forEach((ch, ci) => {
    let words = 0;
    ch.beats.forEach((b, bi) => {
      const shots = byBeat.get(b.id) || [];
      cues.push({ kind: 'beat', chapter: ci, beat: b, index: bi, line: shots.filter(s => s.phase === 'line'), laugh: shots.filter(s => s.phase === 'laugh'), seconds: beatSeconds(b), wordsBefore: words });
      words += countWords(b.line);
    });
  });
  cues.push({ kind: 'bow', shots: prod.shots.filter(s => s.phase === 'bow'), seconds: BOW_SECONDS });
  cues.push({ kind: 'credits', seconds: CREDITS_SECONDS });
  return cues;
}

/** Which shot of a run is on screen at progress p (0..1), by each shot's share of the time. */
export function shotAt(shots: Shot[], p: number): Shot | null {
  if (!shots.length) return null;
  const total = shots.reduce((a, s) => a + s.seconds, 0) || 1;
  let t = 0;
  for (const s of shots) { t += s.seconds / total; if (p < t) return s; }
  return shots[shots.length - 1];
}
