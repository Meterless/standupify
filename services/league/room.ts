// =====================================================================
// The Room — stage presence and world state.
//
//   Presence   every comic carries a stage persona, the masters they study,
//              signature techniques (with mastery that grows on stage), a
//              tempo and a comfort with silence.
//   The room   every show has a living room: who is sitting where, how loud
//              and warm it is, what the earlier comics said (callback fuel),
//              the Circuit's famous bits the regulars know, and things that
//              happen mid-set (a phone, a tray, a birthday cake).
//   Delivery   writers mark stage directions inline — [beat], [hold],
//              [act-out], [to the crowd] — and the room reads them.
//
// Nightshift writes the set knowing the room; seeded rules decide how the
// room took it. Pure: no fetch, no storage. Deterministic given a seeded rng.
// =====================================================================

import type { Club, ShowFormat, SkillVector, StagePresence, RoomState, RoomPerson, RoomIncident, RoomGauge, StageNotes, Beat, Lore } from './types';
import { CRAFT, MASTERS, PERSONAS, ERA_LABEL, pickDiverse, masterByKey, personaByKey, type CraftId } from './masters';

const clamp = (n: number, lo = 0, hi = 10) => Math.max(lo, Math.min(hi, n));
const round1 = (n: number) => Math.round(n * 10) / 10;
const pick = <T,>(xs: T[], r: () => number) => xs[Math.floor(r() * xs.length)];

// ---------------------------------------------------------------------
// presence
// ---------------------------------------------------------------------

const MIC = [
  'pulls the mic off the stand on the first word and never puts it back',
  'leaves the mic in the stand and leans on it like a bar',
  'wraps the cord around one wrist and paces the length of it',
  'moves the stand behind them like it offended them',
  'holds the mic low at the chest and makes the room lean in',
  'switches hands on every punchline'
];
const WALKON = [
  'walks out slow, takes the room in, and lets them wait',
  'jogs out already talking',
  'stops dead center, says nothing, and stares until the first laugh',
  'shakes hands with the front row on the way up',
  'comes out mid-argument with someone backstage',
  'adjusts the stand for a long time before saying a word'
];
const CLOSER = [
  'drops the mic back in the stand on the last word and walks',
  'calls back the opener and leaves on the laugh',
  'says goodnight in a whisper',
  'points at the one person they worked all night',
  'bows like it was the opera',
  'leaves while the laugh is still climbing'
];

function tempoFrom(voice: string, delivery: number): StagePresence['tempo'] {
  const v = voice.toLowerCase();
  if (/rapid|manic|hype|frantic|fast|machine-gun|breathless/.test(v)) return 'rapid';
  if (/unhurried|slow|soft|calm|gravel|drawl|matter-of-fact|quiet|whisper/.test(v)) return 'slow';
  if (/deadpan|precise|clipped|flat|dry/.test(v)) return 'measured';
  return delivery >= 8 ? 'quick' : 'measured';
}

/** Who the Circuit already studies, so newcomers fill the gaps. */
export function presenceUsage(all: (StagePresence | undefined)[]) {
  const masters: Record<string, number> = {}, personas: Record<string, number> = {};
  for (const p of all) {
    if (!p) continue;
    personas[p.persona] = (personas[p.persona] || 0) + 1;
    for (const m of p.masters) masters[m] = (masters[m] || 0) + 1;
  }
  return { masters, personas };
}

export interface PresenceSeed {
  style: string;
  voice: string;
  skills: SkillVector;
  /** A mirror inherits the muse's teachers; an answer or a rival is built from the ones the muse ignored. */
  relation?: { kind: 'inherit' | 'oppose'; from: StagePresence };
}

export function makePresence(seed: PresenceSeed, r: () => number, usage: ReturnType<typeof presenceUsage>): StagePresence {
  const rel = seed.relation;
  const avoid = rel?.kind === 'oppose' ? rel.from.masters : [];
  const prefer = rel?.kind === 'inherit' ? rel.from.masters : [];
  const masterPool = MASTERS.filter(m => !avoid.includes(m.key));
  const masters = pickDiverse(masterPool, seed.style, r, usage.masters, 2, prefer);
  // Some comics study a third teacher from far outside their own style.
  if (r() < 0.35) {
    const wild = masterPool.filter(m => !masters.includes(m) && !m.styles.includes(seed.style));
    if (wild.length) masters.push(pick(wild, r));
  }
  const personaPool = PERSONAS.filter(p => rel?.kind !== 'oppose' || p.key !== rel.from.persona);
  const persona = rel?.kind === 'inherit' && r() < 0.5 ? personaByKey(rel.from.persona)! : pickDiverse(personaPool, seed.style, r, usage.personas, 1)[0];

  // Signature: what the persona and the teachers share, weighted by the comic's strongest skills.
  const votes = new Map<CraftId, number>();
  for (const c of persona.craft) votes.set(c, (votes.get(c) || 0) + 2);
  for (const m of masters) for (const c of m.craft) votes.set(c, (votes.get(c) || 0) + 1);
  const scored = [...votes.entries()].map(([c, v]) => [c, v + seed.skills[CRAFT[c].skill] / 4 + r()] as const).sort((a, b) => b[1] - a[1]);
  const signature = scored.slice(0, 3).map(([c]) => c);
  const mastery: Partial<Record<CraftId, number>> = {};
  for (const c of signature) mastery[c] = round1(clamp(3 + seed.skills[CRAFT[c].skill] * 0.45 + r() * 1.2, 2, 8.5));
  const tempo = tempoFrom(seed.voice, seed.skills.delivery);
  const silence = round1(clamp((tempo === 'slow' ? 7.5 : tempo === 'measured' ? 6 : tempo === 'quick' ? 4.5 : 3) + (signature.some(c => CRAFT[c].cue === 'hold' || CRAFT[c].cue === 'beat' || c === 'deadpan') ? 1.5 : 0) + r() - 0.5));
  return {
    persona: persona.key, masters: masters.map(m => m.key), signature, mastery, tempo, silence,
    mic: pick(MIC, r), walkon: pick(WALKON, r), closer: pick(CLOSER, r), lesson: null, hits: []
  };
}

export function describePresence(p: StagePresence): string {
  const persona = personaByKey(p.persona);
  const ms = p.masters.map(k => masterByKey(k)?.name).filter(Boolean).join(' and ');
  return `${persona?.name || 'A comic'} — ${persona?.stance}. Studies ${ms}.`;
}

// ---------------------------------------------------------------------
// the room
// ---------------------------------------------------------------------

const CLUB_ROOM: Record<string, Partial<RoomGauge> & { buzz: number }> = {
  cellar: { energy: 5, warmth: 4, focus: 8, buzz: 5 },
  neon: { energy: 7.5, warmth: 6, focus: 4, buzz: 8 },
  velvet: { energy: 5, warmth: 6.5, focus: 9, buzz: 3 },
  rooftop: { energy: 7, warmth: 6.5, focus: 5, buzz: 6 }
};

interface PersonSeed { who: string; tags: string[]; loud?: boolean }
const PEOPLE: PersonSeed[] = [
  { who: 'a bachelorette party of six in matching sashes', tags: ['bachelorette', 'bride', 'sash', 'sashes', 'wedding'], loud: true },
  { who: 'a couple on what is very clearly a first date', tags: ['first date', 'couple', 'date'] },
  { who: 'a man who laughs exactly one second after everyone else', tags: ['late laugh', 'one second', 'delayed', 'laughs late'] },
  { who: 'a nurse just off a double shift, still in scrubs', tags: ['nurse', 'scrubs', 'double shift'] },
  { who: 'a guy filming the whole set on his phone', tags: ['filming', 'phone', 'recording', 'camera'] },
  { who: 'a table of off-duty comedians with their arms crossed', tags: ['comedians', 'comics', 'arms crossed', 'open micers'] },
  { who: 'a grandmother who brought her teenage grandson', tags: ['grandma', 'grandmother', 'grandson', 'nana'] },
  { who: 'a woman celebrating her divorce, loudly', tags: ['divorce', 'divorced', 'ex-husband', 'celebrating'], loud: true },
  { who: 'the bartender, who has seen every set on this bill', tags: ['bartender', 'bar'] },
  { who: 'a tech guy in a fleece vest taking notes', tags: ['vest', 'fleece', 'tech', 'startup', 'notes'] },
  { who: 'two retired schoolteachers sharing one dessert', tags: ['teachers', 'retired', 'dessert'] },
  { who: 'a birthday table — she is turning forty and did not want this', tags: ['birthday', 'forty', '40'], loud: true },
  { who: 'a soldier home on leave with his whole family', tags: ['soldier', 'army', 'military', 'leave'] },
  { who: 'a guy in the front row who thinks he is part of the show', tags: ['front row', 'this guy', 'sir'], loud: true },
  { who: 'a couple having a quiet fight at table four', tags: ['fight', 'fighting', 'table four', 'arguing'] },
  { who: 'a group of coworkers on a company outing, the boss in the middle', tags: ['coworkers', 'boss', 'company', 'office', 'work'], loud: true },
  { who: 'a dad who was dragged here and refuses to smile', tags: ['dad', 'not smiling', 'refuses', 'arms folded'] },
  { who: 'two tourists who do not speak much English and laugh at everything', tags: ['tourists', 'tourist', 'english', 'visiting'] }
];

interface IncidentSeed { kind: RoomIncident['kind']; text: string; tags: string[]; clubs?: string[] }
const INCIDENTS: IncidentSeed[] = [
  { kind: 'phone', text: 'a phone rings in the third row — a loud, ancient ringtone', tags: ['phone', 'ring', 'ringtone', 'call'] },
  { kind: 'tray', text: 'a server drops a full tray of drinks', tags: ['tray', 'glass', 'drinks', 'dropped', 'server', 'waiter', 'waitress'] },
  { kind: 'walkout', text: 'someone gets up for the bathroom right in the middle of a setup', tags: ['bathroom', 'leaving', 'walk out', 'where you going', 'getting up'] },
  { kind: 'cake', text: 'a birthday cake with sparklers comes out mid-set', tags: ['cake', 'birthday', 'sparklers', 'candles'] },
  { kind: 'heckler', text: 'a drunk at the bar yells "you suck!" during a pause', tags: ['heckler', 'you suck', 'sir', 'buddy', 'pal', 'drunk'] },
  { kind: 'mic', text: 'the mic cuts out for two full seconds', tags: ['mic', 'microphone', 'sound guy', 'cut out'] },
  { kind: 'lights', text: 'the stage lights flicker and die for a moment', tags: ['lights', 'dark', 'electric', 'bill'] },
  { kind: 'siren', text: 'a siren screams past outside and drowns out a punchline', tags: ['siren', 'ambulance', 'police', 'cops', 'outside'], clubs: ['rooftop', 'neon'] },
  { kind: 'laugh', text: 'one person howls with laughter at the wrong moment and will not stop', tags: ['that guy', 'laugh', 'laughing', 'calm down'] }
];

/** Open the doors: who came tonight and what kind of night it is. */
export function openRoom(club: Club, format: ShowFormat, slots: number, theme: string, r: () => number, lore: Lore[]): RoomState {
  const base = CLUB_ROOM[club.id] || { energy: 5 + club.prestige * 0.3, warmth: 5.5, focus: 4 + club.prestige, buzz: 7 - club.prestige };
  const big = format === 'championship' || format === 'headliner';
  const jitter = () => (r() - 0.5) * 1.6;
  const people: RoomPerson[] = [];
  const pool = [...PEOPLE];
  const n = format === 'roast_battle' ? 2 : big ? 3 : 4;
  for (let i = 0; i < n && pool.length; i++) {
    const p = pool.splice(Math.floor(r() * pool.length), 1)[0];
    people.push({ id: `p${i}`, who: p.who, tags: p.tags, loud: !!p.loud, seat: i === 0 ? 'front row' : pick(['front row', 'by the bar', 'near the stage', 'in the back', 'center table'], r) });
  }
  const incidents: RoomIncident[] = [];
  for (let s = 0; s < slots; s++) {
    if (r() > (club.prestige >= 5 ? 0.22 : 0.38)) continue;
    const options = INCIDENTS.filter(x => (!x.clubs || x.clubs.includes(club.id)) && !incidents.some(i => i.kind === x.kind));
    const x = pick(options, r);
    incidents.push({ slot: s, kind: x.kind, text: x.text, tags: x.tags });
  }
  // The regulars know the Circuit's famous bits; small rooms are full of regulars.
  const regulars = club.prestige <= 3 ? r() < 0.75 : r() < 0.3;
  const known = regulars ? [...lore].sort((a, b) => b.heat - a.heat).slice(0, 3).map(l => l.id) : [];
  return {
    energy: round1(clamp((base.energy ?? 5) + (big ? 0.8 : 0) + jitter())),
    warmth: round1(clamp((base.warmth ?? 5.5) + jitter())),
    focus: round1(clamp((base.focus ?? 6) + (big ? 0.6 : 0) + jitter())),
    buzz: round1(clamp(base.buzz + jitter())),
    size: big ? 'packed' : r() < 0.3 ? 'half-empty' : 'full',
    regulars, known, people, incidents, heard: [], lastKill: null, lastBomb: null, theme
  };
}

const gauge = (room: RoomState): RoomGauge => ({ energy: room.energy, warmth: room.warmth, focus: room.focus });

function describeGauge(room: RoomState) {
  const loud = (room.energy + room.buzz) / 2;
  const mood = room.warmth >= 7 ? 'on your side' : room.warmth <= 4 ? 'cold and arms-crossed' : 'waiting to be won';
  const noise = loud >= 7.5 ? 'loud and boozy — quiet bits will get swallowed' : room.focus >= 8 ? 'pin-drop quiet and listening to every word' : 'chatty but with you when you have them';
  return `${room.size} room, ${mood}, ${noise}`;
}

/**
 * The room as the next comic walks into it — for the writer's brief.
 * `known` lore is what the regulars will recognize if it is called back.
 */
export function roomBrief(room: RoomState, presence: StagePresence | undefined, slot: number, total: number, lore: Lore[], name: (id: string) => string, format: ShowFormat): string {
  const lines: string[] = [];
  const order = slot === 0 ? 'You are first up — the room is still settling in.' : slot === total - 1 ? 'You are closing the show.' : `You are ${slot + 1} of ${total}.`;
  lines.push(`THE ROOM RIGHT NOW: ${describeGauge(room)}. ${order}`);
  if (room.lastKill && slot > 0) lines.push(`You are following ${name(room.lastKill)}, who just destroyed — the bar is high, and the room is still buzzing about their bit.`);
  else if (room.lastBomb && slot > 0) lines.push(`You are following ${name(room.lastBomb)}, who just bombed — the room is cold and nervous; win them back first.`);
  if (format !== 'roast_battle' && room.people.length) lines.push(`WHO IS IN THE ROOM: ${room.people.map(p => `${p.who} (${p.seat})`).join('; ')}. Work at least one of them into the set.`);
  const heard = room.heard.slice(-3);
  if (heard.length) lines.push(`TONIGHT SO FAR (callback fuel): ${heard.map(h => `${name(h.comedianId)} did "${h.title}" — ${h.hook}`).join(' | ')}.`);
  const known = lore.filter(l => room.known.includes(l.id));
  if (known.length) lines.push(`THE REGULARS ARE IN — they know these Circuit bits by heart: ${known.map(l => `${name(l.comedianId)}'s "${l.title}"`).join(', ')}. A quick nod to one is a long callback, not theft.`);
  const inc = room.incidents.find(i => i.slot === slot);
  if (inc) lines.push(`SOMETHING HAPPENS DURING YOUR SET: ${inc.text}. Deal with it on stage, in the moment, as part of the set.`);
  if (presence) {
    const persona = personaByKey(presence.persona);
    const ms = presence.masters.map(k => masterByKey(k)).filter(Boolean);
    lines.push(`YOUR STAGE PRESENCE: ${persona?.name} (${persona?.stance}). Walk-on: ${presence.walkon}. The mic: ${presence.mic}. Tempo: ${presence.tempo}; comfort with silence ${presence.silence}/10.`);
    if (ms.length) lines.push(`YOU STUDY (craft only — never their jokes, catchphrases or voice): ${ms.map(m => `${m!.name} from ${ERA_LABEL[m!.era]} (${m!.presence})`).join('; ')}.`);
    lines.push(`YOUR SIGNATURE MOVES: ${presence.signature.map(c => `${CRAFT[c].name} — ${CRAFT[c].drill}`).join(' ')}`);
    if (presence.lesson) lines.push(`LATELY YOU HAVE BEEN DRILLING: ${CRAFT[presence.lesson.craft].name} (from watching ${masterByKey(presence.lesson.master)?.name}). ${presence.lesson.text}`);
  }
  lines.push('TIMING: mark your delivery inline with stage directions in square brackets — [beat] a held pause before the punch, [hold] let the laugh breathe, [stare], [act-out], [voice], [to the crowd], [callback], [tag], [build], [riff]. They are directions, not spoken words. Let the big jokes breathe; plant something early and pay it off at the end.');
  return lines.join('\n');
}

// ---------------------------------------------------------------------
// delivery: stage directions in, a clean set out
// ---------------------------------------------------------------------

// Long, descriptive directions ("[act-out: holds up an invisible…]") are cues too.
const CUE = /\[([^\]\n]{1,160})\]/g;

/** A spoken line: one space between words, no @Material markers echoed from the brief. */
const spoken = (t: string) => t.replace(/(^|[\s("'])@(?=[A-Za-z])/g, '$1').replace(/\s+/g, ' ').trim();

/** Split a written set into spoken lines and the stage direction that follows each. */
export function parseDelivery(raw: string): { text: string; beats: Beat[] } {
  const beats: Beat[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  CUE.lastIndex = 0;
  while ((m = CUE.exec(raw))) {
    const line = spoken(raw.slice(last, m.index));
    const cue = m[1].trim().toLowerCase();
    if (line) beats.push({ line, cue });
    else if (beats.length && !beats[beats.length - 1].cue) beats[beats.length - 1].cue = cue;
    else if (beats.length) beats[beats.length - 1].cue = `${beats[beats.length - 1].cue}, ${cue}`;
    else beats.push({ line: '', cue });
    last = m.index + m[0].length;
  }
  const tail = spoken(raw.slice(last));
  if (tail) beats.push({ line: tail });
  const clean = beats.filter(b => b.line);
  // A leading cue (before the first word) belongs to the walk-on: keep it on the first line.
  if (beats[0] && !beats[0].line && clean[0]) clean[0] = { ...clean[0], lead: beats[0].cue };
  return { text: clean.map(b => b.line).join(' '), beats: clean };
}

/** Strip cues from a partial stream so the live view never shows brackets. */
export const stripCues = (t: string) => t.replace(/\[[^\]\n]{0,160}\]?/g, '').replace(/\s{2,}/g, ' ');

/** How long the TV holds after a line, by its cue. */
export function holdMs(cue: string | undefined): number {
  if (!cue) return 0;
  if (/hold|breathe|laugh|applause/.test(cue)) return 1500;
  if (/stare|look|silence/.test(cue)) return 1700;
  if (/beat|pause/.test(cue)) return 650;
  if (/tag|callback/.test(cue)) return 350;
  return 250;
}

// ---------------------------------------------------------------------
// reading what happened
// ---------------------------------------------------------------------

const STOP = new Set('about after again against all also always another because been before being below between both could doing during each every first found from going gonna have having here into just know like little look made make many more most much never night other people really right said same should since some still such than that their them then there these they thing things think this those three through time today tonight under until very want wanna was were what when where which while who whole with would year years your yours you'.split(' '));
const distinct = (t: string) => new Set(t.toLowerCase().replace(/[^a-z' ]+/g, ' ').split(/\s+/).filter(w => w.length >= 5 && !STOP.has(w)));

const CUE_CRAFT: [RegExp, CraftId][] = [
  [/beat|pause/, 'the-pause'], [/hold|breathe/, 'let-it-breathe'], [/stare/, 'the-stare'], [/look/, 'mock-indignation'],
  [/act-?out|acts? out|mime/, 'act-out'], [/voice|impression|accent/, 'character-voice'], [/crowd|front row|audience|table/, 'crowd-work'],
  [/heckler/, 'heckler-control'], [/callback/, 'callback'], [/tag/, 'tag-stack'], [/build|preach/, 'preacher-cadence'], [/riff|ad-?lib/, 'riff'],
  [/walk|pace|cross|stage/, 'physical-space'], [/laugh|crack|break/, 'laugh-at-yourself'], [/deadpan|flat/, 'deadpan']
];

/** Techniques a set used: its cues plus what the text itself shows. */
export function readCraft(text: string, beats: Beat[]): CraftId[] {
  const used = new Set<CraftId>();
  for (const b of beats) for (const cue of [b.cue, b.lead]) if (cue) for (const [re, c] of CUE_CRAFT) if (re.test(cue)) used.add(c);
  const lower = text.toLowerCase();
  const sentences = text.split(/(?<=[.!?…])\s+/).filter(Boolean);
  // An internal callback: a distinctive word from the opening returns in the closer.
  if (sentences.length >= 3) {
    const open = distinct(sentences.slice(0, Math.ceil(sentences.length / 3)).join(' '));
    const close = distinct(sentences[sentences.length - 1]);
    if ([...close].some(w => open.has(w))) used.add('callback');
  }
  // Repetition: a short phrase said three times or more.
  const words = lower.replace(/[^a-z' ]+/g, ' ').split(/\s+/).filter(Boolean);
  const tri: Record<string, number> = {};
  for (let i = 0; i + 3 <= words.length; i++) { const g = words.slice(i, i + 3).join(' '); tri[g] = (tri[g] || 0) + 1; }
  if (Object.values(tri).some(n => n >= 3)) used.add('repetition');
  if (/\b\w+, \w+(?: \w+)?,? and \w+/.test(lower)) used.add('rule-of-three');
  if (/\b(i|i'm|my)\b.*\b(loser|idiot|failure|disaster|ugly|broke|sad|pathetic)\b/.test(lower)) used.add('self-deprecation');
  return [...used];
}

export interface Hearing {
  stage: StageNotes;
  /** A quick, seeded read of how it felt in the room while they were on (before the panel). */
  feel: number;
  /** Something worth putting on the Grapevine. */
  headline?: string;
}

/**
 * The room hears one set. Deterministic: skills, presence, craft and the
 * room decide the lift; the room then moves for whoever is next.
 */
export function hear(
  room: RoomState, perf: { comedianId: string; title: string; text: string; beats: Beat[]; simulated: boolean },
  presence: StagePresence | undefined, skills: SkillVector, slot: number, r: () => number, lore: Lore[], name: (id: string) => string
): Hearing {
  const before = gauge(room);
  const followed: StageNotes['followed'] = slot > 0 ? (room.lastKill ? 'killer' : room.lastBomb ? 'bomb' : null) : null;
  const craft = perf.simulated ? [] : readCraft(perf.text, perf.beats);
  const lower = perf.text.toLowerCase();
  const notes: string[] = [];
  let gain = 0, loss = 0;
  let headline: string | undefined;

  // Who they worked.
  const worked = room.people.filter(p => !p.usedBy && p.tags.some(t => lower.includes(t)));
  for (const p of worked.slice(0, 2)) {
    p.usedBy = perf.comedianId;
    gain += skills.crowdwork >= 6 ? 0.25 : 0.1;
    notes.push(`worked ${p.who.replace(/^an? /, 'the ').split(',')[0]}`);
    if (!craft.includes('crowd-work')) craft.push('crowd-work');
  }

  // What happened mid-set, and whether they rode it.
  const inc = room.incidents.find(i => i.slot === slot);
  let handled: boolean | undefined;
  if (inc) {
    handled = !perf.simulated && (inc.tags.some(t => lower.includes(t)) || perf.beats.some(b => /riff|heckler/.test(b.cue || '')));
    if (handled) {
      gain += 0.55 + skills.crowdwork * 0.04;
      notes.push(`riffed on it when ${inc.text.split(' — ')[0]}`);
      if (!craft.includes('riff')) craft.push('riff');
      if (skills.crowdwork >= 7) headline = `${name(perf.comedianId)} turned it into the best moment of the night when ${inc.text.split(' — ')[0]}.`;
    } else {
      loss += 0.3;
      notes.push(`lost them for a second when ${inc.text.split(' — ')[0]}`);
    }
  }

  // Callbacks: to earlier sets tonight, and to the Circuit's famous bits.
  const theme = distinct(room.theme);
  const callbacks: string[] = [];
  for (const h of room.heard) {
    if (h.comedianId === perf.comedianId) continue;
    const hooks = [...distinct(h.title)].filter(w => !theme.has(w) && w !== 'untitled');
    if (hooks.some(w => lower.includes(w))) callbacks.push(`${name(h.comedianId)}'s "${h.title}"`);
  }
  const knownLore = lore.filter(l => room.known.includes(l.id) && l.comedianId !== perf.comedianId);
  for (const l of knownLore) {
    const hooks = [...distinct(l.title)].filter(w => !theme.has(w));
    if (hooks.some(w => lower.includes(w))) callbacks.push(`${name(l.comedianId)}'s legendary "${l.title}"`);
  }
  if (callbacks.length) {
    gain += room.regulars && callbacks.some(c => c.includes('legendary')) ? 0.55 : 0.35;
    if (!craft.includes('long-callback')) craft.push('long-callback');
    notes.push(`called back ${callbacks[0]}`);
    if (callbacks.some(c => c.includes('legendary')) && room.regulars) headline = `${name(perf.comedianId)} called back ${callbacks.find(c => c.includes('legendary'))} — the regulars lost it.`;
  }

  // Following a killer or a bomb.
  if (followed === 'killer') {
    const calledThem = callbacks.some(c => room.lastKill && c.startsWith(name(room.lastKill)));
    if (calledThem) { gain += 0.35; notes.push('followed a killer by playing off them'); }
    else if (skills.presence >= 8) { gain += 0.1; notes.push('followed a killer and held the room'); }
    else { loss += 0.35; notes.push('had to follow a killer'); }
  } else if (followed === 'bomb') {
    if (craft.includes('crowd-work') || craft.includes('riff')) { gain += 0.45; notes.push('brought a dead room back to life'); }
    else loss += 0.2;
  }

  // Room fit: quiet techniques in a loud room, loud ones in a quiet room.
  const loud = (room.energy + room.buzz) / 2;
  let quietHit = 0, loudHit = 0, leanIn = 0;
  for (const c of craft) {
    const m = presence?.mastery[c] ?? 4;
    const k = CRAFT[c];
    if (k.needsQuiet >= 0.6 && loud >= 7.2 && m < 8) quietHit++;
    else if (k.needsQuiet >= 0.6 && room.focus >= 7.5) leanIn++;
    if (k.needsQuiet <= 0.3 && loud >= 7) loudHit++;
    if (presence?.signature.includes(c) && m >= 7) gain += 0.1;
  }
  if (quietHit) { loss += Math.min(0.4, quietHit * 0.2); notes.push('the quiet moments got swallowed by the bar'); }
  if (loudHit) gain += Math.min(0.3, loudHit * 0.15);
  if (leanIn) gain += Math.min(0.2, leanIn * 0.1);
  if (room.focus >= 7.5 && craft.some(c => CRAFT[c].needsQuiet >= 0.6)) notes.push('the room leaned in for the quiet parts');

  // Letting it breathe.
  const breaths = perf.beats.filter(b => /beat|pause|hold|breathe|stare|silence/.test(b.cue || '')).length;
  const silence = presence?.silence ?? 5;
  if (breaths >= 2 && silence >= 6.5 && !quietHit) { gain += 0.25; notes.push('let it breathe — the laugh kept rolling'); }
  else if (breaths >= 3 && silence <= 3.5) { loss += 0.15; notes.push('the pauses felt nervous, not planned'); }
  if (!perf.simulated && !craft.length) loss += 0.1;
  // Everything at once is not timing: past six moves, the set gets busy.
  if (craft.length > 6) { loss += Math.min(0.5, (craft.length - 6) * 0.15); notes.push('tried every move at once — the room felt it'); }

  // Diminishing returns: the first good moves matter most; piling on more pays less and less.
  const lift = round1(clamp(1.1 * Math.tanh(gain / 1.6) - loss, -1.1, 1.1));
  const base = (skills.delivery + skills.presence + skills.writing) / 3;
  const feel = round1(clamp(base - 1 + lift * 1.4 + (r() - 0.5) * 1.6 + (room.warmth - 5.5) * 0.15));

  // The room moves.
  const loudSet = craft.filter(c => CRAFT[c].needsQuiet <= 0.3).length > craft.filter(c => CRAFT[c].needsQuiet >= 0.6).length;
  room.energy = round1(clamp(room.energy + (feel - 6) * 0.35 + (loudSet ? 0.4 : -0.2) + 0.15));
  room.warmth = round1(clamp(room.warmth + (feel - 6) * 0.45));
  room.focus = round1(clamp(room.focus + (loudSet ? -0.4 : 0.3) - 0.15));
  room.buzz = round1(clamp(room.buzz + 0.35));
  room.lastKill = feel >= 8 ? perf.comedianId : null;
  room.lastBomb = feel <= 4 ? perf.comedianId : null;
  if (!perf.simulated) {
    const first = perf.text.split(/(?<=[.!?…])\s+/)[0] || '';
    room.heard.push({ comedianId: perf.comedianId, title: perf.title, hook: first.split(/\s+/).slice(0, 10).join(' ') + (first.split(/\s+/).length > 10 ? '…' : '') });
  }

  return {
    feel, headline,
    stage: { delivery: perf.beats, craft, room: { before, after: gauge(room) }, followed, incident: inc?.text, handled, worked: worked.slice(0, 2).map(p => p.who), callbacks, lift, notes }
  };
}

// ---------------------------------------------------------------------
// growth — mastery comes from doing it in front of people
// ---------------------------------------------------------------------

/** Practice on stage: techniques they used move toward mastery. Returns techniques that crossed 8 tonight. */
export function practice(p: StagePresence, stage: StageNotes, final: number): CraftId[] {
  const mastered: CraftId[] = [];
  for (const c of stage.craft) {
    const was = p.mastery[c] ?? 3;
    const drilled = p.lesson?.craft === c ? 0.45 : 0;
    const now = round1(clamp(was + 0.25 + drilled + (final >= 7 ? 0.3 : final < 4 ? -0.25 : 0), 0, 10));
    p.mastery[c] = now;
    if (was < 8 && now >= 8) mastered.push(c);
  }
  // A technique mastered past a signature move becomes part of the act.
  for (const c of mastered) if (!p.signature.includes(c)) {
    const weakest = [...p.signature].sort((a, b) => (p.mastery[a] ?? 0) - (p.mastery[b] ?? 0))[0];
    if ((p.mastery[weakest] ?? 0) < (p.mastery[c] ?? 0)) p.signature = p.signature.map(x => (x === weakest ? c : x));
  }
  if (p.lesson && stage.craft.includes(p.lesson.craft) && final >= 7) p.lesson = null;   // drilled it into the act
  return mastered;
}

/**
 * Homework: after a rough night (or now and then), study one of their
 * masters for the technique that would have saved it.
 */
export function chooseLesson(p: StagePresence, stage: StageNotes | undefined, final: number, r: () => number, night: number): StagePresence['lesson'] {
  const want: CraftId[] = [];
  if (stage?.handled === false) want.push('riff', 'heckler-control');
  if (stage?.notes?.some(n => n.includes('swallowed'))) want.push('physical-space', 'preacher-cadence');
  if (stage?.notes?.some(n => n.includes('nervous'))) want.push('let-it-breathe', 'the-pause');
  if (stage?.followed === 'killer' && (stage.lift ?? 0) < 0) want.push('long-callback', 'callback');
  if (final < 5) want.push('the-stare', 'tag-stack', 'misdirection');
  const masters = p.masters.map(k => masterByKey(k)).filter(Boolean) as NonNullable<ReturnType<typeof masterByKey>>[];
  if (!masters.length) return p.lesson ?? null;
  // A technique one of their masters is known for, that they have not mastered yet.
  const offered = masters.flatMap(m => m.craft.map(c => [m, c] as const)).filter(([, c]) => (p.mastery[c] ?? 3) < 8);
  const fit = offered.filter(([, c]) => want.includes(c));
  const choice = (fit.length ? fit : offered)[Math.floor(r() * (fit.length || offered.length))];
  if (!choice) return p.lesson ?? null;
  const [m, c] = choice;
  return { night, master: m.key, craft: c, text: CRAFT[c].drill };
}

/** One line for the judges: how they worked the room. */
export function stageLine(s: StageNotes | undefined): string {
  if (!s) return '';
  const bits = [
    s.followed === 'killer' ? 'followed a killer' : s.followed === 'bomb' ? 'followed a bomb' : '',
    s.incident ? `${s.handled ? 'handled' : 'ignored'}: ${s.incident.split(' — ')[0]}` : '',
    s.worked?.length ? `worked ${s.worked[0].split(',')[0]}` : '',
    s.callbacks?.length ? `called back ${s.callbacks[0]}` : '',
    s.craft.length ? `delivery: ${s.craft.slice(0, 3).map(c => CRAFT[c].name).join(', ')}` : ''
  ].filter(Boolean);
  return bits.length ? ` [on stage: ${bits.join('; ')}]` : '';
}
