// =====================================================================
// The Forge — how new comedians are born (after ReMC2's Kindred/Ascent).
//
//   Eras     the Circuit watches which style and which skill are winning;
//            every comic created afterwards is "a child of" that age.
//   Lenses   a newcomer is forged through a lens on a muse (a top comic):
//            mirror · counter · orthogonal · complement · antagonist
//            (disciples are the apprentices of the lineage system).
//   Aims     every comic holds one aim; won aims make room for bigger ones,
//            and aims steer what they write and whom they get booked against.
//
// Pure: no fetch, no storage. Deterministic given a seeded rng.
// =====================================================================

import type { Aim, CareerStage, CircuitState, CircuitStats, Era, EraState, Lens, Show, SkillVector } from './types';

export const STYLES = ['observational', 'absurdist', 'crowd-work', 'storytelling', 'one-liners', 'dark', 'deadpan'] as const;
export const SKILLS: (keyof SkillVector)[] = ['writing', 'delivery', 'crowdwork', 'originality', 'presence'];

const STYLE_NAME: Record<string, string> = {
  observational: 'Observation', absurdist: 'the Absurd', 'crowd-work': 'the Front Row', storytelling: 'the Long Story',
  'one-liners': 'the One-Liner', dark: 'the Dark', deadpan: 'Deadpan'
};
const SCHOOL_NAME: Record<keyof SkillVector, string> = {
  writing: 'the Page', delivery: 'Timing', crowdwork: 'the Room', originality: 'the Strange', presence: 'the Spotlight'
};
const ORDINAL = ['', 'Second ', 'Third ', 'Fourth ', 'Fifth ', 'Sixth '];
const an = (w: string) => (/^[aeiou]/i.test(w) && !/^one/i.test(w) ? 'An' : 'A');

export const LENS_LABEL: Record<Lens, (muse: string) => string> = {
  mirror: m => `an Imitator of ${m}`,
  counter: m => `an Answer to ${m}`,
  orthogonal: () => 'an Outsider to the scene',
  complement: m => `a Second to ${m}`,
  antagonist: m => `the Rival of ${m}`,
  disciple: m => `a Disciple of ${m}`,
  founder: () => 'a founder of the Circuit',
  newcomer: () => 'a walk-in at the open mic'
};

export const emptyEra = (): EraState => ({ current: null, pending: null, history: [], counts: {} });

// ---------------------------------------------------------------------
// Eras
// ---------------------------------------------------------------------

/** What is winning lately: the style and the skill of the comics who top the shows. */
export function readTheRoom(st: CircuitState, shows: Show[], styleOf: (id: string) => string | undefined) {
  const style: Record<string, number> = {};
  const skill: Record<string, number> = {};
  for (const show of shows.slice(0, 12)) {
    for (const p of show.performances) {
      if (p.simulated) continue;
      const w = Math.max(0, p.final - 5) * (p.rank === 1 ? 1.6 : 1);
      const sty = styleOf(p.comedianId);
      if (sty) style[sty] = (style[sty] || 0) + w;
      const s = st.stats[p.comedianId];
      if (s) {
        const top = SKILLS.reduce((a, k) => (s.skills[k] > s.skills[a] ? k : a), SKILLS[0]);
        skill[top] = (skill[top] || 0) + w;
      }
    }
  }
  const lead = (m: Record<string, number>) => Object.entries(m).sort((a, b) => b[1] - a[1])[0];
  const ls = lead(style), lk = lead(skill);
  const total = Object.values(style).reduce((a, b) => a + b, 0) || 1;
  return ls && lk ? { doctrine: ls[0], school: lk[0] as keyof SkillVector, share: ls[1] / total } : null;
}

/** An era turns when a different style leads at two checks in a row (after 3 nights at least). */
export function advanceEra(era: EraState, read: ReturnType<typeof readTheRoom>, night: number): Era | null {
  if (!read) return null;
  const cur = era.current;
  const same = cur && cur.doctrine === read.doctrine && cur.school === read.school;
  if (same) { cur!.strength = Math.min(1, cur!.strength + 0.08); era.pending = null; return null; }
  if (cur && night - cur.sinceNight < 3) return null;
  if (era.pending && era.pending.doctrine === read.doctrine && era.pending.school === read.school) {
    era.pending.seen += 1;
  } else {
    era.pending = { doctrine: read.doctrine, school: read.school, seen: 1 };
  }
  if (cur && era.pending.seen < 2) return null;
  const base = `Age of ${STYLE_NAME[read.doctrine] || read.doctrine}`;
  const n = era.counts[base] || 0;
  era.counts[base] = n + 1;
  const next: Era = { name: `the ${ORDINAL[Math.min(n, 5)]}${base} (School of ${SCHOOL_NAME[read.school]})`, doctrine: read.doctrine, school: read.school, sinceNight: night, strength: 0.35 + read.share * 0.4 };
  if (cur) era.history = [cur, ...era.history].slice(0, 12);
  era.current = next;
  era.pending = null;
  return next;
}

// ---------------------------------------------------------------------
// Lenses
// ---------------------------------------------------------------------

function entropy(counts: number[]) {
  const t = counts.reduce((a, b) => a + b, 0) || 1;
  return -counts.reduce((a, c) => (c ? a + (c / t) * Math.log(c / t) : a), 0) / Math.log(STYLES.length);
}

export interface ForgePlan {
  lens: Lens;
  muse: string | null;
  style: string;
  skills: SkillVector;
  brief: string;               // what the casting prompt is told
  rivalHeat: number;           // antagonists start with a grudge
}

/**
 * Pick a lens and a muse for the next newborn, weighted by the situation:
 * counters grow with a runaway leader, antagonists with heated rivalries,
 * outsiders when everyone does the same act, mirrors when a style is hot.
 */
export function forge(
  st: CircuitState, era: Era | null, r: () => number,
  comic: (id: string) => { name: string; style: string; voice: string; tagline: string } | undefined,
  weaknesses: (id: string) => string[]
): ForgePlan {
  const living = Object.values(st.stats).filter(s => s.life === 'active' && comic(s.comedianId));
  const top = [...living].sort((a, b) => b.elo - a.elo).slice(0, 6);
  const leader = top[0];
  const gap = leader && top[1] ? leader.elo - top[1].elo : 0;
  const styleCounts = STYLES.map(s => living.filter(x => comic(x.comedianId)?.style === s).length);
  const homogeneous = 1 - entropy(styleCounts);
  const hot = st.rivalries.reduce((a, v) => Math.max(a, v.heat), 0);

  const w: [Lens, number][] = [
    ['mirror', 1 + (era?.strength || 0)],
    ['counter', 0.6 + Math.max(0, gap) / 60],
    ['orthogonal', 0.4 + homogeneous * 3],
    ['complement', 0.6],
    ['antagonist', 0.4 + hot / 6]
  ];
  if (!leader) w.splice(0, w.length, ['orthogonal', 1]);
  const total = w.reduce((a, [, x]) => a + x, 0);
  let roll = r() * total;
  let lens: Lens = 'orthogonal';
  for (const [l, x] of w) { if ((roll -= x) <= 0) { lens = l; break; } }

  // The muse: the leader for counters, a top comic otherwise (weighted toward the top).
  const muse = lens === 'orthogonal' ? null : lens === 'counter' ? leader : top[Math.min(top.length - 1, Math.floor(r() * r() * top.length))];
  const m = muse ? comic(muse.comedianId) : undefined;
  const base: SkillVector = muse ? { ...muse.skills } : { writing: 6, delivery: 6, crowdwork: 6, originality: 7, presence: 6 };
  const clamp = (v: number) => Math.max(3, Math.min(10, Math.round(v)));
  let style = m?.style || STYLES[Math.floor(r() * STYLES.length)];
  let brief = '';
  let skills: SkillVector = { ...base };

  const least = STYLES[styleCounts.indexOf(Math.min(...styleCounts))];
  const weak = muse ? weaknesses(muse.comedianId) : [];
  switch (lens) {
    case 'mirror':
      skills = { writing: clamp(base.writing - 1), delivery: clamp(base.delivery - 1), crowdwork: clamp(base.crowdwork - 1), originality: clamp(base.originality - 2), presence: clamp(base.presence) };
      brief = `They grew up watching ${m!.name} ("${m!.tagline}") and copy the act — the ${m!.style} style, the ${m!.voice} delivery — but they are their own person with a different life.`;
      break;
    case 'counter': {
      // Built to beat the muse: a style the crowd loves that the muse doesn't do, strong where the judges dinged the muse.
      style = STYLES.filter(s => s !== m!.style)[Math.floor(r() * (STYLES.length - 1))];
      const lowest = SKILLS.reduce((a, k) => (base[k] < base[a] ? k : a), SKILLS[0]);
      skills = { writing: clamp(base.writing - 1), delivery: clamp(base.delivery - 1), crowdwork: clamp(base.crowdwork - 1), originality: clamp(base.originality - 1), presence: clamp(base.presence - 1), [lowest]: clamp(base[lowest] + 2) } as SkillVector;
      brief = `They exist to beat ${m!.name}, the comic at the top of the Circuit. Where ${m!.name} is weak (${weak.slice(0, 2).join('; ') || `their ${lowest}`}), this comic is strong. ${an(style)} ${style} comic whose act is the answer to ${m!.name}'s.`;
      break;
    }
    case 'orthogonal':
      style = least;
      skills = { writing: clamp(6 + r() * 3), delivery: clamp(5 + r() * 3), crowdwork: clamp(5 + r() * 3), originality: clamp(8 + r() * 2), presence: clamp(5 + r() * 3) };
      brief = `Nobody on the Circuit does what they do: ${an(style).toLowerCase()} ${style} comic from a world the scene has never seen, doing comedy nobody else is doing.`;
      break;
    case 'complement':
      skills = { writing: clamp(10 - base.writing + 4), delivery: clamp(10 - base.delivery + 4), crowdwork: clamp(10 - base.crowdwork + 4), originality: clamp(base.originality), presence: clamp(10 - base.presence + 4) };
      brief = `They are the perfect opener for ${m!.name}: strong exactly where ${m!.name} is not, loyal, and a fan of ${m!.name}'s work.`;
      break;
    case 'antagonist':
      style = STYLES.filter(s => s !== m!.style)[Math.floor(r() * (STYLES.length - 1))];
      skills = { writing: clamp(base.writing - 1), delivery: clamp(base.delivery), crowdwork: clamp(base.crowdwork + 1), originality: clamp(base.originality - 1), presence: clamp(base.presence - 1) };
      brief = `They are ${m!.name}'s opposite in every way — temperament, background, style (${style}) — and they have hated ${m!.name}'s comedy since the first time they saw it.`;
      break;
  }
  // The era leaves its mark on every newborn: its school is their strongest skill.
  if (era) skills[era.school] = clamp(Math.max(skills[era.school], 7 + era.strength * 2));
  return {
    lens, muse: muse?.comedianId || null, style, skills, rivalHeat: lens === 'antagonist' ? 5 : lens === 'counter' ? 3 : 0,
    brief: `${brief}${era ? ` They are a child of ${era.name}: ${STYLE_NAME[era.doctrine] || era.doctrine} is winning, and they were drilled in ${SCHOOL_NAME[era.school]}.` : ''}`
  };
}

// ---------------------------------------------------------------------
// Aims (the Ascent)
// ---------------------------------------------------------------------

const RANKS: CareerStage[] = ['open_mic', 'regular', 'feature', 'headliner', 'legend'];

export function chooseAim(s: CircuitStats, st: CircuitState, r: () => number, name: (id: string) => string, night: number): Aim {
  const board = Object.values(st.stats).filter(x => x.life === 'active').sort((a, b) => b.elo - a.elo);
  const place = board.findIndex(x => x.comedianId === s.comedianId);
  const above = place > 0 ? board[place - 1] : null;
  const nemesis = st.rivalries.filter(v => (v.a === s.comedianId || v.b === s.comedianId) && v.heat >= 3)
    .sort((a, b) => b.heat - a.heat)[0];
  const options: [Aim, number][] = [];
  const rankIdx = RANKS.indexOf(s.stage);
  if (rankIdx < 4) options.push([{ kind: 'rank', stage: RANKS[rankIdx + 1], since: night, text: `make ${RANKS[rankIdx + 1].replace('_', ' ')}` }, 3]);
  if (place > 2) options.push([{ kind: 'summit', since: night, text: 'crack the top three' }, 1.5]);
  if (above) options.push([{ kind: 'dethrone', target: above.comedianId, since: night, text: `get above ${name(above.comedianId)}` }, 2 + (place < 4 ? 1 : 0)]);
  if (s.stage === 'headliner' || s.stage === 'legend') options.push([{ kind: 'title', since: night, text: 'win the championship' }, 2.5]);
  if (nemesis) {
    const other = nemesis.a === s.comedianId ? nemesis.b : nemesis.a;
    options.push([{ kind: 'avenge', target: other, since: night, text: `finally beat ${name(other)}` }, 2 + nemesis.heat / 3]);
  }
  const club = st.clubs.find(c => c.champion && c.champion !== s.comedianId);
  if (club) options.push([{ kind: 'club', club: club.id, since: night, text: `take ${club.name} from ${name(club.champion!)}` }, 1]);
  if (rankIdx >= 2 && !(s.specials || []).length) options.push([{ kind: 'special', since: night, text: 'earn a special' }, 1.5]);
  const total = options.reduce((a, [, x]) => a + x, 0);
  let roll = r() * total;
  for (const [a, x] of options) if ((roll -= x) <= 0) return a;
  return options[0]?.[0] || { kind: 'summit', since: night, text: 'stay on top' };
}

/** Did tonight settle the aim? 'won', 'lost' (the target is gone) or null. */
export function judgeAim(aim: Aim, s: CircuitStats, st: CircuitState): 'won' | 'lost' | null {
  const board = Object.values(st.stats).filter(x => x.life === 'active').sort((a, b) => b.elo - a.elo);
  const place = board.findIndex(x => x.comedianId === s.comedianId);
  const target = aim.target ? st.stats[aim.target] : null;
  if (aim.target && (!target || target.life !== 'active')) return 'lost';
  switch (aim.kind) {
    case 'rank': return RANKS.indexOf(s.stage) >= RANKS.indexOf(aim.stage || 'legend') ? 'won' : null;
    case 'summit': return place >= 0 && place < 3 ? 'won' : null;
    case 'dethrone': return target && s.elo > target.elo ? 'won' : null;
    case 'title': return s.titles > 0 && st.champion === s.comedianId ? 'won' : null;
    case 'club': return st.clubs.find(c => c.id === aim.club)?.champion === s.comedianId ? 'won' : null;
    case 'avenge': {
      const v = st.rivalries.find(x => (x.a === s.comedianId && x.b === aim.target) || (x.b === s.comedianId && x.a === aim.target));
      return v && v.lastNight === st.night && ((v.a === s.comedianId ? v.aWins : v.bWins) > 0) ? 'won' : null;
    }
    case 'special': return (s.specials || []).length ? 'won' : null;
  }
  return null;
}
