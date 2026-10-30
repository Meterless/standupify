// =====================================================================
// The Circuit engine.
//
//   calendar → booking → rehearsal (Nightshift best_of_n, or one chat draft)
//   → judge panel (Nightshift) → crowd (seeded) → ratings, promotions,
//   rivalries, joke-theft evidence, titles → production (winner's still)
//   → lineage tick (apprentices, debuts, retirements)
//
// Models only ever propose prose and scores. Booking, crowd, ratings and
// storylines are seeded rules, and every change lands in the event log.
// =====================================================================

import type { AISettings, Angle, Bit, Comedian, Material, MaterialType, Set as ComedySet } from '../../types';
import { getRepository, DEFAULT_AUTOPILOT_CONFIG, DEFAULT_PUBLISHING_SETTINGS, emptyProfile } from '../repository';
import { chat, chatJson, extractJson, describeError } from '../nightshift/runtime';
import { rehearse } from '../nightshift/rehearse';
import { getEngines, subscribeEngines } from '../engines';
import { backgroundText, renderStill, animateBit, judgeAvailable, comedianSeed } from '../studio';
import { CLUBS, FOUNDERS, THEMES, NEWCOMER_FIRST, NEWCOMER_LAST, STYLES } from './founders';
import {
  CareerStage, CircuitEvent, CircuitEventKind, CircuitState, CircuitStats, Club, FORMAT_LABEL,
  JudgeCard, Lens, Performance, Rivalry, Show, ShowFormat, SkillVector, STAGE_LABEL, StagePresence, RoomState
} from './types';
import * as store from './store';
import { forge, readTheRoom, advanceEra, chooseAim, judgeAim, emptyEra, LENS_LABEL, type ForgePlan } from './forge';
import { makePresence, presenceUsage, openRoom, roomBrief, parseDelivery, stripCues, hear, practice, chooseLesson, stageLine } from './room';
import { CRAFT, masterByKey } from './masters';
import { connectCircuit, considerOriginals, originalsHoldCamera } from '../premium/production';
import { expectBefore, innerBrief, afterShowMind, type InnerAction } from './inner';
import { settleBackstage, backstageBrief, pendingBackstageRematch } from './backstage';
import { syncWorld, canonBlock, setAnchor, needsEssence, lockEssence, noteAppearance, registerTheater, findTheater, ESSENCE_PROMPT, vision, noteVisionError } from '../world/model';
import { mediaBlob } from '../bus';
import { blobToDataUrl } from '../studio';

const repo = () => getRepository();
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const uid = (p: string) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
const clamp = (n: number, lo = 0, hi = 10) => Math.max(lo, Math.min(hi, n));
const round1 = (n: number) => Math.round(n * 10) / 10;
const MATERIAL_TYPES: MaterialType[] = ['PERSONA', 'PROP', 'VENUE', 'THEME', 'BIT', 'CATCHPHRASE'];
const MAX_ACTIVE = 16;
const MIN_ACTIVE = 6;
const STAGES: CareerStage[] = ['open_mic', 'regular', 'feature', 'headliner', 'legend'];

export const JUDGES = [
  { key: 'booker', name: 'Marty', role: 'the Booker', cares: 'structure, originality, and whether he would book them again' },
  { key: 'critic', name: 'Dana', role: 'the Critic', cares: 'voice, craft, surprise, and a real point of view' },
  { key: 'heckler', name: 'Big Lou', role: 'the Heckler', cares: 'only whether it is funny — merciless, loud, impossible to fake out' }
] as const;

// ---------------------------------------------------------------------
// deterministic randomness
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
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());
function shuffle<T>(xs: T[], r: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ---------------------------------------------------------------------
// state
// ---------------------------------------------------------------------

let state: CircuitState | null = null;
let comics = new Map<string, Comedian>();
let recent: Show[] = [];
// One Circuit per page, even if the module is loaded twice (hot reload, a second
// import): the show and loop flags live on the global object, not the module.
const G = globalThis as any;
const flags: { running: boolean; loopAlive: boolean; loopId: number } = (G.__standupifyCircuit ||= { running: false, loopAlive: false, loopId: 0 });

async function commit() {
  if (!state) return;
  await store.writeState(state);
  store.publishCircuit({ state: { ...state }, shows: [...recent] });
}

function event(kind: CircuitEventKind, text: string, actors: string[], extra: Partial<CircuitEvent> = {}) {
  if (!state) return;
  state.events = [{ id: uid('ev'), night: state.night, kind, text, actors, at: Date.now(), ...extra }, ...state.events].slice(0, 400);
}

const nameOf = (id: string) => comics.get(id)?.name || 'Someone';

function newStats(id: string, skills: SkillVector, doctrine: string, elo: number, founderId: string, mentorId: string | null, generation: number, night: number): CircuitStats {
  return {
    comedianId: id, elo, stage: elo >= 1290 ? 'headliner' : elo >= 1180 ? 'feature' : elo >= 1050 ? 'regular' : 'open_mic',
    life: 'active', skills, doctrine, fans: Math.round(elo * 0.6), shows: 0, wins: 0, bombs: 0, streak: 0, bestScore: 0, titles: 0,
    founderId, mentorId, generation, apprentices: [], lastShowNight: null, circuitSetId: null, eloHistory: [elo], joinedNight: night, clubWins: {}
  };
}

function comedianFrom(seed: { id: string; name: string; tagline: string; voice: string; style: string; audience: string; look: string; venue: string; material: [string, MaterialType, string][] }): Comedian {
  const now = Date.now();
  const material: Material[] = seed.material.map(([name, type, description], i) => ({ id: `mat_${seed.id}_${i}`, name, type, description }));
  return {
    id: seed.id, name: seed.name, tagline: seed.tagline, voice: seed.voice, style: seed.style, audience: seed.audience,
    look: seed.look, venue: seed.venue, status: 'active', publishVisibility: 'outbox',
    profile: { ...emptyProfile(), material }, publishingSettings: { ...DEFAULT_PUBLISHING_SETTINGS },
    autopilotConfig: { ...DEFAULT_AUTOPILOT_CONFIG }, createdAt: now, updatedAt: now
  };
}

async function refreshComics() {
  if (!state) return;
  const all = await repo().listComedians();
  comics = new Map(all.filter(c => state!.stats[c.id]).map(c => [c.id, c]));
}

let initializingCircuit: Promise<CircuitState> | null = null;

/** Concurrent mounts share one load, including first-run founder writes. */
export function ensureCircuit(): Promise<CircuitState> {
  if (initializingCircuit) return initializingCircuit;
  initializingCircuit = loadCircuit().finally(() => { initializingCircuit = null; });
  return initializingCircuit;
}

/** Load the Circuit, seeding the founders on first run. */
async function loadCircuit(): Promise<CircuitState> {
  if (station) {
    if (!state) await applyStationSnapshot(await station.snapshot());
    if (!state) { await station.cmd('ensureCircuit'); await applyStationSnapshot(await station.snapshot()); }
    return state!;
  }
  if (state) return state;
  const saved = await store.loadState();
  if (saved) {
    state = saved;
    // Circuits from before the Forge: name how everyone got here.
    for (const s of Object.values(state.stats)) s.lens ||= s.mentorId ? 'disciple' : s.generation === 0 && s.founderId === s.comedianId && s.comedianId.startsWith('comedian_founder-') ? 'founder' : 'newcomer';
  } else {
    const st: CircuitState = {
      version: 1, seed: Math.floor(Math.random() * 2 ** 31), night: 0, live: false, rehearsals: 3,
      clubs: CLUBS.map(c => ({ ...c })), stats: {}, rivalries: [], events: [], champion: null, createdAt: Date.now()
    };
    for (const f of FOUNDERS) {
      const id = `comedian_${f.key}`;
      if (!(await repo().getComedian(id))) await repo().saveComedian(comedianFrom({ ...f, id }));
      st.stats[id] = { ...newStats(id, f.skills, f.doctrine, f.elo, id, null, 0, 0), lens: 'founder' };
    }
    state = st;
    event('season', `The Circuit opens: ${FOUNDERS.length} founders, ${CLUBS.length} clubs, one stage at a time.`, Object.keys(st.stats));
    await store.writeState(st);
  }
  await refreshComics();
  ensurePresence(state);
  recent = await store.recentShows(60);
  store.publishCircuit({ state: { ...state }, shows: [...recent] });
  return state;
}

export async function resetCircuit() {
  if (station) { await station.cmd('resetCircuit'); return; }
  stopLoop();
  await store.resetCircuitDb();
  state = null;
  recent = [];
  store.patchLive({ show: null, phase: 'idle', current: -1, streaming: '', note: '', drafts: null });
  await ensureCircuit();
}

/** Put one of your own comedians on the Circuit. */
export async function enterCircuit(c: Comedian) {
  if (station) { await station.cmd('enterCircuit', c.id); return; }
  const st = await ensureCircuit();
  if (st.stats[c.id]) { st.stats[c.id].life = 'active'; await commit(); return; }
  st.stats[c.id] = newStats(c.id, { writing: 6, delivery: 6, crowdwork: 6, originality: 7, presence: 6 }, `${c.style}, ${c.voice}`, 1000, c.id, null, 0, st.night);
  comics.set(c.id, c);
  event('debut', `${c.name} signs up for the Circuit. First stop: open mic.`, [c.id]);
  await commit();
}

export async function setRehearsals(n: number) {
  if (station) { await station.cmd('setRehearsals', n); return; }
  const st = await ensureCircuit();
  st.rehearsals = Math.max(1, Math.min(5, Math.round(n)));
  await commit();
}

// ---------------------------------------------------------------------
// calendar + booking
// ---------------------------------------------------------------------

export function nextPlan(st: CircuitState): { night: number; club: Club; format: ShowFormat } {
  const night = st.night + 1;
  if (night % 8 === 0) return { night, club: st.clubs.reduce((a, b) => (b.prestige > a.prestige ? b : a)), format: 'championship' };
  const club = st.clubs[(night - 1) % st.clubs.length];
  return { night, club, format: club.formats[Math.floor((night - 1) / st.clubs.length) % club.formats.length] };
}

function active(st: CircuitState) { return Object.values(st.stats).filter(s => s.life === 'active' && comics.has(s.comedianId)); }

function rivalry(st: CircuitState, a: string, b: string): Rivalry {
  const [x, y] = a < b ? [a, b] : [b, a];
  let r = st.rivalries.find(v => v.a === x && v.b === y);
  if (!r) { r = { a: x, b: y, heat: 0, meetings: 0, aWins: 0, bWins: 0, lastNight: 0 }; st.rivalries.push(r); }
  return r;
}

function book(st: CircuitState, format: ShowFormat, r: () => number): string[] {
  const pool = active(st);
  const rested = pool.filter(s => s.lastShowNight !== st.night && !s.inner?.resting);
  const from = rested.length >= 4 ? rested : pool;
  const byElo = [...from].sort((a, b) => b.elo - a.elo);
  const rank = (s: CircuitStats) => STAGES.indexOf(s.stage);
  switch (format) {
    case 'championship': return [...pool].sort((a, b) => b.elo - a.elo).slice(0, 4).map(s => s.comedianId);
    case 'roast_battle': {
      // The hottest rivalry gets the mic; otherwise the two closest ratings.
      const ids = new Set(from.map(s => s.comedianId));
      const rematch = pendingBackstageRematch(st, ids);
      if (rematch) return rematch;
      const hot = st.rivalries.filter(v => ids.has(v.a) && ids.has(v.b) && v.heat >= 2).sort((a, b) => b.heat - a.heat)[0];
      if (hot && r() < 0.75) return [hot.a, hot.b];
      const pairs: [CircuitStats, CircuitStats, number][] = [];
      for (let i = 0; i < byElo.length - 1; i++) pairs.push([byElo[i], byElo[i + 1], Math.abs(byElo[i].elo - byElo[i + 1].elo)]);
      pairs.sort((a, b) => a[2] - b[2]);
      const pick = pairs[Math.floor(r() * Math.min(3, pairs.length))];
      return pick ? [pick[0].comedianId, pick[1].comedianId] : byElo.slice(0, 2).map(s => s.comedianId);
    }
    case 'open_mic': {
      const green = shuffle(from.filter(s => rank(s) <= 1), r).sort((a, b) => a.shows - b.shows);
      const rest = shuffle(from.filter(s => rank(s) > 1 && rank(s) < 4), r);
      return [...green, ...rest].slice(0, 4).map(s => s.comedianId);
    }
    case 'headliner': {
      const head = byElo.find(s => rank(s) >= 3) || byElo[0];
      const support = shuffle(from.filter(s => s !== head && rank(s) >= 1 && rank(s) <= 3), r).slice(0, 2);
      const fill = shuffle(from.filter(s => s !== head && !support.includes(s)), r);
      return [...[...support, ...fill].slice(0, 2), head].filter(Boolean).map(s => s.comedianId);
    }
    default: {
      const mid = shuffle(from.filter(s => rank(s) >= 1), r);
      const fill = shuffle(from.filter(s => rank(s) < 1), r);
      return callOut(st, [...mid, ...fill].slice(0, 4).map(s => s.comedianId), from, r);
    }
  }
}

/** Aims steer the calendar: a comic chasing someone gets a night on the same bill. */
function callOut(st: CircuitState, lineup: string[], from: CircuitStats[], r: () => number): string[] {
  const rested = new Set(from.map(s => s.comedianId));
  const rematch = pendingBackstageRematch(st, rested);
  if (rematch) {
    const others = lineup.filter(id => !rematch.includes(id));
    return [...rematch, ...others].slice(0, lineup.length);
  }
  for (const id of lineup) {
    const t = st.stats[id]?.inner?.callout?.target || st.stats[id]?.aim?.target;
    if (!t || lineup.includes(t) || !rested.has(t) || r() > 0.5) continue;
    const slot = lineup.findIndex(x => x !== id && !st.stats[x]?.aim?.target);
    if (slot >= 0) { lineup = lineup.map((x, i) => (i === slot ? t : x)); break; }
  }
  return lineup;
}

// ---------------------------------------------------------------------
// writing
// ---------------------------------------------------------------------

function liveText(partial: string): string {
  const m = stripCues(partial).match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)/);
  return m ? m[1].replace(/\\n/g, ' ').replace(/\\"/g, '"') : '';
}

function setBrief(st: CircuitState, c: Comedian, s: CircuitStats, show: Show, club: Club, opp?: Comedian, room?: string) {
  const material = c.profile.material.slice(0, 6).map(m => `@${m.name}: ${m.description}`).join(' | ');
  const hot = st.rivalries.filter(v => (v.a === c.id || v.b === c.id) && v.heat >= 3).sort((a, b) => b.heat - a.heat)[0];
  const context = [
    s.streak >= 2 ? `You are on a ${s.streak}-show win streak.` : s.streak <= -2 ? `You have lost ${-s.streak} in a row and need this one.` : '',
    hot ? `Your rival ${nameOf(hot.a === c.id ? hot.b : hot.a)} is in the scene; a jab at them is welcome.` : '',
    s.mentorId ? `You trained under ${nameOf(s.mentorId)}; make them proud, or prove you have outgrown them.` : '',
    s.aim ? `What you want more than anything right now: to ${s.aim.text}.` : '',
    s.museId && s.lens && s.lens !== 'disciple' && comics.has(s.museId) ? `You came up as ${LENS_LABEL[s.lens](nameOf(s.museId))}.` : '',
    innerBrief(s, nameOf),
    backstageBrief(st, c.id, show.night, nameOf)
  ].filter(Boolean).join(' ');
  const length = show.format === 'headliner' || show.format === 'championship' ? '5–7 sentences: a setup, an escalation, a callback and a closer'
    : show.format === 'open_mic' ? '3–4 sentences' : '4–5 sentences';
  const brief = show.format === 'roast_battle' && opp
    ? `ROAST BATTLE at ${club.name} (${club.crowd}). Roast ${opp.name} ("${opp.tagline}"); they look like ${opp.look}; their style is ${opp.style}. Go after their persona, look and act: savage, clever, no slurs.`
    : `${FORMAT_LABEL[show.format]} at ${club.name}. The crowd: ${club.crowd}. Tonight's theme: ${show.theme}.`;
  return {
    system: `You are ${c.name}, a stand-up comedian. Voice: ${c.voice}. Style: ${c.style}. Your school of comedy: ${s.doctrine}. You only write material you would actually perform, in plain spoken sentences the way you talk on stage (no em dashes). Output ONLY valid JSON.`,
    prompt: `${brief}\nYOUR MATERIAL: ${material || 'none yet, invent it'}\n${context}${room ? `\n\n${room}` : ''}\n\nWrite your set: ${length}. Specific, surprising, genuinely funny, in your own voice.\nReturn ONLY JSON: { "title": "short bit name", "text": "the set exactly as you would say it on stage${room ? ', with [stage directions] inline' : ''}" }`
  };
}

/** A busy runtime can blink "offline" for a poll or two; give it a few minutes before calling it. */
async function waitForNightshift(maxMs: number): Promise<boolean> {
  const until = Date.now() + maxMs;
  while (Date.now() < until) {
    if (getEngines().nightshift.state === 'online') return true;
    await sleep(3000);
  }
  return getEngines().nightshift.state === 'online';
}

interface WriteOpts { offlineShow?: boolean; jobId?: string; onJob?: (jobId: string) => void; room?: string }

async function writeSet(st: CircuitState, c: Comedian, s: CircuitStats, show: Show, club: Club, settings: AISettings, opp?: Comedian, o: WriteOpts = {}): Promise<{ title: string; text: string; drafts: number; simulated: boolean }> {
  const offlineShow = !!o.offlineShow;
  // A show that started without Nightshift is simulated throughout; one that
  // started with it waits out a blip instead of quietly faking a set.
  if (offlineShow) return simulateSet(c, show, opp);
  if (!(await waitForNightshift(4 * 60_000))) return simulateSet(c, show, opp);
  const { system, prompt } = setBrief(st, c, s, show, club, opp, o.room);
  return backgroundText(`Circuit · ${c.name} writes`, async (h) => {
    h.update({ stage: st.rehearsals > 1 ? `rehearsing ${st.rehearsals} drafts` : 'writing' });
    if (st.rehearsals > 1) {
      try {
        const out = await rehearse({
          system, prompt, drafts: st.rehearsals, quality: settings.quality, jobId: o.jobId, onJob: o.onJob,
          onProgress: (p) => { store.patchLive({ drafts: { done: p.drafts, of: p.of } }); h.update({ progress: p.of ? p.drafts / p.of : -1 }); }
        });
        const j = extractJson<{ title: string; text: string }>(out.text);
        if (j?.text) return { title: j.title || 'Untitled', text: j.text, drafts: out.drafts, simulated: false };
      } catch { /* one chat draft instead */ }
    }
    store.patchLive({ drafts: null });
    const j = await chatJson<{ title: string; text: string }>({
      task: 'writeBit', quality: settings.quality, system, prompt, maxTokens: 2400,
      onDelta: (t) => store.patchLive({ streaming: liveText(t) })
    });
    return { title: j.title || 'Untitled', text: j.text || '', drafts: 1, simulated: false };
  }, { comedianId: c.id });
}

/** Nightshift offline: the comic works from their material bank. Clearly labelled. */
function simulateSet(c: Comedian, show: Show, opp?: Comedian) {
  const m = c.profile.material;
  const pick = m.length ? m[Math.floor(Math.random() * m.length)] : null;
  const text = opp
    ? `${opp.name}? ${opp.tagline} That's not a bio, that's a cry for help.`
    : pick ? `${pick.name} — ${pick.description}. And somehow that's still better than ${show.theme}.` : `Let me tell you about ${show.theme}.`;
  return { title: pick?.name || FORMAT_LABEL[show.format], text, drafts: 0, simulated: true };
}

// ---------------------------------------------------------------------
// judging + crowd
// ---------------------------------------------------------------------

function fallbackCards(s: CircuitStats, r: () => number): JudgeCard[] {
  const base = (s.skills.writing + s.skills.originality + s.skills.delivery) / 3;
  return JUDGES.map(j => ({ judge: j.key, score: round1(clamp(base - 1 + gauss(r) * 1.1)), line: 'Scored from the room — the panel was offline.' }));
}

async function judgePanel(show: Show, settings: AISettings, r: () => number): Promise<JudgeCard[][]> {
  const sets = show.performances.map((p, i) => {
    const c = comics.get(p.comedianId);
    return `${i + 1}. ${c?.name} (${c?.style})${p.target ? `, roasting ${nameOf(p.target)}` : ''} — "${p.title}": ${p.text}${stageLine(p.stage)}`;
  }).join('\n');
  const prompt = `${FORMAT_LABEL[show.format]} — tonight's theme: ${show.theme}.\nTHE SETS:\n${sets}\n\nTHE PANEL:\n${JUDGES.map(j => `- ${j.name}, ${j.role}: cares about ${j.cares}`).join('\n')}\n\nEach judge scores every set 0–10 (decimals allowed; be honest — a 9 means the room exploded) with one 6–14 word line in their own voice.\nReturn ONLY JSON: { "sets": [ { "n": 1, "booker": { "score": 0, "line": "" }, "critic": { "score": 0, "line": "" }, "heckler": { "score": 0, "line": "" } } ] }`;
  return backgroundText(`Circuit · the panel scores ${FORMAT_LABEL[show.format]}`, async () => {
    const ask = (task: 'judge' | 'copy') => chatJson<{ sets: any[] }>({
      // Streamed, so the request timeout covers the first token rather than a
      // five-minute panel on a small local model.
      onDelta: () => { /* progress only */ },
      task, quality: settings.quality === 'local' ? 'local' : 'auto', temperature: 0.3, maxTokens: 4600,
      system: 'You are a panel of three comedy judges scoring a live show. Each judge has a distinct personality. Output ONLY valid JSON.',
      prompt
    });
    let out: { sets: any[] };
    try { out = await ask(judgeAvailable() ? 'judge' : 'copy'); }
    catch { out = await ask('copy'); }
    return show.performances.map((p, i) => {
      const row = (out.sets || []).find((x: any) => Number(x?.n) === i + 1) || (out.sets || [])[i];
      const stats = state!.stats[p.comedianId];
      if (!row) return fallbackCards(stats, r);
      return JUDGES.map(j => {
        const cell = row[j.key] || {};
        const score = Number(cell.score);
        return Number.isFinite(score)
          ? { judge: j.key, score: round1(clamp(score)), line: String(cell.line || '').slice(0, 140) }
          : fallbackCards(stats, r).find(x => x.judge === j.key)!;
      });
    });
  });
}

function crowd(p: Performance, s: CircuitStats, c: Comedian | undefined, club: Club, format: ShowFormat, r: () => number) {
  const moments: string[] = [];
  let room = p.judgeMean * 0.85 + 1.1 + (club.loves.includes(c?.style || '') ? 0.6 : -0.25) + (s.skills.presence - 6) * 0.15 + gauss(r) * 0.75;
  if (r() < 0.14) {
    if (s.skills.crowdwork >= 7) { room += 0.8; moments.push('heckler — and destroyed him'); }
    else { room -= 0.9; moments.push('heckler — lost the room for a minute'); }
  }
  room = round1(clamp(room));
  if (room >= 8.8) moments.push('applause break');
  if (room <= 3.5) moments.push('crickets');
  const weight = format === 'roast_battle' ? 0.5 : 0.6;
  return { crowd: room, laughs: Math.max(0, Math.round(room * 2.6 + r() * 4 - 2)), moments, final: round1(p.judgeMean * weight + room * (1 - weight)) };
}

// ---------------------------------------------------------------------
// ratings, stages, rivalries, theft
// ---------------------------------------------------------------------

function applyElo(perfs: Performance[]) {
  const n = perfs.length;
  if (n < 2) return;
  const K = 40 / (n - 1);
  const delta = perfs.map(() => 0);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    if (i === j) continue;
    const e = 1 / (1 + 10 ** ((perfs[j].eloBefore - perfs[i].eloBefore) / 400));
    const s = perfs[i].final > perfs[j].final ? 1 : perfs[i].final === perfs[j].final ? 0.5 : 0;
    delta[i] += K * (s - e);
  }
  perfs.forEach((p, i) => { p.eloAfter = Math.round(p.eloBefore + delta[i]); });
}

function stageFor(s: CircuitStats): CareerStage {
  if ((s.elo >= 1380 && s.wins >= 8) || s.titles >= 2) return 'legend';
  if (s.elo >= 1290 && s.wins >= 4) return 'headliner';
  if (s.elo >= 1180 && s.wins >= 2) return 'feature';
  if (s.shows >= 3 && s.elo >= 1020) return 'regular';
  return 'open_mic';
}

function words(t: string) { return t.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean); }
function grams(t: string, n: number) { const w = words(t); const g = new Set<string>(); for (let i = 0; i + n <= w.length; i++) g.add(w.slice(i, i + n).join(' ')); return g; }

/** Two shared five-word runs with an earlier set by someone else is evidence, not proof. */
function findTheft(p: Performance, show: Show) {
  const mine = grams(p.text, 5);
  if (mine.size < 6) return null;
  for (const old of recent) {
    if (old.night >= show.night) continue;
    for (const q of old.performances) {
      if (q.comedianId === p.comedianId || q.simulated) continue;
      const shared = [...grams(q.text, 5)].filter(g => mine.has(g));
      if (shared.length >= 2) return { victim: q.comedianId, phrase: shared[0], show: old, title: q.title };
    }
  }
  return null;
}

// ---------------------------------------------------------------------
// one show
// ---------------------------------------------------------------------

export function isShowRunning() {
  if (station) return ['booking', 'rehearsing', 'judging', 'crowd'].includes(store.getCircuitSnapshot().live.phase);
  return flags.running;
}

export async function runShow(settings: AISettings): Promise<Show | null> {
  if (station) { await station.cmd('runShow'); return null; }
  if (flags.running) return null;
  flags.running = true;
  try {
    const st = await ensureCircuit();
    await refreshComics();
    st.world = syncWorld(st.world, [...comics.values()], st.clubs, id => comedianSeed({ id }));
    if (active(st).length < MIN_ACTIVE) await growPopulation(st, settings, MIN_ACTIVE - active(st).length);

    // A show interrupted by a reload picks up where it stopped.
    let pending = st.pending && !st.pending.show.endedAt && st.pending.show.lineup.every(id => comics.has(id)) ? st.pending : null;
    if (!pending) {
      const plan = nextPlan(st);
      const seed0 = (st.seed ^ Math.imul(plan.night, 2654435761)) >>> 0;
      const r0 = rng(seed0);
      const theme = THEMES[Math.floor(r0() * THEMES.length)];
      const lineup = book(st, plan.format, r0);
      if (lineup.length < 2) { store.patchLive({ phase: 'waiting', note: 'Not enough comedians on the Circuit yet.' }); return null; }
      pending = {
        show: {
          id: uid('show'), night: plan.night, clubId: plan.club.id, format: plan.format, theme, lineup, performances: [], winnerId: null,
          headline: `${FORMAT_LABEL[plan.format]} at ${plan.club.name}`, startedAt: Date.now(), endedAt: null, seed: seed0
        },
        offline: getEngines().nightshift.state !== 'online',
        jobs: {},
        room: openRoom(plan.club, plan.format, lineup.length, theme, rng(seed0 ^ 0x2545f491), st.lore || [])
      };
      st.pending = pending;
      await commit();
    }
    const show = pending.show;
    const { night, format, lineup, theme } = show;
    const club = st.clubs.find(c => c.id === show.clubId) || st.clubs[0];
    const offlineShow = pending.offline;
    const r = rng(show.seed ^ 0x9e3779b9);
    ensurePresence(st);
    // A show from before the Room opens one now.
    const room: RoomState = (pending.room ||= openRoom(club, format, lineup.length, theme, rng(show.seed ^ 0x2545f491), st.lore || []));
    store.patchLive({ show: { ...show }, phase: 'booking', current: -1, streaming: '', drafts: null, note: `${FORMAT_LABEL[format]} at ${club.name} · theme: ${theme}` });
    await sleep(1200);

    // Rehearse + perform, one comedian at a time.
    for (let i = 0; i < lineup.length; i++) {
      const id = lineup[i];
      if (show.performances.some(p => p.comedianId === id)) continue;     // already performed before the reload
      const c = comics.get(id)!;
      const s = st.stats[id];
      const opp = format === 'roast_battle' ? comics.get(lineup[1 - i]) : undefined;
      expectBefore(s, show, club, c.style);
      store.patchLive({ phase: 'rehearsing', current: i, streaming: '', drafts: null, room: { ...room }, note: `${c.name} is ${st.rehearsals > 1 ? 'rehearsing backstage' : 'writing'}…` });
      const jobs = pending.jobs;
      const opts: WriteOpts = {
        offlineShow, jobId: jobs[id], onJob: (jobId) => { jobs[id] = jobId; void commit(); },
        room: roomBrief(room, s.presence, i, lineup.length, st.lore || [], nameOf, format)
      };
      let w: { title: string; text: string; drafts: number; simulated: boolean };
      try { w = await writeSet(st, c, s, show, club, settings, opp, opts); }
      catch {
        // One calm retry with a single chat draft before the material bank.
        try { w = offlineShow ? simulateSet(c, show, opp) : await writeSet({ ...st, rehearsals: 1 }, c, s, show, club, settings, opp); }
        catch { w = simulateSet(c, show, opp); }
      }
      // The stage directions come off the page; the room hears the set.
      const d = parseDelivery(w.text);
      const heard = hear(room, { comedianId: id, title: w.title, text: d.text || w.text, beats: d.beats, simulated: w.simulated }, s.presence, s.skills, i, rng(show.seed ^ Math.imul(i + 1, 0x51ed27)), st.lore || [], nameOf);
      if (heard.headline) event('room', heard.headline, [id], { showId: show.id });
      show.performances.push({
        comedianId: id, title: w.title, text: d.text || w.text, target: opp?.id, cards: [], judgeMean: 0, crowd: 0, laughs: 0, moments: [],
        final: 0, rank: 0, eloBefore: s.elo, eloAfter: s.elo, rehearsed: w.drafts, simulated: w.simulated, stage: heard.stage
      });
      await commit();                                                      // the set is safe even if the page goes away
      store.patchLive({ show: { ...show, performances: [...show.performances] }, streaming: w.text });
    }

    // The panel.
    store.patchLive({ phase: 'judging', current: -1, drafts: null, streaming: '', note: 'The panel is scoring…' });
    const simulated = show.performances.every(p => p.simulated);
    let cards: JudgeCard[][];
    try { cards = simulated ? show.performances.map(p => fallbackCards(st.stats[p.comedianId], r)) : await judgePanel(show, settings, r); }
    catch { cards = show.performances.map(p => fallbackCards(st.stats[p.comedianId], r)); }
    show.performances.forEach((p, i) => { p.cards = cards[i]; p.judgeMean = round1(cards[i].reduce((a, c) => a + c.score, 0) / cards[i].length); });

    // The room.
    store.patchLive({ phase: 'crowd', note: 'Reading the room…', show: { ...show } });
    for (const p of show.performances) { Object.assign(p, crowd(p, st.stats[p.comedianId], comics.get(p.comedianId), club, format, r)); workedTheRoom(p, format); }
    const ranked = [...show.performances].sort((a, b) => b.final - a.final);
    ranked.forEach((p, i) => { p.rank = i + 1; });
    applyElo(show.performances);
    const winner = ranked[0];
    show.winnerId = winner.comedianId;
    show.endedAt = Date.now();

    settle(st, show, club, ranked);
    settleRoom(st, show, club);
    applyMind(st, afterShowMind(st, show, ranked, nameOf, club.name));
    for (const exchange of settleBackstage(st, show, nameOf)) {
      event(exchange.kind === 'mentoring' ? 'study' : 'mind', exchange.text, exchange.actors, { showId: show.id, night: show.night });
    }
    st.night = night;
    st.pending = null;
    recent = [show, ...recent].slice(0, 60);
    show.headline = template(show, club, ranked);
    await store.writeShow(show);
    await commit();
    store.patchLive({ phase: 'results', show: { ...show }, note: `${nameOf(winner.comedianId)} wins ${FORMAT_LABEL[format]} at ${club.name}` });

    // After the lights come up: nothing below holds the next show.
    void afterShow(st, show, club, settings);
    return show;
  } finally {
    flags.running = false;
  }
}

function settle(st: CircuitState, show: Show, club: Club, ranked: Performance[]) {
  const winner = ranked[0];
  for (const p of show.performances) {
    const s = st.stats[p.comedianId];
    const stageBefore = s.stage;
    s.elo = p.eloAfter;
    s.eloHistory = [...s.eloHistory, s.elo].slice(-30);
    s.shows += 1;
    s.lastShowNight = show.night;
    s.bestScore = Math.max(s.bestScore, p.final);
    s.fans = Math.max(0, Math.round(s.fans + (p.final - 5) * 14 * club.prestige + p.laughs));
    const won = p === winner;
    s.streak = won ? Math.max(1, s.streak + 1) : Math.min(-1, s.streak - 1);
    if (won) { s.wins += 1; s.clubWins[club.id] = (s.clubWins[club.id] || 0) + 1; }
    if (p.final < 3.8) { s.bombs += 1; event('bomb', `${nameOf(p.comedianId)} bombed at ${club.name} with ${p.final.toFixed(1)}. ${p.cards[2]?.line || ''}`.trim(), [p.comedianId], { showId: show.id }); }
    if (p.moments.includes('applause break')) event('applause', `${nameOf(p.comedianId)} got an applause break at ${club.name} with “${p.title}”.`, [p.comedianId], { showId: show.id });
    if (won && [3, 5, 8, 12].includes(s.streak)) event('streak', `${nameOf(p.comedianId)} is on a ${s.streak}-show streak.`, [p.comedianId], { showId: show.id });
    s.stage = STAGES[Math.max(STAGES.indexOf(stageBefore), STAGES.indexOf(stageFor(s)))];
    if (s.stage !== stageBefore) event('promotion', `${nameOf(p.comedianId)} is now a ${STAGE_LABEL[s.stage]}.`, [p.comedianId], { showId: show.id });
  }

  // Win, upset, title.
  const others = show.performances.filter(p => p !== winner);
  const favorite = Math.max(...others.map(p => p.eloBefore));
  if (winner.eloBefore < favorite - 90) event('upset', `Upset at ${club.name}: ${nameOf(winner.comedianId)} (${winner.eloBefore}) beat the favorite.`, show.performances.map(p => p.comedianId), { showId: show.id });
  else event('win', `${nameOf(winner.comedianId)} won ${FORMAT_LABEL[show.format]} at ${club.name} with “${winner.title}” (${winner.final.toFixed(1)}).`, [winner.comedianId], { showId: show.id });
  if (show.format === 'championship') {
    st.stats[winner.comedianId].titles += 1;
    st.champion = winner.comedianId;
    event('title', `${nameOf(winner.comedianId)} is the Circuit Champion.`, [winner.comedianId], { showId: show.id });
  }
  const best = active(st).map(s => [s.comedianId, s.clubWins[club.id] || 0] as const).sort((a, b) => b[1] - a[1])[0];
  if (best && best[1] > 0) st.clubs = st.clubs.map(c => (c.id === club.id ? { ...c, champion: best[0] } : c));

  // Rivalries: close finishes and roast battles heat things up.
  st.rivalries.forEach(v => { v.heat = round1(v.heat * 0.97); });
  for (let i = 0; i < show.performances.length; i++) for (let j = i + 1; j < show.performances.length; j++) {
    const a = show.performances[i], b = show.performances[j];
    const v = rivalry(st, a.comedianId, b.comedianId);
    const before = v.heat;
    v.meetings += 1;
    v.lastNight = show.night;
    const aWon = a.final > b.final;
    if ((aWon ? a.comedianId : b.comedianId) === v.a) v.aWins += 1; else v.bWins += 1;
    if (Math.abs(a.final - b.final) < 0.7) v.heat += 1;
    if (show.format === 'roast_battle') v.heat += 2;
    if (before < 5 && v.heat >= 5) event('rivalry', `Rivalry: ${nameOf(v.a)} vs ${nameOf(v.b)}, ${v.aWins} to ${v.bWins} head to head.`, [v.a, v.b], { showId: show.id });
  }

  // Joke theft: evidence from the texts themselves.
  for (const p of show.performances) {
    if (p.simulated) continue;
    const t = findTheft(p, show);
    if (!t) continue;
    const v = rivalry(st, p.comedianId, t.victim);
    v.heat += 3;
    st.stats[p.comedianId].fans = Math.round(st.stats[p.comedianId].fans * 0.92);
    event('theft', `${nameOf(t.victim)} accuses ${nameOf(p.comedianId)} of lifting “${t.title}”. The evidence: “…${t.phrase}…”`, [p.comedianId, t.victim], {
      showId: show.id, evidence: { a: p.text, b: t.show.performances.find(q => q.comedianId === t.victim)?.text || '', showA: show.id, showB: t.show.id }
    });
  }
}

function template(show: Show, club: Club, ranked: Performance[]) {
  const w = ranked[0], second = ranked[1];
  const margin = second ? w.final - second.final : 0;
  if (show.format === 'championship') return `${nameOf(w.comedianId)} takes the Circuit crown at ${club.name}`;
  if (show.format === 'roast_battle') return `${nameOf(w.comedianId)} roasts ${nameOf(second?.comedianId || '')} ${margin > 1.5 ? 'into ash' : 'by a hair'} at ${club.name}`;
  if (margin < 0.4) return `Photo finish at ${club.name}: ${nameOf(w.comedianId)} edges ${nameOf(second?.comedianId || '')}`;
  return `${nameOf(w.comedianId)} owns ${club.name} with “${w.title}”`;
}

// ---------------------------------------------------------------------
// the Room: stage presence, working the room, mastery, lore
// ---------------------------------------------------------------------

function hashId(id: string) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Every comic on the Circuit gets a stage presence — founders and old saves included. */
function ensurePresence(st: CircuitState) {
  const usage = presenceUsage(Object.values(st.stats).map(s => s.presence));
  for (const s of Object.values(st.stats)) {
    if (s.presence) continue;
    const c = comics.get(s.comedianId);
    if (!c) continue;
    const from: StagePresence | undefined = s.museId ? st.stats[s.museId]?.presence : undefined;
    const kind = s.lens === 'mirror' || s.lens === 'disciple' || s.lens === 'complement' ? 'inherit' as const
      : s.lens === 'counter' || s.lens === 'antagonist' ? 'oppose' as const : null;
    s.presence = makePresence({ style: c.style, voice: c.voice, skills: s.skills, relation: from && kind ? { kind, from } : undefined }, rng((st.seed ^ hashId(s.comedianId)) >>> 0), usage);
    for (const m of s.presence.masters) usage.masters[m] = (usage.masters[m] || 0) + 1;
    usage.personas[s.presence.persona] = (usage.personas[s.presence.persona] || 0) + 1;
  }
}

/** The room's verdict on top of the crowd: working it well (or not) moves the laugh. */
function workedTheRoom(p: Performance, format: ShowFormat) {
  if (!p.stage || p.simulated) return;
  const lift = p.stage.lift || 0;
  if (lift) {
    p.crowd = round1(clamp(p.crowd + lift));
    p.laughs = Math.max(0, p.laughs + Math.round(lift * 2.6));
    const weight = format === 'roast_battle' ? 0.5 : 0.6;
    p.final = round1(p.judgeMean * weight + p.crowd * (1 - weight));
    if (p.crowd >= 8.8 && !p.moments.includes('applause break')) p.moments.push('applause break');
  }
  for (const n of (p.stage.notes || []).slice(0, 2)) if (!p.moments.includes(n)) p.moments.push(n);
}

/** After the lights: techniques practiced, famous bits become lore, homework handed out. */
function settleRoom(st: CircuitState, show: Show, club: Club) {
  const r = rng(show.seed ^ 0x7f4a7c15);
  st.lore = (st.lore || []).map(l => ({ ...l, heat: round1(l.heat * 0.98) }));
  for (const p of show.performances) {
    const s = st.stats[p.comedianId];
    const pr = s?.presence;
    if (p.simulated || !pr || !p.stage) continue;
    for (const c of practice(pr, p.stage, p.final)) {
      const teacher = pr.masters.map(k => masterByKey(k)).find(m => m?.craft.includes(c));
      event('study', `${nameOf(p.comedianId)} has mastered ${CRAFT[c].name}${teacher ? `, the move they studied watching ${teacher.name}` : ''}.`, [p.comedianId], { showId: show.id });
    }
    if (p.moments.includes('applause break') || p.final >= 8.6) {
      pr.hits = [{ title: p.title, night: show.night }, ...pr.hits].slice(0, 6);
      const id = `lore_${show.id}_${p.comedianId}`;
      st.lore = [{ id, comedianId: p.comedianId, title: p.title, night: show.night, clubId: club.id, heat: p.final }, ...st.lore.filter(l => l.id !== id)].slice(0, 30);
    }
    // Homework after a rough night, and now and then anyway.
    if (p.final < 6 || (!pr.lesson && r() < 0.3)) {
      const lesson = chooseLesson(pr, p.stage, p.final, r, show.night);
      if (lesson && lesson.craft !== pr.lesson?.craft) {
        pr.lesson = lesson;
        journal(s, show.night, `Homework: watch ${masterByKey(lesson.master)?.name} for ${CRAFT[lesson.craft].name}. ${lesson.text}`);
      }
    }
  }
}

/** Nightshift turns tonight's homework into a notebook entry in the comic's own voice. */
async function studyNotes(st: CircuitState, show: Show, settings: AISettings) {
  if (getEngines().nightshift.state !== 'online') return;
  const p = [...show.performances].sort((a, b) => a.final - b.final).find(x => !x.simulated && st.stats[x.comedianId]?.presence?.lesson?.night === show.night);
  const s = p && st.stats[p.comedianId];
  const c = p && comics.get(p.comedianId);
  const lesson = s?.presence?.lesson;
  if (!p || !s || !c || !lesson) return;
  const master = masterByKey(lesson.master);
  const craft = CRAFT[lesson.craft];
  const club = st.clubs.find(x => x.id === show.clubId);
  try {
    const text = (await backgroundText(`Circuit · ${c.name} studies ${master?.name}`, () => chat({
      task: 'copy', quality: settings.quality === 'local' ? 'local' : 'auto', maxTokens: 1600, temperature: 0.8,
      prompt: `You are ${c.name}, a stand-up comic (${c.voice}). Tonight at ${club?.name} you scored ${p.final.toFixed(1)}${p.stage?.notes?.length ? ` — ${p.stage.notes.join('; ')}` : ''}. Afterwards you rewatched ${master?.name} (${master?.presence}) to study ${craft.name}: ${craft.what}\nWrite ONE or TWO sentences for your private notebook: exactly what you noticed about how ${master?.name} uses it — timing, silence, the mic, the stage — and how you will use it in your own act. Craft only; never quote their jokes. No quotes, no hashtags.`
    }), { comedianId: c.id })).text.trim().split('\n')[0].replace(/^["'\s]+|["'\s]+$/g, '').slice(0, 280);
    if (!text || s.presence?.lesson !== lesson) return;
    lesson.text = text;
    journal(s, show.night, text);
    await commit();
  } catch { /* the drill stands */ }
}

// ---------------------------------------------------------------------
// after the show: circuit sets, production, gossip, lineage
// ---------------------------------------------------------------------

async function afterShow(st: CircuitState, show: Show, club: Club, settings: AISettings) {
  try { await appendCircuitBits(st, show, club); } catch (e) { console.warn('circuit bits', e); }
  await commit();

  // The night's winner gets produced: a still from ComfyUI (or Nightshift).
  const win = show.performances.find(p => p.comedianId === show.winnerId);
  const c = win && comics.get(win.comedianId);
  if (win && c && !win.simulated) {
    stillsInFlight.add(show.id);
    renderStill(
      `Photo of ${c.look || c.name}, a stand-up comedian on stage at ${club.name}, delivering "${win.title}", the crowd roaring with laughter. ${canonFor(c.id, club.id)}`,
      { ...settings, venue: club.venue }, { label: `Circuit · ${c.name} at ${club.name}`, itemKey: `circuit:${show.id}`, seed: comedianSeed(c), ref: { comedianId: c.id } }
    ).then(async (url) => {
      win.imageUrl = url;
      setAnchor(st.world, 'place', club.id, url);
      noteAppearance(st.world, c.id, club.id);
      await store.writeShow(show);
      if (win.bitId != null && st.stats[c.id].circuitSetId) {
        const set = await repo().getSet(st.stats[c.id].circuitSetId!);
        if (set) { set.bits = set.bits.map(b => (b.id === win.bitId ? { ...b, imageUrl: url } : b)); await repo().saveSet(set); }
      }
      publishShow(show);
      // …and only a set that really landed goes to the Reel to be shot as video.
      stillsInFlight.delete(show.id);
      reelShow(st, show, settings);
    }).catch(() => { stillsInFlight.delete(show.id); /* no camera on this box right now */ });
  }
  reelShow(st, show, settings);

  // A real headline from Nightshift, when it has a moment.
  if (getEngines().nightshift.state === 'online' && !win?.simulated) {
    backgroundText('Circuit · the Grapevine', async () => {
      const text = (await chat({
        task: 'copy', quality: settings.quality === 'local' ? 'local' : 'auto', maxTokens: 1200, temperature: 0.9,
        prompt: `Write ONE punchy comedy-blog headline (max 14 words, no quotes, no hashtags) about tonight: ${show.headline}. Winner's bit: "${win?.title}". Best judge line: "${[...(win?.cards || [])].sort((a, b) => b.score - a.score)[0]?.line || ''}".`
      })).text.split('\n')[0].replace(/^["'\s]+|["'\s]+$/g, '').slice(0, 140);
      if (text) { show.headline = text; await store.writeShow(show); publishShow(show); }
    }).catch(() => { /* the template headline stands */ });
  }

  try { await lineageTick(st, show, settings); await commit(); } catch (e) { console.warn('lineage', e); }
  void studyNotes(st, show, settings);
  void readEssence(st, settings);
  try { await produceSpecials(st, settings); } catch (e) { console.warn('specials', e); }
  backfillReel(st, settings);
  // The top of the top gets a Standupify Original: legends, champions, titleholders.
  const candidates = active(st).sort((a, b) => b.elo - a.elo).map(s => ({
    comedianId: s.comedianId, legend: s.stage === 'legend', champion: st.champion === s.comedianId, titles: s.titles, specials: (s.specials || []).length,
    pitched: !!s.inner?.pitched && (s.stage === 'headliner' || s.stage === 'legend')
  }));
  considerOriginals(candidates, settings).catch(e => console.warn('originals', e));
}

// ---------------------------------------------------------------------
// the Reel — only the best get animated, best first, one clip at a time
// ---------------------------------------------------------------------

const BIT_CLIP_SCORE = 8;          // a club set this good gets shot as video
const REEL_MAX = 24;
interface ReelJob { key: string; score: number; label: string; run: () => Promise<void> }
const reel: { busy: boolean; queue: ReelJob[]; done: string[] } = (G.__standupifyReel ||= { busy: false, queue: [], done: [] });
const stillsInFlight = new Set<string>();
// ComfyUI coming online starts the Reel on whatever is waiting.
if (!G.__standupifyReelWatch) {
  G.__standupifyReelWatch = true;
  subscribeEngines(() => { if (getEngines().comfy.state === 'online' && reel.queue.length && !reel.busy) void rollReel(); });
}

/** Which angles a set earns: the better it was, the more angles. */
function anglesFor(score: number, first: string): string[] {
  const more = ['dolly-in', 'orbit', 'handheld', 'crash-zoom'].filter(m => m !== first);
  return [first, ...more.slice(0, score >= 9 ? 2 : score >= BIT_CLIP_SCORE ? 1 : 0)];
}

function toReel(job: ReelJob) {
  if (reel.done.includes(job.key) || reel.queue.some(j => j.key === job.key)) return;
  reel.queue = [...reel.queue, job].sort((a, b) => b.score - a.score).slice(0, REEL_MAX);
  void rollReel();
}

async function rollReel() {
  if (reel.busy) return;
  reel.busy = true;
  try {
    while (reel.queue.length && getEngines().comfy.state === 'online' && !originalsHoldCamera()) {
      const job = reel.queue.shift()!;
      reel.done = [...reel.done, job.key].slice(-600);
      try { await job.run(); } catch (e) { console.warn('reel', job.label, describeError(e)); }
    }
  } finally { reel.busy = false; }
}

/** The best sets of a night: a still (if missing), then every angle they earned. */
function reelShow(st: CircuitState, show: Show, settings: AISettings) {
  const club = st.clubs.find(c => c.id === show.clubId);
  for (const p of show.performances) {
    const champ = show.format === 'championship' && p.comedianId === show.winnerId;
    if (p.simulated || (p.final < BIT_CLIP_SCORE && !champ) || !club) continue;
    if (p.comedianId === show.winnerId && stillsInFlight.has(show.id)) continue;   // the winner's still is on its way; it calls back
    const angles = anglesFor(Math.max(p.final, champ ? 9 : 0), HIGHLIGHT_MOVE[show.format]);
    angles.forEach((move, i) => toReel({
      key: `perf:${show.id}:${p.comedianId}:${move}`, score: p.final - i * 0.6 + (champ ? 1 : 0), label: `${nameOf(p.comedianId)} · ${move}`,
      run: () => shootPerformance(st, show, p, club, move, settings)
    }));
  }
}

async function shootPerformance(st: CircuitState, show: Show, p: Performance, club: Club, move: string, settings: AISettings) {
  const c = comics.get(p.comedianId);
  if (!c || p.clips?.some(x => x.move === move)) return;
  if (!p.imageUrl) {
    p.imageUrl = await renderStill(
      `Photo of ${c.look || c.name}, a stand-up comedian on stage at ${club.name}, delivering "${p.title}", the crowd laughing. ${canonFor(c.id, club.id)}`,
      { ...settings, venue: club.venue }, { label: `Reel · ${c.name} at ${club.name}`, itemKey: `circuit:${show.id}:${c.id}`, seed: comedianSeed(c), ref: { comedianId: c.id } });
    await store.writeShow(show);
  }
  const bit: Bit = { id: p.bitId ?? Date.now(), title: p.title, description: p.text, visualPrompt: `delivering "${p.title}" at ${club.name}`, imageUrl: p.imageUrl };
  const url = await animateBit(c, bit, move, settings);
  const clip: Angle = { url, move };
  p.clips = [...(p.clips || []), clip];
  p.videoUrl ||= url;
  await store.writeShow(show);
  const setId = st.stats[c.id]?.circuitSetId;
  if (p.bitId != null && setId) {
    const set = await repo().getSet(setId);
    if (set) {
      set.bits = set.bits.map(b => (b.id === p.bitId ? { ...b, imageUrl: b.imageUrl || p.imageUrl, videoUrl: b.videoUrl || url, videoStatus: 'completed' as const, cameraMove: b.cameraMove || move, clips: [...(b.clips || []), clip] } : b));
      await repo().saveSet(set);
    }
  }
  publishShow(show);
}

/** A special is shot bit by bit: every bit one angle, the closer two. Specials go first. */
function reelSpecial(c: Comedian, special: ComedySet, settings: AISettings) {
  const moves = ['dolly-in', 'orbit', 'handheld', 'crash-zoom'];
  special.bits.forEach((b, i) => {
    const closer = i === special.bits.length - 1;
    const angles = closer ? ['dolly-in', 'crane-up'] : [moves[i % moves.length]];
    angles.forEach((move, k) => toReel({
      key: `special:${special.id}:${b.id}:${move}`, score: 20 + (b.laughScore ?? 7) - i * 0.05 - k * 0.5, label: `${special.title} · ${b.title}`,
      run: () => shootSpecialBit(c, special.id, b.id, move, settings)
    }));
  });
}

async function shootSpecialBit(c: Comedian, specialId: string, bitId: number, move: string, settings: AISettings) {
  let set = await repo().getSet(specialId);
  let b = set?.bits.find(x => x.id === bitId);
  if (!set || !b || b.clips?.some(x => x.move === move)) return;
  if (!b.imageUrl) {
    const url = await renderStill(`Photo of ${c.look || c.name}, a stand-up comedian performing their special on a theater stage, ${b.visualPrompt || 'mid-punchline'}, dramatic spotlight, crowd silhouettes. ${canonFor(c.id)}`,
      { ...settings, venue: c.venue || settings.venue },
      { label: `Special · ${set.title}`, itemKey: `special:${set.id}:${b.id}`, seed: comedianSeed(c), ref: { comedianId: c.id, bitId: b.id } });
    set = (await repo().getSet(specialId))!;
    set.bits = set.bits.map(x => (x.id === bitId ? { ...x, imageUrl: url } : x));
    await repo().saveSet(set);
    b = set.bits.find(x => x.id === bitId)!;
  }
  const url = await animateBit(c, b, move, settings);
  const fresh = await repo().getSet(specialId);
  if (!fresh) return;
  fresh.bits = fresh.bits.map(x => (x.id === bitId ? { ...x, videoUrl: x.videoUrl || url, videoStatus: 'completed' as const, cameraMove: x.cameraMove || move, clips: [...(x.clips || []), { url, move }] } : x));
  fresh.updatedAt = Date.now();
  await repo().saveSet(fresh);
  store.publishCircuit({ state: state ? { ...state } : null });
}

/** After a reload (or a ComfyUI restart), pick up whatever the best still need. */
function backfillReel(st: CircuitState, settings: AISettings) {
  for (const show of recent.slice(0, 12)) if (show.endedAt) reelShow(st, show, settings);
  (async () => {
    for (const s of active(st)) {
      const c = comics.get(s.comedianId);
      if (!c) continue;
      for (const id of s.specials || []) {
        const set = await repo().getSet(id);
        if (set) reelSpecial(c, set, settings);
      }
    }
  })().catch(() => { /* the next show tries again */ });
}

// Originals report to the Grapevine and share the camera with the Reel.
connectCircuit({
  news: (text, actors) => { event('special', text, actors); void commit(); },
  reel: { kick: () => { if (reel.queue.length && !reel.busy) void rollReel(); }, busy: () => reel.busy || reel.queue.length > 0 },
  world: {
    canon: (comedianId, theater) => canonBlock(state?.world, { characters: [comedianId], place: theater ? findTheater(state?.world, theater.theater, theater.city) : null }),
    essence: (comedianId) => state?.world?.characters[comedianId]?.canon.source === 'vision' ? state.world.characters[comedianId].canon.essence : null,
    anchor: (comedianId) => state?.world?.characters[comedianId]?.anchor || null,
    theater: (bible, anchor) => { if (state) { state.world ||= syncWorld(undefined, [], [], id => comedianSeed({ id })); registerTheater(state.world, bible, anchor); void commit(); } }
  }
});

// ---------------------------------------------------------------------
// the world model and the inner life (world/model.ts, inner.ts)
// ---------------------------------------------------------------------

/** The canon a render of this comic (at this club) must follow. */
function canonFor(comedianId: string, clubId?: string): string {
  return canonBlock(state?.world, { characters: [comedianId], placeId: clubId });
}

/** Carry out what the comics decided to do on their own. */
function applyMind(st: CircuitState, acts: InnerAction[]) {
  for (const a of acts) {
    event('mind', a.text, a.kind === 'callout' ? [a.comedianId, a.target] : [a.comedianId]);
    if (a.kind === 'workshop') {
      const c = comics.get(a.comedianId);
      if (!c || c.profile.material.some(m => m.name === a.material.name)) continue;
      c.profile.material = [{ id: uid('mat'), ...a.material }, ...c.profile.material].slice(0, 24);
      void repo().saveComedian(c).catch(() => { /* next workshop */ });
    }
  }
  void st;
}

/** One comic per show: read their real face off their headshot and lock it into the canon. */
let readingEssence = false;
async function readEssence(st: CircuitState, settings: AISettings) {
  if (readingEssence || vision.broken || getEngines().nightshift.state !== 'online') return;
  const ch = needsEssence(st.world)[0];
  if (!ch?.anchor || getEngines().nightshift.classes?.vision?.availability === 'unavailable') return;
  readingEssence = true;
  ch.essenceTries = (ch.essenceTries || 0) + 1;
  try {
    const image = await blobToDataUrl(await mediaBlob(ch.anchor));
    const read = await backgroundText(`World · reading ${ch.name}'s face`, () => chatJson<{ essence?: string; face?: string; hair?: string; skin?: string; build?: string; wardrobe?: string; signature?: string }>({
      task: 'cast', quality: settings.quality, maxTokens: 4000, images: [image],   // a thinking vision model reasons first
      system: 'You are a continuity supervisor for a film. Output ONLY valid JSON.', prompt: ESSENCE_PROMPT
    }), { comedianId: ch.id });
    if (read?.essence && read.essence.length > 40 && st.world) {
      lockEssence(st.world, ch.id, { essence: read.essence.slice(0, 420), face: read.face, hair: read.hair, skin: read.skin, build: read.build, wardrobe: read.wardrobe, signature: read.signature });
      await commit();
    }
  } catch (e) { if (noteVisionError(e)) console.warn(`[world] ${vision.why}; faces stay as written until it is fixed.`); } finally { readingEssence = false; }
}

/** The Reel, for the UI: what is being shot and what is waiting. */
export function reelStatus() { return { busy: reel.busy, waiting: reel.queue.length, next: reel.queue.slice(0, 3).map(j => j.label) }; }

const HIGHLIGHT_MOVE: Record<ShowFormat, string> = {
  open_mic: 'handheld', showcase: 'orbit', roast_battle: 'crash-zoom', headliner: 'dolly-in', championship: 'crane-up'
};

function publishShow(show: Show) {
  recent = recent.map(x => (x.id === show.id ? show : x));
  store.publishCircuit({ shows: [...recent] });
  if (store.getCircuitSnapshot().live.show?.id === show.id) store.patchLive({ show: { ...show } });
}

async function appendCircuitBits(st: CircuitState, show: Show, club: Club) {
  for (const [i, p] of show.performances.entries()) {
    const s = st.stats[p.comedianId];
    let set: ComedySet | undefined = s.circuitSetId ? await repo().getSet(s.circuitSetId) : undefined;
    if (!set) {
      set = {
        id: uid('set'), comedianId: p.comedianId, title: 'Live on the Circuit', logline: 'Every set they have performed on the Circuit.',
        status: 'ready', bits: [], clipIds: [], promoIds: [], publishedUrls: [], analytics: {}, generatedBy: 'autopilot',
        createdAt: Date.now(), updatedAt: Date.now()
      };
      s.circuitSetId = set.id;
    }
    const bit: Bit = {
      id: Date.now() + i, title: p.title, description: p.text,
      visualPrompt: `performing at ${club.name}, ${club.crowd} laughing`,
      laughScore: p.final, laughNote: [...p.cards].sort((a, b) => b.score - a.score)[0]?.line, imageUrl: p.imageUrl
    };
    p.bitId = bit.id;
    set.bits = [...set.bits, bit].slice(-40);
    set.updatedAt = Date.now();
    await repo().saveSet(set);
  }
  await store.writeShow(show);
}

// ---------------------------------------------------------------------
// specials — a career milestone the Circuit produces on its own
// ---------------------------------------------------------------------

const SPECIAL_MIN_BITS = 4;
const SPECIAL_MIN_SCORE = 7;

/** A comic with a bank of strong, unused Circuit sets gets a special: curated, titled, shot. */
async function produceSpecials(st: CircuitState, settings: AISettings) {
  if (getEngines().nightshift.state !== 'online') return;
  // Only the top of the bill gets a special: headliners, legends, and the top three on the board.
  const top3 = new Set(active(st).sort((a, b) => b.elo - a.elo).slice(0, 3).map(s => s.comedianId));
  const stars = active(st).filter(s => s.stage === 'headliner' || s.stage === 'legend' || (top3.has(s.comedianId) && s.stage !== 'open_mic'))
    .sort((a, b) => b.elo - a.elo);
  for (const s of stars) {
    if (!s.circuitSetId) continue;
    const c = comics.get(s.comedianId);
    const source = await repo().getSet(s.circuitSetId);
    if (!c || !source) continue;
    const used = new Set(s.specialBitIds || []);
    const strong = source.bits.filter(b => !used.has(b.id) && (b.laughScore ?? 0) >= SPECIAL_MIN_SCORE);
    if (strong.length < SPECIAL_MIN_BITS) continue;

    // Nightshift curates: a title, a logline and a running order.
    const pick = strong.sort((a, b) => (b.laughScore ?? 0) - (a.laughScore ?? 0)).slice(0, 6);
    let plan: { title?: string; logline?: string; order?: number[] } = {};
    try {
      plan = await backgroundText(`Circuit · ${c.name} cuts a special`, () => chatJson({
        task: 'copy', quality: settings.quality, maxTokens: 2400, onDelta: () => { /* streamed */ },
        system: 'You are a comedy special producer. Output ONLY valid JSON.',
        prompt: `Comedian ${c.name} — "${c.tagline}" (${c.style}). Their best club sets:\n${pick.map((b, i) => `${i + 1}. "${b.title}": ${b.description}`).join('\n')}\n\nTitle their comedy special (2–5 words, memorable, in their voice), write a one-sentence logline, and choose the running order: open strong, build, close on the biggest laugh.\nReturn ONLY JSON: { "title": "...", "logline": "...", "order": [numbers from the list above] }`
      }), { comedianId: c.id });
    } catch { /* a sensible default below */ }
    const order = (plan.order || []).map(n => pick[Number(n) - 1]).filter(Boolean);
    const bits = [...new Set([...order, ...pick])].map((b, i) => ({ ...b, id: Date.now() + i }));
    const now = Date.now();
    const special: ComedySet = {
      id: uid('set'), comedianId: c.id,
      title: (plan.title || `${c.name}: Live on the Circuit`).replace(/^["']|["']$/g, '').slice(0, 60),
      logline: plan.logline || `${c.name}'s best sets from the Circuit, back to back.`,
      status: 'ready', bits, clipIds: [], promoIds: [], publishedUrls: [], analytics: {},
      generatedBy: 'autopilot', createdAt: now, updatedAt: now
    };
    await repo().saveSet(special);
    s.specials = [...(s.specials || []), special.id];
    s.specialBitIds = [...used, ...pick.map(b => b.id)];
    s.fans = Math.round(s.fans * 1.15 + 200);
    event('special', `${c.name} drops a new special: “${special.title}”. ${special.logline}`, [c.id]);
    await commit();

    // Production: the whole special goes to the front of the Reel — stills, then video, bit by bit.
    reelSpecial(c, special, settings);
    return;   // one special per show keeps the engine calm
  }
}

/** Apprentices, retirements, debuts — the population moves on its own. */
async function lineageTick(st: CircuitState, show: Show, settings: AISettings) {
  const r = rng(show.seed ^ 0x5bd1e995);
  for (const s of active(st)) {
    if (s.shows >= 18 && s.elo < 960) {
      s.life = 'retired';
      event('retirement', `${nameOf(s.comedianId)} hangs up the mic after ${s.shows} shows.`, [s.comedianId]);
    }
  }

  // Eras: the style that keeps winning becomes the age everyone is born into.
  st.era ||= emptyEra();
  const turned = advanceEra(st.era, readTheRoom(st, recent, id => comics.get(id)?.style), show.night);
  if (turned) event('era', `A new era on the Circuit: ${turned.name}. ${STYLE_LABEL[turned.doctrine] || turned.doctrine} comics are winning, and every newcomer is drilled in ${turned.school}.`, []);

  // Aims (the Ascent): settle tonight's, hand out new ones.
  for (const s of active(st)) {
    if (s.aim) {
      const verdict = judgeAim(s.aim, s, st);
      if (verdict === 'won') {
        s.aimsWon = (s.aimsWon || 0) + 1;
        s.fans = Math.round(s.fans * 1.04 + 25);
        journal(s, show.night, `Did it: ${s.aim.text}.`);
        event('aim', `${nameOf(s.comedianId)} set out to ${s.aim.text}, and did it.`, [s.comedianId, ...(s.aim.target ? [s.aim.target] : [])], { showId: show.id });
        s.aim = null;
      } else if (verdict === 'lost' || show.night - s.aim.since > 14) {
        journal(s, show.night, `Letting go of "${s.aim.text}". There will be other nights.`);
        s.aim = null;
      }
    }
    if (!s.aim) {
      s.aim = chooseAim(s, st, r, nameOf, show.night);
      journal(s, show.night, `New goal: ${s.aim.text}.`);
    }
  }

  // Arrivals. A runaway leader draws challengers; a new era draws its children.
  const count = active(st).length;
  const board = active(st).sort((a, b) => b.elo - a.elo);
  const runaway = board[1] ? board[0].elo - board[1].elo > 110 : false;
  const mentors = active(st).filter(s => (s.stage === 'headliner' || s.stage === 'legend') && s.apprentices.length < 2
    && !s.apprentices.some(a => (st.stats[a]?.joinedNight ?? -99) > show.night - 6));
  if (count < MAX_ACTIVE && mentors.length && r() < 0.3) {
    await createComic(st, settings, mentors[Math.floor(r() * mentors.length)]);
  } else if (count < MIN_ACTIVE + 2 || (count < MAX_ACTIVE && r() < 0.12 + (turned ? 0.5 : 0) + (runaway ? 0.15 : 0))) {
    await createComic(st, settings, null, r() < LENS_CHANCE ? forge(st, st.era.current, r, id => comics.get(id), weaknessesOf) : null);
  }
}

const LENS_CHANCE = 0.7;
const STYLE_LABEL: Record<string, string> = { observational: 'Observational', absurdist: 'Absurdist', 'crowd-work': 'Crowd-work', storytelling: 'Storytelling', 'one-liners': 'One-liner', dark: 'Dark', deadpan: 'Deadpan' };

function journal(s: CircuitStats, night: number, text: string) {
  s.journal = [{ night, text }, ...(s.journal || [])].slice(0, 20);
}

/** What the judges keep saying against a comic — an Answer is built from it. */
function weaknessesOf(id: string): string[] {
  const lines: [number, string][] = [];
  for (const show of recent.slice(0, 10)) {
    const p = show.performances.find(x => x.comedianId === id);
    if (p && !p.simulated) for (const c of p.cards) if (c.line) lines.push([c.score, c.line]);
  }
  return lines.sort((a, b) => a[0] - b[0]).slice(0, 3).map(x => x[1]);
}

async function growPopulation(st: CircuitState, settings: AISettings, n: number) {
  for (let i = 0; i < n; i++) await createComic(st, settings, null, forge(st, st.era?.current || null, Math.random, id => comics.get(id), weaknessesOf));
}

interface ComicDraft { name: string; tagline: string; voice: string; style: string; audience: string; look: string; doctrine: string; material: { name: string; type: string; description: string }[] }

/**
 * A newcomer — forged through a lens on a muse (an Imitator, an Answer, an
 * Outsider, a Second, a Rival) — or an apprentice who inherits a doctrine.
 */
async function createComic(st: CircuitState, settings: AISettings, mentor: CircuitStats | null, plan: ForgePlan | null = null) {
  const m = mentor ? comics.get(mentor.comedianId) : undefined;
  const muse = plan?.muse ? comics.get(plan.muse) : undefined;
  const era = st.era?.current;
  const lens: Lens = mentor ? 'disciple' : plan?.lens || 'newcomer';
  const label = LENS_LABEL[lens](muse?.name || m?.name || '');
  let draft: ComicDraft | null = null;
  if (getEngines().nightshift.state === 'online') {
    const who = mentor && m
      ? `Invent the APPRENTICE of stand-up comedian ${m.name} ("${m.tagline}", ${m.style}, school: ${mentor.doctrine}). They learned from ${m.name} but are their own person: a different background, and a twist on the doctrine that could one day make them a rival.`
      : plan
        ? `Invent a brand-new stand-up comedian arriving on the Circuit as ${label}. ${plan.brief} Their style: ${plan.style}.`
        : `Invent a brand-new stand-up comedian about to do their first open mic: a fresh, specific, original person.${era ? ` They came up in ${era.name}.` : ''}`;
    try {
      draft = await backgroundText(mentor ? `Circuit · ${m?.name} takes an apprentice` : plan ? `Circuit · the Forge: ${label}` : 'Circuit · a newcomer signs up', () => chatJson<ComicDraft>({
        task: 'cast', quality: settings.quality, maxTokens: 2600,
        system: 'You are a comedy talent scout. Output ONLY valid JSON.',
        prompt: `${who}
Return ONLY JSON: { "name": "stage name", "tagline": "one-line billing", "voice": "delivery + point of view", "style": "one of: ${STYLES.join(' | ')}", "audience": "who loves them", "look": "precise physical description for photos", "doctrine": "their school of comedy in one sentence", "material": [ { "name": "", "type": "PERSONA|PROP|VENUE|THEME|BIT|CATCHPHRASE", "description": "" } ] }  // 5 material entries`
      }));
    } catch { draft = null; }
  }
  if (!draft?.name) {
    const r = rng(Date.now());
    const name = `${NEWCOMER_FIRST[Math.floor(r() * NEWCOMER_FIRST.length)]} ${NEWCOMER_LAST[Math.floor(r() * NEWCOMER_LAST.length)]}`;
    const style = m?.style || plan?.style || STYLES[Math.floor(r() * STYLES.length)];
    draft = {
      name, tagline: mentor && m ? `${m.name}'s protégé, still finding the light.` : plan && plan.lens !== 'orthogonal' ? `${label[0].toUpperCase()}${label.slice(1)}.` : 'First time on a stage. Hands shaking. Mic on.',
      voice: m ? `${m.voice}, but younger and hungrier` : 'nervous energy that turns into confidence', style, audience: 'anyone rooting for an underdog',
      look: 'a young comedian in a thrifted blazer with a notebook sticking out of the pocket', doctrine: mentor ? `${mentor.doctrine} — with a twist` : 'Say the true thing first',
      material: [{ name: 'First open mic', type: 'THEME', description: 'Everything that went wrong the first time' }]
    };
  }
  if ([...comics.values()].some(c => c.name === draft!.name)) draft.name = `${draft.name} Jr.`;
  const id = uid('comedian');
  const material = (draft.material || []).slice(0, 6).map(x => [x.name || 'Bit', (MATERIAL_TYPES.includes(x.type as MaterialType) ? x.type : 'BIT') as MaterialType, x.description || ''] as [string, MaterialType, string]);
  if (mentor && m?.profile.material[0]) material.push([m.profile.material[0].name, m.profile.material[0].type, `Inherited from ${m.name}: ${m.profile.material[0].description}`]);
  const style = plan && !mentor ? plan.style : STYLES.includes(draft.style) ? draft.style : 'observational';
  const comic = comedianFrom({ id, name: draft.name, tagline: draft.tagline, voice: draft.voice, style, audience: draft.audience, look: draft.look, venue: m?.venue || 'openmic', material });
  await repo().saveComedian(comic);
  comics.set(id, comic);
  const mutate = (v: number) => Math.round(clamp(v + (Math.random() * 4 - 2), 3, 10));
  let skills: SkillVector;
  if (plan && !mentor) {
    const p = plan.skills;
    skills = { writing: mutate(p.writing), delivery: mutate(p.delivery), crowdwork: mutate(p.crowdwork), originality: mutate(p.originality), presence: mutate(p.presence) };
  } else {
    const base = mentor?.skills || { writing: 6, delivery: 6, crowdwork: 6, originality: 6, presence: 6 };
    skills = { writing: mutate(base.writing - 1), delivery: mutate(base.delivery - 1), crowdwork: mutate(base.crowdwork - 1), originality: mutate(base.originality), presence: mutate(base.presence - 1) };
  }
  if (era) skills[era.school] = Math.max(skills[era.school], 7);
  st.stats[id] = {
    ...newStats(id, skills, draft.doctrine || 'Say the true thing first', 1000, mentor?.founderId || id, mentor?.comedianId || null, mentor ? mentor.generation + 1 : 0, st.night),
    lens, museId: mentor?.comedianId || plan?.muse || null, bornEra: era?.name || null
  };
  ensurePresence(st);
  journal(st.stats[id], st.night, mentor ? `${m?.name} said yes. I start tomorrow.` : muse ? `Everyone keeps talking about ${muse.name}. Not for long.` : 'Signed the list. Third from the top.');
  if (mentor) {
    mentor.apprentices = [...mentor.apprentices, id];
    event('apprentice', `${m?.name} takes on an apprentice: ${comic.name}, “${draft.doctrine}”.`, [mentor.comedianId, id]);
  } else if (plan) {
    event('arrival', `${comic.name} arrives on the Circuit: ${label}. “${comic.tagline}”`, [id, ...(plan.muse ? [plan.muse] : [])]);
    if (plan.muse && plan.rivalHeat) {
      const v = rivalry(st, id, plan.muse);
      v.heat = Math.max(v.heat, plan.rivalHeat);
      if (plan.lens === 'antagonist') event('rivalry', `Sworn rivals from day one: ${comic.name} has hated ${muse?.name}'s act since the first time they saw it.`, [id, plan.muse]);
    }
  } else {
    event('debut', `${comic.name} signs up for their first open mic. “${comic.tagline}”`, [id]);
  }
}

// ---------------------------------------------------------------------
// the loop — the Circuit runs itself
// ---------------------------------------------------------------------

const GAP_MS = 20_000;

export async function setLive(on: boolean, getSettings: () => AISettings) {
  if (station) { await station.cmd('setLive', on); return; }
  const st = await ensureCircuit();
  st.live = on;
  await commit();
  if (on) startLoop(getSettings); else stopLoop();
}

export function resumeIfLive(getSettings: () => AISettings) {
  if (station) return;   // the Station runs the Circuit; this page only watches
  ensureCircuit().then(async st => {
    setTimeout(() => backfillReel(st, getSettings()), 20_000);
    if (st.live) { startLoop(getSettings); return; }
    // A one-off show that a reload interrupted still finishes.
    if (st.pending && !st.pending.show.endedAt) {
      await waitForNightshift(60_000);
      runShow(getSettings()).catch(() => { /* surfaced in the live view */ });
    }
  }).catch(() => { /* ignore */ });
}

function stopLoop() {
  flags.loopAlive = false;
  flags.loopId++;
  store.patchLive({ phase: 'idle', note: 'The Circuit is dark.' });
}

function startLoop(getSettings: () => AISettings) {
  if (flags.loopAlive) return;
  flags.loopAlive = true;
  const id = ++flags.loopId;
  const alive = () => flags.loopAlive && flags.loopId === id;
  (async () => {
    while (alive() && state?.live) {
      if (getEngines().nightshift.state !== 'online') {
        store.patchLive({ phase: 'waiting', note: 'Waiting for Nightshift — the clubs open as soon as it is up.' });
        await sleep(15_000);
        continue;
      }
      try {
        await runShow(getSettings());
      } catch (e) {
        store.patchLive({ phase: 'waiting', note: `The show stalled: ${describeError(e)} Retrying in a minute.` });
        await sleep(60_000);
        continue;
      }
      for (let t = 0; t < GAP_MS && alive(); t += 1000) await sleep(1000);
    }
    if (flags.loopId === id) flags.loopAlive = false;
  })();
}

export function lineageOf(st: CircuitState) {
  const byFounder = new Map<string, CircuitStats[]>();
  for (const s of Object.values(st.stats)) {
    const list = byFounder.get(s.founderId) || [];
    list.push(s);
    byFounder.set(s.founderId, list);
  }
  return [...byFounder.entries()].map(([founderId, members]) => ({
    founderId, members: members.sort((a, b) => a.generation - b.generation || b.elo - a.elo),
    wins: members.reduce((a, s) => a + s.wins, 0), titles: members.reduce((a, s) => a + s.titles, 0)
  })).sort((a, b) => b.wins - a.wins);
}

/** Headshots for everyone on the Circuit who doesn't have one yet. */
export async function shootRoster(settings: AISettings, headshot: (c: Comedian) => string): Promise<number> {
  if (station) return station.cmd('shootRoster');
  const st = await ensureCircuit();
  const todo = active(st).map(s => comics.get(s.comedianId)!).filter(c => c && !c.headshotUrl && !c.avatarImage);
  let shot = 0;
  await Promise.all(todo.map(async c => {
    try {
      const url = await renderStill(headshot(c), { ...settings, venue: c.venue || settings.venue }, {
        label: `Headshot · ${c.name}`, itemKey: `headshot:${c.id}`, seed: comedianSeed(c), portrait: true, ref: { comedianId: c.id }
      });
      const fresh = (await repo().getComedian(c.id)) || c;
      fresh.headshotUrl = url;
      await repo().saveComedian(fresh);
      comics.set(c.id, fresh);
      shot++;
      store.publishCircuit({ state: { ...st } });
    } catch { /* keep the initials */ }
  }));
  return shot;
}

export function comedianName(id: string) { return nameOf(id); }

// ---------------------------------------------------------------------
// Station mode — the engine runs inside npm start; this page watches it
// ---------------------------------------------------------------------

export interface StationLink {
  cmd(name: string, ...args: unknown[]): Promise<any>;
  snapshot(): Promise<{ state: CircuitState | null; shows: Show[]; live?: store.LiveShow }>;
}
let station: StationLink | null = null;
export function attachStation(link: StationLink) { station = link; }
export const isStationMode = () => !!station;

/** The Station sent a new picture of the Circuit. */
export async function applyStationSnapshot(snap: { state: CircuitState | null; shows: Show[]; live?: store.LiveShow }) {
  state = snap.state;
  recent = snap.shows || [];
  await refreshComics();
  store.publishCircuit({ state: state ? { ...state } : null, shows: [...recent], ...(snap.live ? { live: snap.live } : {}) });
}

/** The Station imported a browser's Circuit: read it back from disk. */
export async function reloadCircuit() {
  state = null;
  recent = [];
  await ensureCircuit();
}
export function comedianOf(id: string) { return comics.get(id); }
