// Backstage is part of settling a show, so it survives restarts with the
// Circuit and never adds another model loop. Exchanges come from results,
// existing relationships and complementary skills, then steer the next set.
import type { BackstageExchange, CircuitState, CircuitStats, Show, SkillVector } from './types';

const HISTORY_LIMIT = 60;
const PAIR_COOLDOWN = 4;
const BRIEF_LIFETIME = 4;
const REMATCH_LIFETIME = 8;
const DRILLS: Record<keyof SkillVector, string> = {
  writing: 'cut the setup to one clear premise and finish on the strongest word',
  delivery: 'leave a beat after the punchline before adding the tag',
  crowdwork: 'ask one specific question and build a callback from the answer',
  originality: 'replace the familiar angle with one detail only you would notice',
  presence: 'plant your feet for the setup, then use one deliberate move for the turn'
};

const pairKey = (a: string, b: string) => [a, b].sort().join('|');
const isActive = (st: CircuitState, id: string) => st.stats[id]?.life === 'active';
const available = (st: CircuitState, id: string) => isActive(st, id) && !st.stats[id].inner?.resting;

function journal(s: CircuitStats, night: number, text: string) {
  s.journal = [{ night, text }, ...(s.journal || [])].slice(0, 20);
}

function strongestLesson(teacher: CircuitStats, learner: CircuitStats): keyof SkillVector | null {
  const skills = Object.keys(DRILLS) as (keyof SkillVector)[];
  const skill = skills.sort((a, b) => (teacher.skills[b] - learner.skills[b]) - (teacher.skills[a] - learner.skills[a]))[0];
  return teacher.skills[skill] - learner.skills[skill] >= 0.5 ? skill : null;
}

/** Settle once per night, including empty nights. Safe to replay after a reconnect. */
export function settleBackstage(st: CircuitState, show: Show, nameOf: (id: string) => string): BackstageExchange[] {
  if (!show.endedAt || show.night <= (st.backstageThroughNight ?? -1)) return [];
  const history = st.backstage || [];
  const participants = show.performances
    .filter(p => available(st, p.comedianId))
    .sort((a, b) => b.final - a.final || a.comedianId.localeCompare(b.comedianId));
  const present = new Set(show.performances.filter(p => isActive(st, p.comedianId)).map(p => p.comedianId));

  // A promise is fulfilled by an actual meeting, even if no new exchange fires.
  for (const e of history) {
    if (e.kind === 'rematch' && !e.resolvedNight && e.night < show.night && e.actors.every(id => present.has(id))) e.resolvedNight = show.night;
  }

  const made: BackstageExchange[] = [];
  const busy = new Set<string>();
  const canPair = (a: string, b: string) => a !== b && available(st, a) && available(st, b)
    && !busy.has(a) && !busy.has(b)
    && !history.some(e => pairKey(...e.actors) === pairKey(a, b) && show.night - e.night < PAIR_COOLDOWN);
  const add = (kind: BackstageExchange['kind'], a: string, b: string, topic: string, text: string, notes: [string, string]) => {
    if (made.length >= 3 || !canPair(a, b)) return;
    const e: BackstageExchange = { id: `backstage:${show.id}:${kind}:${pairKey(a, b)}`, showId: show.id, night: show.night, kind, actors: [a, b], topic, text };
    made.push(e);
    busy.add(a); busy.add(b);
    journal(st.stats[a], show.night, notes[0]);
    journal(st.stats[b], show.night, notes[1]);
  };

  // A close result between established rivals earns a concrete booking request.
  const [winner, runnerUp] = participants;
  if (winner && runnerUp && Math.abs(winner.final - runnerUp.final) <= 0.7) {
    const a = winner.comedianId, b = runnerUp.comedianId;
    const rival = st.rivalries.find(r => pairKey(r.a, r.b) === pairKey(a, b) && r.heat >= 2);
    if (rival && canPair(a, b)) {
      const topic = `${winner.final.toFixed(1)}–${runnerUp.final.toFixed(1)} on night ${show.night}`;
      add('rematch', a, b, topic, `${nameOf(b)} asks ${nameOf(a)} for a rematch after a ${topic} finish. ${nameOf(a)} accepts.`, [
        `Accepted ${nameOf(b)}'s rematch. The last finish was ${topic}; bring a new angle.`,
        `${nameOf(a)} accepted my rematch. ${topic} was close enough. Next time, fresh material.`
      ]);
    }
  }

  // The mentor can be off the bill. Otherwise a stronger peer gives the notes.
  for (const p of [...participants].reverse()) {
    if (p.final >= 6.5 || busy.has(p.comedianId)) continue;
    const learner = st.stats[p.comedianId];
    const teachers = [learner.mentorId, ...participants.filter(x => x.final >= 6.5).map(x => x.comedianId)]
      .filter((id): id is string => !!id && canPair(id, p.comedianId));
    const teacherId = teachers.find(id => strongestLesson(st.stats[id], learner));
    if (!teacherId) continue;
    const skill = strongestLesson(st.stats[teacherId], learner)!;
    const topic = DRILLS[skill];
    add('mentoring', teacherId, p.comedianId, topic,
      `${nameOf(teacherId)} stays after the show to help ${nameOf(p.comedianId)} rework “${p.title}” (${p.final.toFixed(1)}): ${topic}.`, [
        `Gave ${nameOf(p.comedianId)} a ${skill} drill after “${p.title}”: ${topic}.`,
        `${nameOf(teacherId)} helped me after “${p.title}”. Next set: ${topic}.`
      ]);
  }

  // Healthy peers trade perspectives on the actual theme, never each other's jokes.
  const peers = participants.filter(p => p.final >= 6 && !busy.has(p.comedianId));
  for (let i = 0; i < peers.length && made.length < 3; i++) {
    const a = peers[i].comedianId;
    const partner = peers.slice(i + 1).find(p => {
      const b = p.comedianId;
      return canPair(a, b) && !st.rivalries.some(r => pairKey(r.a, r.b) === pairKey(a, b) && r.heat >= 5);
    });
    if (!partner) continue;
    const b = partner.comedianId;
    const topic = show.theme || 'what happened in the room tonight';
    add('collaboration', a, b, topic,
      `${nameOf(a)} and ${nameOf(b)} trade perspectives on “${topic}” backstage. Each will bring their own version to the next set.`, [
        `Traded perspectives with ${nameOf(b)} on “${topic}”. Find a personal angle and credit the conversation.`,
        `Traded perspectives with ${nameOf(a)} on “${topic}”. Find a personal angle and credit the conversation.`
      ]);
  }

  st.backstage = [...made].reverse().concat(history).slice(0, HISTORY_LIMIT);
  st.backstageThroughNight = show.night;
  return made;
}

/** Most recent accepted, unplayed rematch whose participants are eligible. */
export function pendingBackstageRematch(st: CircuitState, eligible: Iterable<string>, night = st.night + 1): [string, string] | null {
  const ids = new Set(eligible);
  const e = (st.backstage || []).find(e => e.kind === 'rematch' && !e.resolvedNight
    && e.actors[0] !== e.actors[1] && e.night < night && night - e.night <= REMATCH_LIFETIME
    && e.actors.every(id => ids.has(id) && available(st, id)));
  return e ? [...e.actors] : null;
}

/** A bounded memory in the writer's existing prompt; no extra generation calls. */
export function backstageBrief(st: CircuitState, comedianId: string, night: number, nameOf: (id: string) => string): string {
  if (!isActive(st, comedianId)) return '';
  const exchanges = (st.backstage || []).filter(e => e.actors.includes(comedianId) && e.night < night
    && e.actors[0] !== e.actors[1] && night - e.night <= BRIEF_LIFETIME && e.actors.every(id => isActive(st, id))).slice(0, 2);
  const lines = exchanges.map(e => {
    const other = nameOf(e.actors.find(id => id !== comedianId)!);
    if (e.kind === 'mentoring') return e.actors[1] === comedianId
      ? `${other} helped you after your last set. Put this drill into practice: ${e.topic}.`
      : `You helped ${other} with this drill: ${e.topic}. Lead by example in your own set.`;
    if (e.kind === 'rematch') return e.resolvedNight ? '' : `You and ${other} agreed to a rematch after ${e.topic}. Bring a fresh angle; a playful jab can acknowledge the close finish.`;
    return `You traded perspectives with ${other} on “${e.topic}”. Try your own new angle and briefly credit the conversation; do not copy their jokes.`;
  }).filter(Boolean);
  return lines.length ? `BACKSTAGE: ${lines.join(' ')}` : '';
}
