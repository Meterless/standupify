// =====================================================================
// The Circuit — an autonomous stand-up league.
//
// Comedians are persistent actors: they get booked at clubs, write a new
// set for every show (Nightshift "rehearses" several drafts and keeps the
// best), face a three-judge panel and a simulated crowd, win or bomb,
// climb from open mic to legend, form rivalries, steal jokes (and get
// caught on the evidence), mentor apprentices and retire. Founders are a
// starting cohort, not a cap.
//
// Deterministic core: models write and grade; seeded rules decide who is
// booked, how the crowd reacts, ratings, promotions and storylines, and
// every state change lands in the event log.
// =====================================================================

import type { CraftId } from './masters';
import type { InnerState } from './inner';
import type { WorldState } from '../world/model';

export type CareerStage = 'open_mic' | 'regular' | 'feature' | 'headliner' | 'legend';
export type LifeState = 'active' | 'retired';

export interface SkillVector {
  writing: number;        // 1–10
  delivery: number;
  crowdwork: number;
  originality: number;
  presence: number;
}

export interface CircuitStats {
  comedianId: string;
  elo: number;
  stage: CareerStage;
  life: LifeState;
  skills: SkillVector;
  doctrine: string;              // the school of comedy they carry
  fans: number;
  shows: number;
  wins: number;
  bombs: number;
  streak: number;                // + win streak, − losing streak
  bestScore: number;
  titles: number;                // championships
  founderId: string;             // lineage root (self for founders)
  mentorId: string | null;
  generation: number;            // 0 = founder
  apprentices: string[];
  lastShowNight: number | null;
  circuitSetId: string | null;   // a Set that collects their circuit bits
  eloHistory: number[];          // last 30
  joinedNight: number;
  clubWins: Record<string, number>;
  specials?: string[];           // Set ids of specials the Circuit produced for them
  specialBitIds?: number[];      // circuit bits already used in a special
  lens?: Lens;                   // how the Forge made them (founder / newcomer / imitator of … )
  museId?: string | null;        // the comic they were forged in answer to
  bornEra?: string | null;       // the era they were born into
  aim?: Aim | null;              // what they are chasing right now
  aimsWon?: number;
  journal?: { night: number; text: string }[];   // newest first, capped
  presence?: StagePresence;      // how they work a room (the Room)
  inner?: InnerState;            // drives, attention, monologue, initiative (inner.ts)
}

export type Lens = 'mirror' | 'counter' | 'orthogonal' | 'complement' | 'antagonist' | 'disciple' | 'founder' | 'newcomer';

export interface Era { name: string; doctrine: string; school: keyof SkillVector; sinceNight: number; strength: number }
export interface EraState { current: Era | null; pending: { doctrine: string; school: string; seen: number } | null; history: Era[]; counts: Record<string, number> }

export type AimKind = 'rank' | 'summit' | 'dethrone' | 'title' | 'club' | 'avenge' | 'special';
export interface Aim { kind: AimKind; target?: string; club?: string; stage?: CareerStage; since: number; text: string }

export type ShowFormat = 'open_mic' | 'showcase' | 'roast_battle' | 'headliner' | 'championship';

export interface Club {
  id: string;
  name: string;
  venue: string;                 // presets VENUES id (lighting/look for stills)
  prestige: number;              // 1–5
  crowd: string;                 // who sits in the room
  loves: string[];               // styles that play well here
  formats: ShowFormat[];         // rotation
  champion: string | null;       // house champion comedianId
  blurb: string;
}

export interface JudgeCard { judge: string; score: number; line: string }

export interface Performance {
  comedianId: string;
  title: string;
  text: string;
  target?: string;               // roast battle: who they roasted
  cards: JudgeCard[];
  judgeMean: number;
  crowd: number;                 // simulated room reaction 0–10
  laughs: number;
  moments: string[];             // "applause break", "heckler — destroyed him", …
  final: number;
  rank: number;
  eloBefore: number;
  eloAfter: number;
  rehearsed: number;             // drafts Nightshift wrote before picking this one
  simulated: boolean;            // written from material because Nightshift was offline
  imageUrl?: string;
  videoUrl?: string;             // the first clip the Reel shot of this set
  clips?: { url: string; move: string }[];   // every angle (only the best sets get shot)
  bitId?: number;                // the bit appended to their circuit set
  stage?: StageNotes;            // how they worked the room tonight
}

export interface Show {
  id: string;
  night: number;
  clubId: string;
  format: ShowFormat;
  theme: string;
  lineup: string[];
  performances: Performance[];
  winnerId: string | null;
  headline: string;
  startedAt: number;
  endedAt: number | null;
  seed: number;
}

export type CircuitEventKind =
  | 'debut' | 'win' | 'upset' | 'bomb' | 'streak' | 'promotion' | 'title'
  | 'rivalry' | 'theft' | 'apprentice' | 'retirement' | 'applause' | 'heckler' | 'season' | 'special'
  | 'arrival' | 'era' | 'aim' | 'room' | 'study' | 'mind';

export interface CircuitEvent {
  id: string;
  night: number;
  kind: CircuitEventKind;
  text: string;
  actors: string[];
  showId?: string;
  evidence?: { a: string; b: string; showA?: string; showB?: string };
  at: number;
}

export interface Rivalry { a: string; b: string; heat: number; meetings: number; aWins: number; bWins: number; lastNight: number }

/** A small, consequential exchange between comics after a real Circuit show. */
export interface BackstageExchange {
  id: string;
  showId: string;
  night: number;
  kind: 'mentoring' | 'collaboration' | 'rematch';
  actors: [string, string];
  text: string;
  topic: string;                  // the drill, shared premise, or close finish
  resolvedNight?: number;         // a rematch has since been played
}

export interface CircuitState {
  version: 1;
  seed: number;
  night: number;                 // nights completed
  live: boolean;                 // the circuit runs on its own
  rehearsals: number;            // drafts per set (Nightshift best_of_n)
  clubs: Club[];
  stats: Record<string, CircuitStats>;
  rivalries: Rivalry[];
  events: CircuitEvent[];        // newest first, capped
  champion: string | null;       // reigning Circuit champion
  pending?: PendingShow | null;  // a show in progress — survives a reload
  era?: EraState;                // which style is winning, and the ages so far
  lore?: Lore[];                 // the Circuit's famous bits — what the regulars call back
  world?: WorldState;            // characters, places, things: the canon every render follows
  backstage?: BackstageExchange[]; // newest first, capped at 60
  backstageThroughNight?: number;  // settlement watermark, including nights with no exchanges
  createdAt: number;
}

export interface PendingShow {
  show: Show;
  offline: boolean;
  jobs: Record<string, string>;  // comedianId → rehearsal job id (reconnect, never resubmit)
  room?: RoomState;              // the living room for this show — survives a reload
}

// ---------------------------------------------------------------------
// The Room — stage presence and world state (see room.ts, masters.ts)
// ---------------------------------------------------------------------

export interface StagePresence {
  persona: string;               // PERSONAS key: their relationship with a room
  masters: string[];             // MASTERS keys they study (craft only)
  signature: CraftId[];          // the moves they lean on
  mastery: Partial<Record<CraftId, number>>;   // 0–10, grows on stage
  tempo: 'slow' | 'measured' | 'quick' | 'rapid';
  silence: number;               // 0–10 comfort letting a joke breathe
  mic: string;
  walkon: string;
  closer: string;
  lesson: { night: number; master: string; craft: CraftId; text: string } | null;   // what they are drilling
  hits: { title: string; night: number }[];   // their own famous bits
}

export interface RoomGauge { energy: number; warmth: number; focus: number }

export interface RoomPerson { id: string; who: string; tags: string[]; loud: boolean; seat: string; usedBy?: string }

export interface RoomIncident {
  slot: number;                  // during whose set
  kind: 'phone' | 'tray' | 'walkout' | 'cake' | 'heckler' | 'mic' | 'lights' | 'siren' | 'laugh';
  text: string;
  tags: string[];
}

export interface RoomState extends RoomGauge {
  buzz: number;                  // how many drinks in
  size: 'packed' | 'full' | 'half-empty';
  regulars: boolean;             // the regulars know the Circuit's famous bits
  known: string[];               // Lore ids they will recognize
  people: RoomPerson[];
  incidents: RoomIncident[];
  heard: { comedianId: string; title: string; hook: string }[];   // tonight so far
  lastKill: string | null;
  lastBomb: string | null;
  theme: string;
}

export interface Beat { line: string; cue?: string; lead?: string }

export interface StageNotes {
  delivery: Beat[];              // the set with its stage directions
  craft: CraftId[];              // techniques it used
  room: { before: RoomGauge; after: RoomGauge };
  followed: 'killer' | 'bomb' | null;
  incident?: string;
  handled?: boolean;
  worked?: string[];
  callbacks?: string[];
  lift?: number;                 // what working the room did to the crowd
  notes?: string[];
}

export interface Lore { id: string; comedianId: string; title: string; night: number; clubId: string; heat: number }

export const STAGE_LABEL: Record<CareerStage, string> = {
  open_mic: 'Open micer', regular: 'Regular', feature: 'Feature', headliner: 'Headliner', legend: 'Legend'
};

export const FORMAT_LABEL: Record<ShowFormat, string> = {
  open_mic: 'Open Mic', showcase: 'Showcase', roast_battle: 'Roast Battle', headliner: 'Headliner Night', championship: 'Championship'
};
