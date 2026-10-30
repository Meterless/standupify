// In-process behavior checks: real orchestrator + scheduler, isolated repository
// and deterministic agent doubles. No subprocesses, engines, or user data.
// node --experimental-vm-modules scripts/test-night-shift-unit.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const clone = structuredClone;
const settings = { quality: 'auto', imageEngine: 'comfy', cameraMove: 'dolly-in', autoVoice: false, autoJudge: false };
const comedians = new Map();
const sets = new Map();
const clips = new Map();
const promos = new Map();
const scouts = new Map();
const jobs = new Map();
const outbox = new Map();
const tables = { Comedian: comedians, Set: sets, Clip: clips, Promo: promos, Scout: scouts, Job: jobs, OutboxItem: outbox };
const repo = { getSettings: async () => clone(settings) };
for (const [name, table] of Object.entries(tables)) {
  repo[`get${name}`] = async id => clone(table.get(id));
  repo[`save${name}`] = async row => { table.set(row.id, clone(row)); };
}
for (const [method, table] of Object.entries({ listComedians: comedians, listSets: sets, listClips: clips, listPromos: promos, listScouts: scouts, listJobs: jobs, listOutbox: outbox })) {
  repo[method] = async id => [...table.values()].filter(x => !id || x.comedianId === id).map(x => clone(x));
}
let saved = null;
let online = false;
let writerRuns = 0;
let failWriter = false;
let releaseWriter;
let writerGate = null;
const waitFor = async (check, label) => {
  for (let i = 0; i < 500; i++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 2)); }
  throw new Error(`Timed out: ${label}`);
};
const comedian = id => ({
  id, name: id, tagline: 'Original tagline', status: 'active',
  profile: { audienceSignals: [], runningBits: [], brandSafetyRules: [] },
  autopilotConfig: { enabled: true, clipsPerSet: 3, generateVideo: false, requireApproval: true, setIntervalMs: 604800000 }
});
const imports = {
  './repository': { getRepository: () => repo },
  './engines': { getEngines: () => ({ nightshift: { state: online ? 'online' : 'offline' } }) },
  './agents/writer': { runWriter: async (_settings, c, _reason, reservedSetId) => {
    writerRuns++;
    if (writerGate) await writerGate;
    if (failWriter) throw new Error('Writer unavailable');
    const set = { id: reservedSetId || `set_${writerRuns}`, comedianId: c.id, generatedBy: 'autopilot', createdAt: Date.now(), status: 'ready', bits: [{ id: 1 }], clipIds: [], promoIds: [], analytics: {} };
    await repo.saveSet(set);
    return { set };
  } },
  './agents/clipper': { runClipper: async (_settings, c, set, missing) => {
    const created = [];
    for (let i = 0; i < missing; i++) {
      const clip = { id: `clip_${clips.size}`, comedianId: c.id, setId: set.id, status: 'draft' };
      await repo.saveClip(clip); created.push(clip);
    }
    return created;
  } },
  './agents/promoter': { runPromoter: async (_settings, c, set) => {
    const promo = { id: `promo_${promos.size}`, comedianId: c.id, setId: set.id };
    await repo.savePromo(promo); return promo;
  } },
  './agents/scout': { runScout: async (_settings, c, count) => {
    for (let i = 0; i < count; i++) await repo.saveScout({ id: `scout_${scouts.size}`, comedianId: c.id, createdAt: Date.now() });
  } },
  './agents/analytics': { runAnalytics: async () => undefined },
  './agents/booker': { runBooker: async () => [] },
  './studio': { animateBit: async () => 'test-video' }
};
async function runtime() {
  const context = vm.createContext({ console, structuredClone, setTimeout, clearTimeout, setInterval, clearInterval });
  const source = file => ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const scheduler = new vm.SourceTextModule(source('services/scheduler.ts'), { context });
  await scheduler.link(() => { throw new Error('Unexpected scheduler dependency'); });
  await scheduler.evaluate();
  const publisher = new vm.SourceTextModule(source('services/publisher.ts'), { context });
  await publisher.link(specifier => {
    const exports = specifier === './repository' ? { getRepository: () => repo }
      : specifier === './tauriBridge' ? { isTauri: () => false, writeAssetToDiskOutbox: async () => null } : null;
    if (!exports) throw new Error(`Unexpected publisher import: ${specifier}`);
    return new vm.SyntheticModule(Object.keys(exports), function () { for (const [name, value] of Object.entries(exports)) this.setExport(name, value); }, { context });
  });
  await publisher.evaluate();
  const module = new vm.SourceTextModule(source('services/autopilot.ts'), { context });
  await module.link(specifier => {
    if (specifier === './scheduler') return scheduler;
    if (specifier === './publisher') return publisher;
    const exports = imports[specifier];
    if (!exports) throw new Error(`Unexpected import: ${specifier}`);
    return new vm.SyntheticModule(Object.keys(exports), function () { for (const [name, value] of Object.entries(exports)) this.setExport(name, value); }, { context });
  });
  await module.evaluate();
  const api = module.namespace;
  api.configureAutopilotPersistence({ load: async () => clone(saved), save: async state => { saved = clone(state); } });
  return { api, scheduler: scheduler.namespace.getScheduler(), publisher: publisher.namespace };
}

const first = await runtime();
let second;
let third;
try {
  const c = comedian('comic_one');
  await repo.saveComedian(c);
  await first.api.startAutopilot(settings);
  assert.equal(saved.enabled, true);
  assert.match((await first.api.getAutopilotStatus()).waiting, /Waiting for Nightshift/);
  assert.equal(jobs.size, 0);
  await assert.rejects(first.api.triggerCycleNow(c, settings), /Nightshift is not ready/);

  online = true;
  writerGate = new Promise(resolve => { releaseWriter = resolve; });
  const scheduled = first.scheduler.triggerNow();
  await waitFor(async () => (await first.api.getAutopilotStatus()).currentJob?.agent === 'writer', 'writer started');
  assert.ok(saved.cycles[c.id].setId, 'the writer owns a durable set ID before generation');
  const one = first.api.triggerCycleNow(c, settings);
  const two = first.api.triggerCycleNow(c, settings);
  await repo.saveComedian({ ...c, tagline: 'Edited while writing', autopilotConfig: { ...c.autopilotConfig, enabled: false } });
  await first.api.stopAutopilot();
  assert.equal((await first.api.getAutopilotStatus()).stopping, true);
  releaseWriter(); writerGate = null;
  await Promise.all([scheduled, one, two]);
  assert.equal(writerRuns, 1, 'manual and scheduled requests share one cycle');
  assert.equal(sets.size, 1);
  assert.equal(clips.size, 0, 'stop does not begin the next agent');
  assert.equal((await repo.getComedian(c.id)).autopilotConfig.enabled, false);
  assert.equal((await repo.getComedian(c.id)).tagline, 'Edited while writing');
  assert.equal(saved.enabled, false);
  assert.ok(saved.cycles[c.id].setId);
  console.log('PASS: engine waiting, overlapping triggers, saved stop, mid-cycle edits');

  // A fresh module models a process restart with the persisted state and repo.
  const edited = await repo.getComedian(c.id);
  await repo.saveComedian({ ...edited, autopilotConfig: { ...edited.autopilotConfig, enabled: true } });
  saved.enabled = true;
  second = await runtime();
  await second.api.resumeAutopilot(settings);
  await waitFor(async () => !!(await repo.getComedian(c.id)).autopilotConfig.lastSetAt, 'recovered chain completed');
  assert.equal(writerRuns, 1, 'restart uses the saved set');
  assert.equal(sets.size, 1);
  assert.equal(clips.size, 3);
  assert.equal(promos.size, 1);
  assert.equal(Object.keys(saved.cycles).length, 0);
  let received;
  const unsubscribe = second.api.onStatus(status => { received = status; });
  assert.equal(received.running, true, 'new subscribers immediately receive current status');
  unsubscribe();
  await second.api.stopAutopilot();
  assert.equal(saved.enabled, false);
  console.log('PASS: restart restores intent, resumes saved production, avoids duplicate assets');

  const failing = comedian('comic_failure');
  await repo.saveComedian(failing);
  failWriter = true;
  await assert.rejects(second.api.triggerCycleNow(failing, settings), /Writer unavailable/);
  assert.match((await second.api.getAutopilotStatus()).error, /Writer unavailable/);
  assert.ok([...jobs.values()].some(job => job.comedianId === failing.id && job.status === 'failed'));
  assert.ok(saved.cycles[failing.id].retryAfter > Date.now());
  console.log('PASS: actionable failure, failed-job record, bounded retry');

  // The analytics agent also awaits several reads before writing. A renderer
  // or user can update those same records while it is reading.
  const context = vm.createContext({ console });
  const analyticsSource = ts.transpileModule(fs.readFileSync(path.join(root, 'services/agents/analytics.ts'), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const analytics = new vm.SourceTextModule(analyticsSource, { context });
  await analytics.link(specifier => {
    assert.equal(specifier, '../repository');
    return new vm.SyntheticModule(['getRepository'], function () { this.setExport('getRepository', () => repo); }, { context });
  });
  await analytics.evaluate();
  const before = await repo.getComedian(c.id);
  const originalListOutbox = repo.listOutbox;
  repo.listOutbox = async id => {
    const changed = await repo.getComedian(id);
    changed.autopilotConfig.enabled = false;
    changed.tagline = 'Edited during analytics';
    await repo.saveComedian(changed);
    const rendered = (await repo.listSets(id))[0];
    rendered.bits[0].imageUrl = 'new-render';
    rendered.clipIds = ['new-clip'];
    await repo.saveSet(rendered);
    return originalListOutbox(id);
  };
  await analytics.namespace.runAnalytics(before);
  repo.listOutbox = originalListOutbox;
  assert.equal((await repo.getComedian(c.id)).tagline, 'Edited during analytics');
  assert.equal((await repo.getComedian(c.id)).autopilotConfig.enabled, false);
  const stamped = (await repo.listSets(c.id))[0];
  assert.equal(stamped.bits[0].imageUrl, 'new-render');
  assert.deepEqual(stamped.clipIds, ['new-clip']);
  assert.ok(stamped.analytics.recordedAt);
  console.log('PASS: analytics preserves concurrent profile edits and rendered assets');

  // Fail after the set and first clip reach the outbox. The mandatory outbox
  // step must remain pending, then a fresh runtime reconciles every asset.
  failWriter = false;
  const automatic = comedian('comic_outbox');
  automatic.autopilotConfig.requireApproval = false;
  await repo.saveComedian(automatic);
  const saveOutbox = repo.saveOutboxItem;
  let failedSubmission = false;
  repo.saveOutboxItem = async item => {
    if (item.comedianId === automatic.id && (await repo.listOutbox(automatic.id)).length === 2 && !failedSubmission) {
      failedSubmission = true;
      throw new Error('Outbox interrupted');
    }
    return saveOutbox(item);
  };
  await assert.rejects(second.api.triggerCycleNow(automatic, settings), /Outbox interrupted/);
  assert.equal((await repo.listOutbox(automatic.id)).length, 2);
  assert.ok(saved.cycles[automatic.id]);
  assert.ok(!saved.cycles[automatic.id].completed.includes('outbox'));
  assert.equal((await repo.getComedian(automatic.id)).autopilotConfig.lastSetAt, undefined);
  repo.saveOutboxItem = saveOutbox;
  const writtenBeforeRecovery = writerRuns;
  third = await runtime();
  await third.api.triggerCycleNow(automatic, settings);
  assert.equal(writerRuns, writtenBeforeRecovery, 'outbox recovery never rewrites the set');
  assert.equal((await repo.listOutbox(automatic.id)).length, 4, 'all three clips and the set are present once');
  assert.equal(saved.cycles[automatic.id], undefined);
  const completed = (await repo.listSets(automatic.id))[0];
  assert.equal(completed.status, 'submitted');
  const reviewed = (await repo.listOutbox(automatic.id))[0];
  reviewed.reviewed = true;
  reviewed.reviewerNote = 'Keep this review';
  await repo.saveOutboxItem(reviewed);
  const published = (await repo.listClips(automatic.id))[0];
  published.status = 'published';
  await repo.saveClip(published);
  await Promise.all([third.publisher.submitSetToOutbox(completed), third.publisher.submitSetToOutbox(completed)]);
  assert.equal((await repo.listOutbox(automatic.id)).length, 4, 'repeated/concurrent submission is idempotent');
  assert.equal((await repo.listOutbox(automatic.id)).find(item => item.id === reviewed.id).reviewerNote, 'Keep this review');
  assert.equal((await repo.getClip(published.id)).status, 'published');
  console.log('PASS: partial outbox recovery, per-asset deduplication, review/publish preservation');

  const common = 'comic_with_a_very_long_common_prefix_'.repeat(20);
  const longAssets = ['first', 'second', 'third'].map(suffix => ({ kind: 'clip', comedianId: common, refId: `${common}${suffix}`, title: suffix }));
  const publisher = third.publisher.getPublisher();
  const longResults = await Promise.all(longAssets.map(asset => publisher.post({ kind: 'openmic_network_outbox' }, asset)));
  const longIds = longResults.map(result => result.outboxId);
  assert.equal(new Set(longIds).size, 3, 'differences at the end of long keys remain distinct');
  assert.ok(longIds.every(id => /^outbox_[a-f0-9]{32}$/.test(id) && id.length <= 55));
  assert.deepEqual(longIds.map(id => encodeURIComponent(id)), longIds, 'Station filenames require no escaping expansion');
  assert.deepEqual(longIds.map(id => id.toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 60)), longIds, 'Tauri slugs retain the complete digest');
  const again = await publisher.post({ kind: 'openmic_network_outbox' }, longAssets[0]);
  assert.equal(again.outboxId, longIds[0], 'the full asset identity produces a stable key');
  console.log('PASS: bounded stable outbox IDs with long shared prefixes');

  // Circuit also creates generatedBy=autopilot sets. They can never be adopted
  // by an interrupted Night Shift writer merely because their timestamp is new.
  const intendedSetId = saved.cycles[failing.id].setId;
  const unrelated = { id: 'circuit_unrelated', comedianId: failing.id, generatedBy: 'autopilot', createdAt: Date.now() + 1, status: 'ready', bits: [{ id: 99 }], clipIds: [], promoIds: [], analytics: {} };
  await repo.saveSet(unrelated);
  await third.api.triggerCycleNow(failing, settings);
  assert.ok(await repo.getSet(intendedSetId), 'writer resumes its reserved ID');
  assert.deepEqual(await repo.getSet(unrelated.id), unrelated, 'newer Circuit material stays untouched');
  assert.ok((await repo.listClips(failing.id)).every(clip => clip.setId === intendedSetId));
  console.log('PASS: restart cannot adopt unrelated Circuit sets');
} finally {
  releaseWriter?.();
  await first.api.stopAutopilot();
  if (second) await second.api.stopAutopilot();
  if (third) await third.api.stopAutopilot();
}
