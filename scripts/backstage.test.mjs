import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

// The module has no runtime dependencies. Transpile only it, keeping the tests
// runnable on the project's Node 18 minimum without a second test framework.
const source = await readFile(new URL('../services/league/backstage.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
const { settleBackstage, backstageBrief, pendingBackstageRematch } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

function comic(id, overrides = {}) {
  return {
    comedianId: id, life: 'active', mentorId: null, journal: [],
    skills: { writing: 6, delivery: 6, crowdwork: 6, originality: 6, presence: 6 },
    ...overrides
  };
}
function state(comics, overrides = {}) {
  return { night: 9, stats: Object.fromEntries(comics.map(c => [c.comedianId, c])), rivalries: [], ...overrides };
}
function show(scores, night = 10, overrides = {}) {
  return {
    id: `show-${night}`, night, endedAt: 123, theme: 'Tiny everyday victories',
    lineup: Object.keys(scores),
    performances: Object.entries(scores).map(([comedianId, final]) => ({ comedianId, final, title: `Bit by ${comedianId}` })),
    ...overrides
  };
}
const nameOf = id => id.toUpperCase();

test('an actual rough set earns a mentor drill, shared journals and a bounded writing memory', () => {
  const st = state([
    comic('mentor', { skills: { writing: 9, delivery: 6, crowdwork: 6, originality: 6, presence: 6 } }),
    comic('learner', { mentorId: 'mentor' })
  ]);
  const [exchange] = settleBackstage(st, show({ learner: 4.5 }), nameOf);
  assert.equal(exchange.kind, 'mentoring');
  assert.deepEqual(exchange.actors, ['mentor', 'learner']);
  assert.match(exchange.text, /Bit by learner.*4.5/);
  assert.match(exchange.topic, /setup/);
  assert.equal(st.stats.mentor.journal.length, 1);
  assert.equal(st.stats.learner.journal.length, 1);
  assert.match(backstageBrief(st, 'learner', 11, nameOf), /Put this drill into practice/);
  assert.equal(backstageBrief(st, 'learner', 10, nameOf), '');
  assert.equal(backstageBrief(st, 'learner', 15, nameOf), '');
});

test('peers collaborate on the show theme without copying or growing material banks', () => {
  const st = state([comic('a'), comic('b')]);
  const [exchange] = settleBackstage(st, show({ a: 8, b: 7.5 }), nameOf);
  assert.equal(exchange.kind, 'collaboration');
  assert.equal(exchange.topic, 'Tiny everyday victories');
  assert.match(backstageBrief(st, 'a', 11, nameOf), /credit the conversation; do not copy/);
  assert.equal(st.stats.a.material, undefined);
});

test('settlement is deterministic, idempotent and respects pair cooldown', () => {
  const st = state([comic('a'), comic('b')]);
  const identical = structuredClone(st);
  const first = settleBackstage(st, show({ a: 8, b: 7 }), nameOf);
  assert.deepEqual(settleBackstage(identical, show({ a: 8, b: 7 }), nameOf), first);
  const settled = structuredClone(st);
  assert.deepEqual(settleBackstage(st, show({ a: 8, b: 7 }), nameOf), []);
  assert.deepEqual(st, settled);
  assert.deepEqual(settleBackstage(st, show({ a: 8, b: 7 }, 11), nameOf), []);
  assert.equal(settleBackstage(st, show({ a: 8, b: 7 }, 14), nameOf).length, 1);
  assert.deepEqual(settleBackstage(st, show({ a: 8, b: 7 }, 12), nameOf), []);
});

test('a close rival finish schedules one eligible rematch, fulfilled by a later meeting', () => {
  const st = state([comic('a'), comic('b')], { rivalries: [{ a: 'a', b: 'b', heat: 3 }] });
  const [exchange] = settleBackstage(st, show({ a: 8, b: 7.5 }), nameOf);
  assert.equal(exchange.kind, 'rematch');
  assert.deepEqual(pendingBackstageRematch(st, ['a', 'b'], 11), ['a', 'b']);
  assert.equal(pendingBackstageRematch(st, ['a'], 11), null);
  assert.equal(pendingBackstageRematch(st, ['a', 'b'], 19), null);
  assert.match(backstageBrief(st, 'a', 11, nameOf), /agreed to a rematch/);
  settleBackstage(st, show({ a: 7, b: 8 }, 11), nameOf);
  assert.equal(st.backstage[0].resolvedNight, 11);
  assert.equal(pendingBackstageRematch(st, ['a', 'b'], 12), null);
  assert.equal(backstageBrief(st, 'a', 12, nameOf), '');
});

test('retired, resting, missing and self actors cannot engage or get rematch bookings', () => {
  const st = state([
    comic('a', { mentorId: 'a' }),
    comic('retired', { life: 'retired' }),
    comic('resting', { inner: { resting: 9 } })
  ]);
  assert.deepEqual(settleBackstage(st, show({ a: 4, retired: 9, resting: 9, missing: 9 }), nameOf), []);
  assert.equal(st.backstageThroughNight, 10);
  st.backstage = [{ kind: 'rematch', night: 10, actors: ['a', 'retired'] }];
  assert.equal(pendingBackstageRematch(st, ['a', 'retired'], 11), null);
  assert.equal(backstageBrief(st, 'a', 11, nameOf), '');
  st.backstage = [{ kind: 'rematch', night: 10, actors: ['a', 'a'] }];
  assert.equal(pendingBackstageRematch(st, ['a'], 11), null);
  assert.equal(backstageBrief(st, 'a', 11, nameOf), '');
});

test('a rematch is fulfilled even when one performer decides to rest afterwards', () => {
  const st = state([comic('a'), comic('b', { inner: { resting: 11 } })], {
    backstage: [{ kind: 'rematch', night: 10, actors: ['a', 'b'] }]
  });
  settleBackstage(st, show({ a: 8, b: 3 }, 11), nameOf);
  assert.equal(st.backstage[0].resolvedNight, 11);
});

test('unfinished shows do not settle; a long-running scene caps exchanges and journals', () => {
  const st = state(Array.from({ length: 8 }, (_, i) => comic(`comic${i}`)));
  const scores = Object.fromEntries(Object.keys(st.stats).map(id => [id, 7]));
  assert.deepEqual(settleBackstage(st, show(scores, 10, { endedAt: null }), nameOf), []);
  assert.equal(st.backstageThroughNight, undefined);
  for (let night = 10; night < 200; night++) {
    const made = settleBackstage(st, show(scores, night), nameOf);
    assert.ok(made.length <= 3);
    const actors = made.flatMap(e => e.actors);
    assert.equal(new Set(actors).size, actors.length);
  }
  assert.equal(st.backstage.length, 60);
  assert.ok(Object.values(st.stats).every(c => c.journal.length <= 20));
});
