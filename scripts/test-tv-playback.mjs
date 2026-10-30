// Run with: node --experimental-strip-types --no-warnings scripts/test-tv-playback.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { speak, paceWords } from '../services/tv/sound.ts';

function speechHarness(t) {
  const oldWindow = globalThis.window;
  const oldUtterance = globalThis.SpeechSynthesisUtterance;
  const synth = { paused: false, current: null, getVoices: () => [], cancel() {}, speak(u) { this.current = u; u.onstart?.(); } };
  globalThis.window = { speechSynthesis: synth };
  globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  t.after(() => {
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
    if (oldUtterance === undefined) delete globalThis.SpeechSynthesisUtterance; else globalThis.SpeechSynthesisUtterance = oldUtterance;
    t.mock.timers.reset();
  });
  return synth;
}

test('caption fallback pauses with speech and resumes from the same word', async t => {
  const synth = speechHarness(t);
  const words = [];
  const ctl = new AbortController();
  const speaking = speak('One two three four five six seven eight nine.', { id: 'comic' }, w => words.push(w), ctl.signal);
  t.mock.timers.tick(600);
  t.mock.timers.tick(500);
  assert.ok(words.length > 0);
  const before = words.length;
  synth.paused = true;
  t.mock.timers.tick(2000);
  assert.equal(words.length, before);
  synth.paused = false;
  t.mock.timers.tick(500);
  assert.equal(words[before], words[before - 1] + 1);
  ctl.abort();
  await speaking;
  const after = words.length;
  t.mock.timers.tick(5000);
  assert.equal(words.length, after, 'cancelled speech must not update captions');
});

test('leaving during the opening delay never creates a later caption interval', async t => {
  speechHarness(t);
  const words = [];
  const ctl = new AbortController();
  const speaking = speak('The show has barely started.', { id: 'comic' }, w => words.push(w), ctl.signal);
  ctl.abort();
  await speaking;
  t.mock.timers.tick(6000);
  assert.deepEqual(words, []);
});

test('real word boundaries replace the estimated caption timer', async t => {
  const synth = speechHarness(t);
  const words = [];
  const ctl = new AbortController();
  const speaking = speak('One two three four.', { id: 'comic' }, w => words.push(w), ctl.signal);
  t.mock.timers.tick(600);
  t.mock.timers.tick(500);
  synth.current.onboundary({ name: 'word', charIndex: 4 });
  const before = words.length;
  t.mock.timers.tick(2000);
  assert.equal(words.length, before);
  assert.equal(words.at(-1), 1);
  ctl.abort();
  await speaking;
});

test('muted pacing can be cancelled while paused without late captions', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const ctl = new AbortController();
  const words = [];
  const reading = paceWords(10, w => words.push(w), ctl.signal, 2, () => true);
  t.mock.timers.tick(2000);
  ctl.abort();
  await reading;
  t.mock.timers.tick(2000);
  assert.deepEqual(words, []);
});
