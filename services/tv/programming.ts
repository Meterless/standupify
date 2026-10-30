// =====================================================================
// Standupify TV programming — turn everything the engine has made into a
// lean-back stream of the best comedy, best first, freshest on top.
// =====================================================================

import type { Comedian, Set as ComedySet } from '../../types';
import type { CircuitState, Show, ShowFormat, JudgeCard, Beat } from '../league/types';
import { FORMAT_LABEL, STAGE_LABEL } from '../league/types.ts';

export type Channel = 'best' | 'animated' | 'fresh' | 'roasts' | 'rising' | 'legends' | 'specials';

export const CHANNELS: { id: Channel; name: string; blurb: string }[] = [
  { id: 'best', name: 'Best of the Circuit', blurb: 'The highest-scoring sets, ever' },
  { id: 'animated', name: 'Animated', blurb: 'Only the sets the Reel shot as video — the best of the best' },
  { id: 'fresh', name: 'Just In', blurb: 'The newest sets, straight off the stage' },
  { id: 'roasts', name: 'Roast Battles', blurb: 'Head to head, no mercy' },
  { id: 'rising', name: 'Rising Stars', blurb: 'Open micers and regulars on the way up' },
  { id: 'legends', name: 'Headliners', blurb: 'The ones who sell out the Velvet Room' },
  { id: 'specials', name: 'Specials', blurb: 'Full specials, bit by bit' }
];

export interface Segment {
  key: string;
  comedianId: string;
  name: string;
  tagline: string;
  look?: string;
  stage?: string;               // career stage label
  record?: string;              // "6W · 14 shows"
  title: string;
  text: string;
  delivery?: Beat[];            // the set with its stage directions (the Room)
  image?: string;               // still for this set
  headshot?: string;
  video?: string;
  clips: string[];              // every angle the Reel shot, in order
  audio?: string;
  club?: string;
  venue?: string;
  format?: string;
  target?: string;              // roast target name
  night?: number;
  score?: number;
  crowd?: number;
  laughs?: number;
  moments: string[];
  cards: JudgeCard[];
  winner?: boolean;
  special?: string;             // special title when from a special
  at: number;
}

function angles(clips: { url: string }[] | undefined, first?: string): string[] {
  const urls = (clips || []).map(c => c.url);
  return first && !urls.includes(first) ? [first, ...urls] : urls;
}

const JUDGE_NAMES: Record<string, string> = { booker: 'Marty, the Booker', critic: 'Dana, the Critic', heckler: 'Big Lou, the Heckler' };
export const judgeName = (k: string) => JUDGE_NAMES[k] || k;

function fromShows(st: CircuitState | null, shows: Show[], comics: (id: string) => Comedian | undefined): Segment[] {
  if (!st) return [];
  const out: Segment[] = [];
  for (const show of shows) {
    if (!show.endedAt) continue;
    const club = st.clubs.find(c => c.id === show.clubId);
    for (const p of show.performances) {
      if (p.simulated || !p.text) continue;
      const c = comics(p.comedianId);
      const s = st.stats[p.comedianId];
      out.push({
        key: `${show.id}:${p.comedianId}`,
        comedianId: p.comedianId,
        name: c?.name || 'A comedian',
        tagline: c?.tagline || '',
        look: c?.look,
        stage: s ? STAGE_LABEL[s.stage] : undefined,
        record: s ? `${s.wins}W · ${s.shows} shows` : undefined,
        title: p.title,
        text: p.text,
        delivery: p.stage?.delivery,
        image: p.imageUrl,
        headshot: c?.headshotUrl || c?.avatarImage,
        video: p.videoUrl,
        clips: angles(p.clips, p.videoUrl),
        club: club?.name,
        venue: club?.venue,
        format: FORMAT_LABEL[show.format as ShowFormat],
        target: p.target ? comics(p.target)?.name : undefined,
        night: show.night,
        score: p.final,
        crowd: p.crowd,
        laughs: p.laughs,
        moments: p.moments,
        cards: p.cards,
        winner: show.winnerId === p.comedianId,
        at: show.endedAt || show.startedAt
      });
    }
  }
  return out;
}

function fromSpecials(sets: { comedian: Comedian; set: ComedySet }[]): Segment[] {
  const out: Segment[] = [];
  for (const { comedian: c, set } of sets) {
    for (const b of set.bits) {
      if (!b.description) continue;
      out.push({
        key: `${set.id}:${b.id}`,
        comedianId: c.id, name: c.name, tagline: c.tagline, look: c.look,
        title: b.title, text: b.description, image: b.imageUrl, headshot: c.headshotUrl || c.avatarImage,
        video: b.videoUrl, clips: angles(b.clips, b.videoUrl), audio: b.audioUrl, venue: c.venue, score: b.laughScore, moments: [], cards: b.laughNote ? [{ judge: 'booker', score: b.laughScore || 0, line: b.laughNote }] : [],
        special: set.title, at: set.updatedAt
      });
    }
  }
  return out;
}

/** The full catalog, de-duplicated. */
export function buildCatalog(st: CircuitState | null, shows: Show[], specials: { comedian: Comedian; set: ComedySet }[], comics: (id: string) => Comedian | undefined): Segment[] {
  const seen = new Set<string>();
  return [...fromShows(st, shows, comics), ...fromSpecials(specials)].filter(s => {
    const k = `${s.comedianId}|${s.text.slice(0, 80)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const RISING = new Set([STAGE_LABEL.open_mic, STAGE_LABEL.regular]);
const TOP = new Set([STAGE_LABEL.headliner, STAGE_LABEL.legend]);

/** A channel's running order. "Best" blends quality with freshness so new gems surface. */
export function program(catalog: Segment[], channel: Channel): Segment[] {
  const now = Date.now();
  const fresh = (s: Segment) => Math.max(0, 1 - (now - s.at) / (3 * 86_400_000));
  // Animated sets are the flagship: they float up every channel.
  const q = (s: Segment) => (s.score ?? 6) + (s.winner ? 0.4 : 0) + fresh(s) * 0.8 + Math.min(1.5, s.clips.length * 0.6);
  switch (channel) {
    case 'animated': return catalog.filter(s => s.clips.length).sort((a, b) => q(b) - q(a));
    case 'fresh': return [...catalog].filter(s => !s.special).sort((a, b) => b.at - a.at);
    case 'roasts': return catalog.filter(s => s.format === FORMAT_LABEL.roast_battle).sort((a, b) => q(b) - q(a));
    case 'rising': return catalog.filter(s => s.stage && RISING.has(s.stage)).sort((a, b) => q(b) - q(a));
    case 'legends': return catalog.filter(s => s.stage && TOP.has(s.stage)).sort((a, b) => q(b) - q(a));
    case 'specials': return catalog.filter(s => s.special).sort((a, b) => b.at - a.at);
    default: {
      // Best first, but never the same comedian twice in a row.
      const sorted = [...catalog].sort((a, b) => q(b) - q(a));
      const out: Segment[] = [];
      while (sorted.length) {
        const i = sorted.findIndex(s => s.comedianId !== out[out.length - 1]?.comedianId);
        out.push(...sorted.splice(i === -1 ? 0 : i, 1));
      }
      return out;
    }
  }
}

/** Refresh a running channel without changing the performance being watched.
 * Existing entries receive new renders, new entries obey the channel's filter,
 * and at most two fresh performances move directly behind the current one.
 */
export function reconcileProgram(
  queue: Segment[], index: number, catalog: Segment[], channel: Channel, knownKeys: ReadonlySet<string>
): { queue: Segment[]; index: number } {
  const eligible = program(catalog, channel);
  if (!queue.length) return { queue: eligible, index: 0 };
  const current = queue[((index % queue.length) + queue.length) % queue.length];
  const latest = new Map(eligible.map(s => [s.key, s]));
  const kept = queue.filter(s => latest.has(s.key)).map(s => latest.get(s.key)!);
  const currentIndex = kept.findIndex(s => s.key === current.key);
  // A deleted performance or one which no longer belongs on this channel
  // should not survive indefinitely just because the player was already open.
  if (currentIndex < 0) return { queue: eligible, index: 0 };

  const queuedKeys = new Set(kept.map(s => s.key));
  const additions = eligible.filter(s => !queuedKeys.has(s.key));
  // Keep a special's running order intact. Other channels surface new material.
  const priority = channel === 'specials' ? [] : additions.filter(s => !knownKeys.has(s.key)).slice(0, 2);
  const priorityKeys = new Set(priority.map(s => s.key));
  return {
    queue: [
      ...kept.slice(0, currentIndex + 1), ...priority, ...kept.slice(currentIndex + 1),
      ...additions.filter(s => !priorityKeys.has(s.key))
    ],
    index: currentIndex
  };
}
