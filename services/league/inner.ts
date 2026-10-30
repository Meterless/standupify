// =====================================================================
// Inner life — what it is like to be a comic on the Circuit.
//
// Modelled on Samuel's consciousness layer and kept just as honest about
// what it is: deterministic signal math, no model calls, nothing claimed
// beyond the numbers.
//
//   drives      confidence · hunger · nerves · spite · warmth (0..1), recomputed
//               from what actually happened (floor + saturating terms) with
//               inertia, so a mood carries over from night to night
//   felt        a label the drives add up to ("riding high", "rattled"…)
//   attention   a salience-ranked working set of what is on their mind
//               (recency half-life, intensity, relevance, novelty; 7 slots)
//   stream      an inner monologue built from templates: notice · expect ·
//               doubt · reflect · worry · decide · plan · recall
//   predict     before a set they expect a score; after it, surprise and a
//               calibration record (hit rate, bias) feed back into nerves
//   initiative  they act unprompted: each night every comic scores what to
//               do next (goal, impact, urgency, confidence, taste − risk −
//               repetition, floor 0.28) and the engine carries out the winner:
//               workshop a new bit, call out a rival, pitch a special, rest
//
// The set brief carries "where your head is at", so the mind changes what
// they write, and what they write changes the mind.
// =====================================================================

import type { CircuitState, CircuitStats, Performance, Show } from './types';

export interface Drives { confidence: number; hunger: number; nerves: number; spite: number; warmth: number }

export type ThoughtType = 'notice' | 'expect' | 'doubt' | 'reflect' | 'worry' | 'decide' | 'plan' | 'recall';
export interface Thought { night: number; type: ThoughtType; text: string }

export interface Percept { id: string; night: number; kind: string; text: string; intensity: number; relevance: number; novelty: number; salience: number; actors: string[]; seed?: string }

export type IntentKind = 'workshop' | 'callout' | 'pitch' | 'rest';
export interface Intent { night: number; kind: IntentKind; score: number; text: string; target?: string }

export interface InnerState {
  drives: Drives;
  felt: { label: string; valence: number; arousal: number; drivers: string[] };
  attention: Percept[];
  stream: Thought[];
  expect: { night: number; showId: string; score: number } | null;
  calibration: { n: number; hits: number; brier: number; bias: 'steady' | 'overconfident' | 'underconfident' };
  results: { night: number; final: number; rank: number; of: number }[];   // newest first
  intents: Intent[];                                                          // newest first
  callout?: { target: string; night: number } | null;
  pitched?: number | null;                                                    // the night they asked for an Original
  resting?: number | null;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const sat = (x: number) => 1 - Math.exp(-Math.max(0, x));
const r2 = (n: number) => Math.round(n * 100) / 100;
const pick = <T,>(xs: T[], h: number) => xs[Math.abs(h) % xs.length];
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

const BASE: Drives = { confidence: 0.5, hunger: 0.45, nerves: 0.3, spite: 0.15, warmth: 0.55 };

export function freshInner(): InnerState {
  return {
    drives: { ...BASE }, felt: { label: 'finding their feet', valence: 0.55, arousal: 0.4, drivers: [] },
    attention: [], stream: [], expect: null, calibration: { n: 0, hits: 0, brier: 0, bias: 'steady' }, results: [], intents: []
  };
}

export function innerOf(s: CircuitStats): InnerState {
  return (s.inner ||= freshInner());
}

// ---------------------------------------------------------------------
// drives → felt
// ---------------------------------------------------------------------

function feltFrom(d: Drives): InnerState['felt'] {
  const arousal = Math.max(d.nerves, d.hunger, d.spite);
  const label =
    d.confidence > 0.72 && d.warmth > 0.6 ? 'riding high'
    : d.spite > 0.62 ? 'out for blood'
    : d.nerves > 0.62 && d.confidence < 0.45 ? 'rattled'
    : d.nerves > 0.6 ? 'wired'
    : d.hunger > 0.66 ? 'hungry'
    : d.warmth < 0.32 ? 'stewing'
    : d.confidence < 0.34 ? 'shaken'
    : d.confidence > 0.6 ? 'locked in'
    : d.warmth > 0.62 ? 'loose'
    : 'grinding';
  return { label, valence: r2(d.warmth), arousal: r2(arousal), drivers: [] };
}

/** Recompute the drives from what happened, with inertia (Samuel: 0.6 new, 0.4 old). */
function refreshDrives(st: CircuitState, s: CircuitStats, inner: InnerState, nameOf: (id: string) => string): void {
  const last5 = inner.results.slice(0, 5);
  const wins = last5.filter(r => r.rank === 1).length;
  const bombs = last5.filter(r => r.final < 4).length;
  const lastR = inner.results[0];
  const rivals = st.rivalries.filter(v => v.a === s.comedianId || v.b === s.comedianId).sort((a, b) => b.heat - a.heat);
  const heat = rivals[0]?.heat || 0;
  const thefts = st.events.slice(0, 30).filter(e => e.kind === 'theft' && e.actors.includes(s.comedianId)).length;
  const board = Object.values(st.stats).filter(x => x.life === 'active').sort((a, b) => b.elo - a.elo);
  const ahead = board[board.findIndex(x => x.comedianId === s.comedianId) - 1];
  const gap = ahead ? (ahead.elo - s.elo) / 60 : 0;
  const cal = inner.calibration;
  const hitRate = cal.n ? cal.hits / cal.n : 0.5;
  const drivers: string[] = [];
  const computed: Drives = {
    confidence: clamp01(0.25 + 0.35 * sat(wins / 2) + 0.2 * sat(Math.max(0, s.streak) / 3) + 0.2 * (hitRate - 0.5) - 0.3 * sat(bombs / 1.5) + (s.stage === 'legend' ? 0.1 : 0)),
    nerves: clamp01(0.15 + 0.3 * sat(Math.max(0, -s.streak) / 2) + 0.25 * sat(bombs / 1.5) + (cal.bias === 'overconfident' ? 0.15 : 0) + (lastR && lastR.final < 4 ? 0.15 : 0)),
    hunger: clamp01(0.3 + (s.aim ? 0.2 : 0) + 0.2 * sat(gap) + 0.2 * sat((last5.length - wins) / 3) - (s.stage === 'legend' ? 0.1 : 0)),
    spite: clamp01(0.1 + 0.6 * sat(heat / 6) + 0.3 * sat(thefts)),
    warmth: clamp01(0.5 + (lastR?.rank === 1 ? 0.25 : 0) - (lastR && lastR.final < 4 ? 0.3 : 0) + 0.15 * sat(wins / 3) - 0.15 * sat(thefts))
  };
  if (wins) drivers.push(`${wins} win${wins > 1 ? 's' : ''} in the last ${last5.length}`);
  if (bombs) drivers.push(`${bombs} bomb${bombs > 1 ? 's' : ''} lately`);
  if (heat >= 3) drivers.push(`the feud with ${nameOf(rivals[0].a === s.comedianId ? rivals[0].b : rivals[0].a)}`);
  if (s.aim) drivers.push(`wants to ${s.aim.text}`);
  if (cal.bias !== 'steady' && cal.n >= 3) drivers.push(cal.bias === 'overconfident' ? 'keeps expecting more than they get' : 'keeps beating their own expectations');
  const prev = inner.drives;
  inner.drives = {
    confidence: r2(0.6 * computed.confidence + 0.4 * prev.confidence),
    hunger: r2(0.6 * computed.hunger + 0.4 * prev.hunger),
    nerves: r2(0.6 * computed.nerves + 0.4 * prev.nerves),
    spite: r2(0.6 * computed.spite + 0.4 * prev.spite),
    warmth: r2(0.6 * computed.warmth + 0.4 * prev.warmth)
  };
  inner.felt = { ...feltFrom(inner.drives), drivers: drivers.slice(0, 4) };
}

// ---------------------------------------------------------------------
// attention
// ---------------------------------------------------------------------

function attend(inner: InnerState, night: number, p: Omit<Percept, 'salience' | 'novelty'> & { novelty?: number }) {
  const seen = inner.attention.some(x => x.kind === p.kind && x.text === p.text);
  const novelty = p.novelty ?? (seen ? 0.1 : inner.attention.some(x => x.kind === p.kind) ? 0.5 : 1);
  inner.attention = [{ ...p, novelty, salience: 0 }, ...inner.attention.filter(x => !(x.kind === p.kind && x.text === p.text))];
  rescore(inner, night);
}

/** Recency half-life of 4 nights; the working set keeps the 7 most salient. */
function rescore(inner: InnerState, night: number) {
  for (const p of inner.attention) {
    const recency = Math.pow(0.5, Math.max(0, night - p.night) / 4);
    p.salience = r2(0.35 * p.intensity + 0.25 * p.relevance + 0.2 * p.novelty + 0.2 * recency);
  }
  inner.attention = inner.attention.sort((a, b) => b.salience - a.salience).filter((p, i) => i < 7 && p.salience > 0.18);
}

function think(inner: InnerState, night: number, type: ThoughtType, text: string) {
  if (!text || inner.stream[0]?.text === text) return;
  inner.stream = [{ night, type, text: text.slice(0, 240) }, ...inner.stream].slice(0, 24);
}

// ---------------------------------------------------------------------
// before the set: an expectation, and where their head is at
// ---------------------------------------------------------------------

export function expectBefore(s: CircuitStats, show: Show, club: { name: string; loves: string[] }, style: string): number {
  const inner = innerOf(s);
  const recent = inner.results.slice(0, 5);
  const mean = recent.length ? recent.reduce((a, r) => a + r.final, 0) / recent.length : 6;
  const fit = club.loves.some(l => style.toLowerCase().includes(l.toLowerCase())) ? 0.4 : 0;
  const score = Math.max(2, Math.min(9.8, mean + (inner.drives.confidence - 0.5) * 2.2 - (inner.drives.nerves - 0.3) * 1.2 + fit));
  inner.expect = { night: show.night, showId: show.id, score: Math.round(score * 10) / 10 };
  const h = hash(`${s.comedianId}:${show.id}`);
  think(inner, show.night, 'expect', pick([
    `Feels like a ${inner.expect.score.toFixed(1)} night at ${club.name}.`,
    `${club.name} again. If I hit the turn on time, ${inner.expect.score.toFixed(1)}, easy.`,
    `Expecting about a ${inner.expect.score.toFixed(1)}. ${fit ? 'This room likes what I do.' : 'This room is not my room.'}`
  ], h));
  return inner.expect.score;
}

/** The set brief's "where your head is at" — the mind steers the writing. */
export function innerBrief(s: CircuitStats, nameOf: (id: string) => string): string {
  const inner = s.inner;
  if (!inner) return '';
  const d = inner.drives;
  const onMind = inner.attention.slice(0, 3).map(p => p.text).join(' · ');
  const steer =
    d.spite > 0.62 && inner.callout ? `You want tonight to embarrass ${nameOf(inner.callout.target)} — at least one line is for them.`
    : d.confidence > 0.7 ? 'You are confident: swing big tonight, take the risky premise and commit to it.'
    : d.nerves > 0.6 ? 'You are nervous: lean on your strongest, most tested material and keep it tight.'
    : d.hunger > 0.66 ? 'You are hungry: write the set people will be quoting tomorrow.'
    : d.warmth < 0.32 ? 'You are in a dark mood: let some of it into the set, honestly.'
    : '';
  const lesson = inner.stream.find(t => t.type === 'decide' || t.type === 'plan');
  return [
    `WHERE YOUR HEAD IS AT: ${inner.felt.label}${inner.felt.drivers.length ? ` (${inner.felt.drivers.join('; ')})` : ''}.`,
    onMind ? `On your mind: ${onMind}.` : '',
    steer,
    lesson ? `You told yourself: "${lesson.text}"` : ''
  ].filter(Boolean).join(' ');
}

// ---------------------------------------------------------------------
// after the show: percepts, surprise, drives, monologue, initiative
// ---------------------------------------------------------------------

export type InnerAction = { score: number } & (
  | { kind: 'workshop'; comedianId: string; material: { name: string; type: 'THEME' | 'BIT'; description: string }; text: string }
  | { kind: 'callout'; comedianId: string; target: string; text: string }
  | { kind: 'pitch'; comedianId: string; text: string }
  | { kind: 'rest'; comedianId: string; text: string });

export function afterShowMind(st: CircuitState, show: Show, ranked: Performance[], nameOf: (id: string) => string, clubName: string): InnerAction[] {
  const night = show.night;
  const actions: InnerAction[] = [];
  const winner = ranked[0];
  for (const p of show.performances) {
    const s = st.stats[p.comedianId];
    if (!s) continue;
    const inner = innerOf(s);
    const h = hash(`${p.comedianId}:${show.id}`);
    inner.results = [{ night, final: p.final, rank: p.rank, of: ranked.length }, ...inner.results].slice(0, 12);
    if (inner.resting && night - inner.resting > 2) inner.resting = null;

    // What they noticed.
    const best = [...p.cards].sort((a, b) => b.score - a.score)[0];
    const worst = [...p.cards].sort((a, b) => a.score - b.score)[0];
    if (p.rank === 1) attend(inner, night, { id: `win:${show.id}`, night, kind: 'win', text: `won with “${p.title}” at ${clubName}`, intensity: 0.8, relevance: 1, actors: [p.comedianId] });
    if (p.final < 4) attend(inner, night, { id: `bomb:${show.id}`, night, kind: 'bomb', text: `bombed with “${p.title}” — ${worst?.line || 'silence'}`, intensity: 1, relevance: 1, actors: [p.comedianId], seed: `the night “${p.title}” died at ${clubName}` });
    // A note only stings when it was a low card; praise is remembered, not workshopped.
    if (worst && worst.score < 6) attend(inner, night, { id: `note:${show.id}`, night, kind: 'note', text: `${worst.judge === 'heckler' ? 'Big Lou' : worst.judge === 'critic' ? 'Dana' : 'Marty'} said: “${worst.line}”`, intensity: 0.6, relevance: 0.9, actors: [p.comedianId] });
    // Incidents are bits waiting to happen; a plain "applause break" is just a good night.
    const incident = p.moments.find(m => !/^(applause break|big laugh|standing ovation)$/i.test(m));
    if (p.moments.length) attend(inner, night, { id: `room:${show.id}`, night, kind: 'room', text: incident || p.moments[0], intensity: 0.55, relevance: 0.8, actors: [p.comedianId], seed: incident });
    if (winner && winner.comedianId !== p.comedianId) {
      const v = st.rivalries.find(x => (x.a === p.comedianId && x.b === winner.comedianId) || (x.b === p.comedianId && x.a === winner.comedianId));
      if (v && v.heat >= 2) attend(inner, night, { id: `rival:${show.id}`, night, kind: 'rival', text: `${nameOf(winner.comedianId)} beat them again (${v.a === p.comedianId ? v.aWins : v.bWins}–${v.a === p.comedianId ? v.bWins : v.aWins})`, intensity: 0.75, relevance: 0.95, actors: [winner.comedianId] });
    }
    for (const e of st.events.slice(0, 12).filter(e => e.showId === show.id && e.kind === 'theft' && e.actors.includes(p.comedianId))) {
      attend(inner, night, { id: `theft:${e.id}`, night, kind: 'theft', text: e.text, intensity: 0.9, relevance: 1, actors: e.actors });
    }

    // Prediction → surprise → calibration.
    const exp = inner.expect?.showId === show.id ? inner.expect.score : null;
    if (exp != null) {
      const surprise = Math.abs(p.final - exp) / 10;
      const cal = inner.calibration;
      cal.n += 1;
      if (surprise < 0.15) cal.hits += 1;
      cal.brier = r2((cal.brier * (cal.n - 1) + surprise * surprise) / cal.n);
      const signed = p.final - exp;
      cal.bias = cal.n >= 3 && cal.hits / cal.n < 0.45 ? (signed < 0 ? 'overconfident' : 'underconfident') : 'steady';
      if (surprise >= 0.2) think(inner, night, 'reflect', signed < 0
        ? pick([`Thought I had a ${exp.toFixed(1)}. Got a ${p.final.toFixed(1)}. I misread that room.`, `I walked out expecting a ${exp.toFixed(1)}. The room had other plans.`], h)
        : pick([`I'd have taken a ${exp.toFixed(1)}. They gave me a ${p.final.toFixed(1)}. Write down what I did.`, `${p.final.toFixed(1)}? I didn't even think “${p.title}” was finished.`], h));
      inner.expect = null;
    }

    refreshDrives(st, s, inner, nameOf);

    // The monologue: what they noticed, what worries them.
    const top = inner.attention[0];
    if (top?.kind === 'bomb') think(inner, night, 'notice', pick([`That silence after “${p.title}” is going to follow me home.`, `Nobody laughed at the turn. Nobody.`], h));
    else if (top?.kind === 'win') think(inner, night, 'notice', pick([`“${p.title}” worked. Don't touch it.`, `That was the set. That's the one I'll be chasing.`], h));
    else if (top) think(inner, night, 'notice', `Can't stop thinking about it: ${top.text}.`);
    if (inner.drives.spite > 0.6 && top?.kind === 'rival') think(inner, night, 'worry', `${top.text}. People are starting to say it.`);
    if (inner.drives.nerves > 0.62) think(inner, night, 'doubt', pick(['Maybe the act is the problem.', 'What if that was the ceiling?', 'I keep rushing the tag.'], h));

    // Initiative (Samuel's scoring): what do they do about it?
    if (inner.resting) continue;
    const d = inner.drives;
    const lastKind = inner.intents[0]?.kind;
    const rival = st.rivalries.filter(v => (v.a === p.comedianId || v.b === p.comedianId) && v.heat >= 3).sort((a, b) => b.heat - a.heat)[0];
    const rivalId = rival ? (rival.a === p.comedianId ? rival.b : rival.a) : null;
    // Bits come from what happened in the room: an incident they worked, or the bomb itself.
    const seedP = inner.attention.find(x => x.seed && x.night === night && (x.kind === 'room' || x.kind === 'bomb'));
    const workshopped = inner.intents.some(t => t.kind === 'workshop' && night - t.night < 3);
    const cands: { kind: IntentKind; score: number }[] = [];
    const score = (goal: number, impact: number, urgency: number, taste: number, risk: number, kind: IntentKind) =>
      0.25 * goal + 0.25 * impact + 0.15 * urgency + 0.15 * d.confidence + 0.15 * taste - 0.2 * risk - 0.1 * (lastKind === kind ? 1 : 0);
    if (seedP) cands.push({ kind: 'workshop', score: score(d.hunger, seedP.intensity, p.final < 5 ? 1 : 0.4, 0.7, 0.15, 'workshop') - (workshopped ? 0.15 : 0) });
    if (rivalId) cands.push({ kind: 'callout', score: score(d.spite, 0.8, winner?.comedianId === rivalId ? 1 : 0.4, 0.6, d.nerves, 'callout') });
    if ((s.stage === 'headliner' || s.stage === 'legend') && (s.specials || []).length >= 1 && !inner.pitched) cands.push({ kind: 'pitch', score: score(d.hunger, 0.9, s.streak >= 2 ? 1 : 0.3, 0.6, 1 - d.confidence, 'pitch') });
    if (d.nerves > 0.65) cands.push({ kind: 'rest', score: d.nerves * 0.5 });
    const top1 = cands.sort((a, b) => b.score - a.score)[0];
    if (!top1 || top1.score < 0.28) continue;
    const name = nameOf(p.comedianId);
    if (top1.kind === 'workshop' && seedP) {
      const line = (seedP.seed || seedP.text).replace(/["“”]/g, '').slice(0, 140);
      const words = line.replace(/^(worked|the|a|an)\s+/i, '').replace(/[^\w' ]+/g, ' ').split(/\s+/).filter(Boolean).slice(0, 4);
      const title = seedP.kind === 'bomb' ? `The night it died at ${clubName}` : words.map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
      const text = `${name} is workshopping a new bit out of last night: “${line}”.`;
      inner.intents = [{ night, kind: 'workshop' as IntentKind, score: r2(top1.score), text }, ...inner.intents].slice(0, 12);
      think(inner, night, 'decide', `Tomorrow I'm turning “${line.slice(0, 80)}” into a bit.`);
      actions.push({ score: top1.score, kind: 'workshop', comedianId: p.comedianId, material: { name: title.slice(0, 40), type: seedP.kind === 'room' ? 'BIT' : 'THEME', description: `From night ${night} at ${clubName}: ${line}` }, text });
    } else if (top1.kind === 'callout' && rivalId) {
      inner.callout = { target: rivalId, night };
      const text = `${name} calls out ${nameOf(rivalId)}: “Put us on the same bill.”`;
      inner.intents = [{ night, kind: 'callout' as IntentKind, score: r2(top1.score), text, target: rivalId }, ...inner.intents].slice(0, 12);
      think(inner, night, 'plan', `Next time I see ${nameOf(rivalId)} on a bill, I'm doing the bit about them.`);
      actions.push({ score: top1.score, kind: 'callout', comedianId: p.comedianId, target: rivalId, text });
    } else if (top1.kind === 'pitch') {
      inner.pitched = night;
      const text = `${name} pitches the network: an hour, eight cameras, their best material.`;
      inner.intents = [{ night, kind: 'pitch' as IntentKind, score: r2(top1.score), text }, ...inner.intents].slice(0, 12);
      think(inner, night, 'plan', 'I have an hour in me. Time somebody filmed it.');
      actions.push({ score: top1.score, kind: 'pitch', comedianId: p.comedianId, text });
    } else if (top1.kind === 'rest') {
      inner.resting = night;
      const text = `${name} takes a couple of nights off to get their head right.`;
      inner.intents = [{ night, kind: 'rest' as IntentKind, score: r2(top1.score), text }, ...inner.intents].slice(0, 12);
      think(inner, night, 'decide', 'Two nights off. No notebook.');
      actions.push({ score: top1.score, kind: 'rest', comedianId: p.comedianId, text });
    }
  }

  // Everyone else drifts: attention fades, moods settle toward neutral.
  for (const s of Object.values(st.stats)) {
    if (s.life !== 'active' || show.lineup.includes(s.comedianId) || !s.inner) continue;
    rescore(s.inner, night);
    const d = s.inner.drives;
    s.inner.drives = {
      confidence: r2(0.9 * d.confidence + 0.1 * BASE.confidence), hunger: r2(0.9 * d.hunger + 0.1 * BASE.hunger),
      nerves: r2(0.85 * d.nerves + 0.15 * BASE.nerves), spite: r2(0.92 * d.spite + 0.08 * BASE.spite), warmth: r2(0.9 * d.warmth + 0.1 * BASE.warmth)
    };
    s.inner.felt = { ...feltFrom(s.inner.drives), drivers: s.inner.felt.drivers };
    if (s.inner.resting && night - s.inner.resting > 2) { s.inner.resting = null; think(s.inner, night, 'recall', 'Okay. I miss it. Put me back on.'); }
  }
  // The night's two strongest decisions make the news; the rest stay private resolutions.
  return actions.sort((a, b) => b.score - a.score).slice(0, 2);
}
