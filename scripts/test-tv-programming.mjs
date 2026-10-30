// Run with: node --experimental-strip-types --no-warnings scripts/test-tv-programming.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { program, reconcileProgram } from '../services/tv/programming.ts';
import { FORMAT_LABEL, STAGE_LABEL } from '../services/league/types.ts';

const now = Date.now();
const segment = (key, extra = {}) => ({
  key, comedianId: key, name: key, tagline: '', title: key, text: `A set by ${key}.`,
  clips: [], moments: [], cards: [], at: now, score: 7, ...extra
});

test('fresh performances respect every channel filter', () => {
  const cases = [
    ['animated', { clips: ['clip.mp4'] }, {}],
    ['roasts', { format: FORMAT_LABEL.roast_battle }, { format: FORMAT_LABEL.open_mic }],
    ['rising', { stage: STAGE_LABEL.open_mic }, { stage: STAGE_LABEL.legend }],
    ['legends', { stage: STAGE_LABEL.legend }, { stage: STAGE_LABEL.open_mic }],
    ['specials', { special: 'An hour' }, {}],
    ['fresh', {}, { special: 'An hour' }]
  ];
  for (const [channel, match, mismatch] of cases) {
    const current = segment('current', match);
    const good = segment('eligible', match);
    const bad = segment('wrong-channel', { ...mismatch, score: 10 });
    const next = reconcileProgram([current], 0, [current, good, bad], channel, new Set(['current']));
    assert.deepEqual(next.queue.map(s => s.key), ['current', 'eligible'], channel);
    assert.equal(next.queue[next.index].key, 'current');
  }
});

test('new renders update the current item without changing its identity', () => {
  const before = segment('current', { image: 'still.jpg' });
  const after = { ...before, clips: ['new-angle.mp4'], audio: 'voice.wav', image: 'final-still.jpg' };
  const next = reconcileProgram([before], 0, [after], 'best', new Set(['current']));
  assert.equal(next.queue[next.index].key, before.key);
  assert.deepEqual(next.queue[next.index].clips, ['new-angle.mp4']);
  assert.equal(next.queue[next.index].audio, 'voice.wav');
  assert.equal(before.image, 'still.jpg', 'reconciliation does not mutate the old queue');
});

test('removing earlier entries preserves the performance currently playing', () => {
  const removed = segment('removed'), current = segment('current'), later = segment('later');
  const next = reconcileProgram([removed, current, later], 1, [current, later], 'best', new Set(['removed', 'current', 'later']));
  assert.equal(next.index, 0);
  assert.equal(next.queue[next.index].key, 'current');
});

test('a previously known still joins Animated once its video arrives', () => {
  const current = segment('current', { clips: ['a.mp4'] });
  const finished = segment('finished', { clips: ['b.mp4'] });
  const next = reconcileProgram([current], 0, [current, finished], 'animated', new Set(['current', 'finished']));
  assert.deepEqual(next.queue.map(s => s.key), ['current', 'finished']);
});

test('fresh additions survive beyond the two promoted slots without duplication', () => {
  const current = segment('current'), queued = segment('queued');
  const fresh = [1, 2, 3, 4].map(i => segment(`new-${i}`, { score: 10 - i }));
  const known = new Set(['current', 'queued']);
  const next = reconcileProgram([current, queued], 0, [current, queued, ...fresh], 'best', known);
  assert.equal(next.queue[next.index].key, 'current');
  assert.deepEqual(next.queue.slice(1, 3).map(s => s.key), ['new-1', 'new-2']);
  assert.equal(next.queue.length, 6);
  assert.equal(new Set(next.queue.map(s => s.key)).size, 6);
  const again = reconcileProgram(next.queue, next.index, [current, queued, ...fresh], 'best', known);
  assert.deepEqual(again.queue.map(s => s.key), next.queue.map(s => s.key));
});

test('Specials finish their existing running order before new material', () => {
  const first = segment('first', { special: 'First special' });
  const second = segment('second', { special: 'First special' });
  const newOne = segment('new', { special: 'New special', at: now + 1 });
  const next = reconcileProgram([first, second], 0, [first, second, newOne], 'specials', new Set(['first', 'second']));
  assert.deepEqual(next.queue.map(s => s.key), ['first', 'second', 'new']);
});

test('an empty channel fills only when matching material becomes available', () => {
  const ordinary = segment('ordinary');
  assert.deepEqual(reconcileProgram([], 0, [ordinary], 'animated', new Set()).queue, []);
  const animated = { ...ordinary, clips: ['clip.mp4'] };
  assert.deepEqual(reconcileProgram([], 0, [animated], 'animated', new Set()).queue.map(s => s.key), ['ordinary']);
});

test('navigation beyond one cycle still anchors reconciliation to the visible set', () => {
  const first = segment('first'), second = segment('second'), fresh = segment('fresh', { score: 10 });
  const next = reconcileProgram([first, second], 5, [first, second, fresh], 'best', new Set(['first', 'second']));
  assert.equal(next.queue[next.index].key, 'second');
  assert.equal(next.queue[next.index + 1].key, 'fresh');
  assert.deepEqual(program([first, second], 'animated'), []);
});
