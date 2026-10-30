
// =====================================================================
// Standupify — the open-source comedy special studio.
//
// Domain: a Comedian (persona) performs Sets (stand-up routines) built
// from Bits (individual jokes). Nightshift writes, judges and voices them;
// ComfyUI shoots and animates them. The Night Shift loop keeps producing
// Sets, Clips and Promos for the roster while you sleep.
//
// This file is the source of truth for the shared data model.
// =====================================================================

import type { Production } from './services/premium/types';

/** Nightshift disposition the user picks once for the whole app. */
export type Quality = 'auto' | 'fast' | 'deep' | 'local';

/** Where stills come from. "auto" = ComfyUI when it can, else Nightshift. */
export type ImageEngine = 'auto' | 'comfy' | 'nightshift';

export interface AISettings {
  quality: Quality;
  imageEngine: ImageEngine;
  imageRecipe: string | null;      // ComfyUI recipe id; null = best installed
  videoRecipe: string | null;
  venue: string;                   // services/comfy/presets VENUES id
  cameraMove: string;              // services/comfy/presets CAMERA_MOVES id
  clipSeconds: number;
  autoVoice: boolean;              // narrate new bits with Nightshift speech
  autoJudge: boolean;              // run the laugh meter on new bits
  autoOriginals?: boolean;         // the Circuit greenlights Originals for its legends and champions
}

// A comedian's "material bank" — the reusable building blocks of their act.
// PERSONA   — recurring characters / impressions they do
// PROP      — objects, brands, or running subjects of their jokes
// VENUE     — clubs, cities, or settings they riff about
// THEME     — recurring comedic angles (e.g. "dating in your 30s")
// BIT       — a premise / chunk of material
// CATCHPHRASE — a signature tagline or callback
export type MaterialType =
  | 'PERSONA'
  | 'PROP'
  | 'VENUE'
  | 'THEME'
  | 'BIT'
  | 'CATCHPHRASE';

export interface Material {
  id: string;
  name: string;
  type: MaterialType;
  description: string;
}

export type VideoStatus = 'idle' | 'processing' | 'completed' | 'failed';

// A single joke / chunk of a set. Structurally identical to the original
// scene so the player, exporter, and broadcast modes keep working.
export interface Angle { url: string; move: string }

export interface Bit {
  id: number;
  title: string;          // the bit's name, e.g. "Self-Checkout Rage"
  description: string;    // the joke text (setup + punchline)
  visualPrompt: string;   // how to render the comedian delivering it
  imageUrl?: string;
  videoUrl?: string;
  videoStatus?: VideoStatus;
  videoError?: string;
  cameraMove?: string;    // the preset the clip was shot with
  clips?: Angle[];        // every angle the Reel shot (TV cuts between them)
  audioUrl?: string;      // Nightshift narration
  laughScore?: number;    // 0–10 from the Nightshift judge
  laughNote?: string;
}

export enum AppState {
  STAGE = 'STAGE',           // home / green room — generate + roster strip
  CASTING = 'CASTING',       // inventing the comedian + writing the first set
  FILMING = 'FILMING',       // rendering bit visuals
  VIEWING = 'VIEWING',       // set player
  ADDING_BIT = 'ADDING_BIT', // writing + rendering a new bit
  ROSTER = 'ROSTER',         // all comedians
  SETTINGS = 'SETTINGS',     // command center
  BROADCAST = 'BROADCAST',   // retro comedy-club TV
  CONSOLE = 'CONSOLE',       // autonomous control room
  ERROR = 'ERROR'
}

// =====================================================================
// Roster entities
// =====================================================================

export type ComedianStatus = 'draft' | 'active' | 'paused' | 'archived';
export type PublishVisibility = 'private' | 'outbox' | 'openmic_network';

export interface AutopilotConfig {
  enabled: boolean;
  setsPerWeek: number;            // default 1
  clipsPerSet: number;            // default 5
  generateVideo: boolean;         // default false (Veo is costly)
  requireApproval: boolean;       // default true
  tickIntervalMs: number;         // how often the scheduler wakes (default 60_000)
  setIntervalMs: number;          // derived: ms between set jobs
  lastSetAt?: number;
}

export type ShortPlatform = 'youtube_shorts' | 'instagram_reel' | 'x_video' | 'tiktok';

export interface PublishingSettings {
  visibility: PublishVisibility;
  clipPlatforms: ShortPlatform[];
  publishTargetName: string;      // e.g. "OpenMic Network"
}

export interface ComedianProfile {
  material: Material[];           // the material bank (PERSONA / BIT / THEME / ...)
  runningBits: string[];          // signature callbacks the Writer leans on
  viralClipIds: string[];         // Clip ids that performed well
  audienceSignals: string[];      // free-text notes the Analytics Agent appends
  brandSafetyRules: string[];     // e.g. "no real people", "keep it PG-13"
  promoVoice?: string;            // tone for promo copy
}

export interface Comedian {
  id: string;
  // v2 will add: ownerId: string
  name: string;                   // stage name
  tagline: string;                // one-line bio / billing
  voice: string;                  // delivery + perspective (e.g. "deadpan, self-deprecating")
  style: string;                  // observational / absurdist / crowd-work / storytelling
  audience: string;
  status: ComedianStatus;
  publishVisibility: PublishVisibility;
  profile: ComedianProfile;
  publishingSettings: PublishingSettings;
  autopilotConfig: AutopilotConfig;
  avatarImage?: string;           // optional seed / headshot image (base64)
  look?: string;                  // physical description reused in every still
  headshotUrl?: string;           // rendered headshot
  venue?: string;                 // VENUES id they play
  walkOnUrl?: string;             // walk-on music (Nightshift)
  createdAt: number;
  updatedAt: number;
}

export type SetStatus =
  | 'draft'         // generated by Writer, bits may still be rendering
  | 'rendering'     // images / video still in flight
  | 'ready'         // all assets present, awaiting approval
  | 'approved'      // user approved
  | 'submitted'     // written to outbox
  | 'published';    // marked as published (manual link or future server)

export interface Clip {
  id: string;
  setId: string;
  comedianId: string;
  title: string;
  hook: string;
  caption: string;
  platformFormat: ShortPlatform;
  sourceBitId?: number;
  imageUrl?: string;
  videoUrl?: string;
  thumbnailUrl?: string;
  status: 'draft' | 'approved' | 'submitted' | 'published';
  analytics?: ClipAnalytics;
  createdAt: number;
}

export interface Promo {
  id: string;
  setId: string;
  comedianId: string;
  type: 'social_post' | 'poster' | 'announcement' | 'sponsor';
  sponsorId?: string;
  title: string;
  copy: string;
  visualPrompt: string;
  imageUrl?: string;
  videoUrl?: string;
  durationSec: number;
  createdAt: number;
}

export interface ClipAnalytics {
  views?: number;
  watchTime?: number;
  likes?: number;
  shares?: number;
  recordedAt?: number;
  manualNote?: string;
}

export interface SetAnalytics {
  views?: number;
  watchTime?: number;
  followerDelta?: number;
  manualYoutubeUrl?: string;
  recordedAt?: number;
}

export interface PublishedUrl {
  platform: ShortPlatform | 'youtube_long' | 'comedian_page';
  url: string;
  publishedAt: number;
}

export interface Set {
  id: string;
  comedianId: string;
  title: string;
  logline: string;
  status: SetStatus;
  bits: Bit[];
  clipIds: string[];
  promoIds: string[];
  publishedUrls: PublishedUrl[];
  analytics: SetAnalytics;
  generatedBy: 'debut' | 'manual' | 'autopilot';
  createdAt: number;
  updatedAt: number;
  premium?: Production;   // a Standupify Original: the full production (services/premium)
}

export type Platform = 'x' | 'youtube' | 'instagram' | 'tiktok' | 'newsletter' | 'podcast';

// Outreach target the Scout Agent drafts (clubs, bookers, fan communities,
// reaction creators). v1 drafts only — the user sends them.
export interface ScoutTarget {
  id: string;
  comedianId: string;
  name: string;
  platform: Platform;
  handleOrEmail: string;
  niche: string;
  relevanceScore: number;
  outreachStatus: 'new' | 'drafted' | 'sent_by_user' | 'responded' | 'rejected';
  suggestedAngle: string;
  draftMessage?: string;
  createdAt: number;
  updatedAt: number;
}

export type AgentName =
  | 'writer'        // writes the next set
  | 'clipper'       // cuts clips from the set
  | 'promoter'      // drafts promo posts / posters
  | 'scout'         // drafts outreach to bookers / communities
  | 'analytics'     // snapshots state, appends audience signals
  | 'booker';       // orders the release queue

export type JobStatus = 'queued' | 'running' | 'done' | 'failed';

export interface AutopilotJob {
  id: string;
  comedianId: string;
  agent: AgentName;
  status: JobStatus;
  payload?: unknown;
  result?: unknown;
  scheduledFor: number;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
  createdAt: number;
}

// Publisher abstraction --------------------------------------------------

export type PublishTarget =
  | { kind: 'openmic_network_outbox' }
  | { kind: 'local_download' }
  | { kind: 'manual_link'; url: string };

export interface PublishableAsset {
  kind: 'set' | 'clip' | 'promo';
  comedianId: string;
  setId?: string;
  refId: string;          // id of the Set / Clip / Promo
  title: string;
  caption?: string;
  bodyHtml?: string;      // optional pre-rendered HTML (for comedian pages)
  videoUrl?: string;
  imageUrl?: string;
}

export interface PublishedResult {
  target: PublishTarget;
  url?: string;
  outboxId?: string;
  publishedAt: number;
}

export interface OutboxItem {
  id: string;
  comedianId: string;
  asset: PublishableAsset;
  submittedAt: number;
  reviewed: boolean;
  reviewerNote?: string;
}

export interface PostMetrics {
  views?: number;
  watchTime?: number;
  likes?: number;
  shares?: number;
}

// Scheduler abstraction --------------------------------------------------

export interface SchedulerTickContext {
  now: number;
}
