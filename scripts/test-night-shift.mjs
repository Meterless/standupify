// Isolated Station integration checks. No real engines or user data are used.
// Run: node scripts/test-night-shift.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { startNightshift, MOCK_TOKEN } from './mock-engines.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

if (process.argv.includes('--worker')) {
  const vite = await createServer({ root, configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  const station = await vite.ssrLoadModule('/server/station.ts');
  const ns = {
    state: 'online', origin: process.env.TEST_NIGHTSHIFT_URL, tokenSource: 'env', installed: true, canLaunch: false,
    modes: 2, classes: { text: { availability: 'available', why: null } }, reason: 'Isolated test engine'
  };
  const comfy = { state: 'offline', origin: null, version: null, gpu: null, installed: false, canLaunch: false, installDir: null, inventoryStamp: 0, reason: 'No camera required for this test' };
  await station.startStation(root, { status: async () => ({ nightshift: ns, comfy }), token: () => MOCK_TOKEN });
  const server = http.createServer(async (req, res) => {
    try { if (!await station.handleStation(req, res, (req.url || '').split('?')[0])) { res.writeHead(404); res.end(); } }
    catch (e) { res.writeHead(500); res.end(String(e)); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  process.send?.({ port: server.address().port });
} else {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'standupify-night-shift-test-'));
  const mock = await startNightshift(0);
  const mockUrl = `http://127.0.0.1:${mock.address().port}`;
  let worker;
  let base;
  let stderr = '';
  const headers = { 'content-type': 'application/json', 'x-standupify': '1' };
  const post = async (route, body) => {
    const response = await fetch(`${base}/api/station/${route}`, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || `Station ${response.status}`);
    return data.result;
  };
  const cmd = (name, ...args) => post('cmd', { name, args });
  const repo = (method, ...args) => post('repo', { method, args });
  const until = async (check, label, timeout = 60_000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) { const result = await check(); if (result) return result; await delay(100); }
    throw new Error(`Timed out: ${label}\n${stderr.slice(-4000)}`);
  };
  const startWorker = async () => {
    worker = fork(fileURLToPath(import.meta.url), ['--worker'], {
      cwd: root, env: { ...process.env, STANDUPIFY_STATION_DIR: dir, TEST_NIGHTSHIFT_URL: mockUrl },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc']
    });
    worker.stderr.on('data', chunk => { stderr += String(chunk); });
    const port = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Worker startup timed out\n${stderr}`)), 30_000);
      worker.once('message', msg => { clearTimeout(timeout); resolve(msg.port); });
      worker.once('exit', code => { clearTimeout(timeout); reject(new Error(`Worker exited ${code}\n${stderr}`)); });
    });
    base = `http://127.0.0.1:${port}`;
  };
  const stopWorker = async () => {
    if (!worker || worker.exitCode !== null) return;
    const exited = new Promise(resolve => worker.once('exit', resolve));
    worker.kill();
    await exited;
  };
  const checkStream = async () => {
    const controller = new AbortController();
    const response = await fetch(`${base}/api/station/stream`, { signal: controller.signal });
    const reader = response.body.getReader();
    let text = '';
    try {
      while (!text.includes('event: autopilot\n')) {
        const { value, done } = await reader.read();
        if (done) throw new Error('Station stream closed before Night Shift status');
        text += new TextDecoder().decode(value);
      }
      const status = JSON.parse(text.match(/event: autopilot\ndata: ([^\n]+)/)[1]);
      assert.equal(status.owner, 'station');
      return status;
    } finally { controller.abort(); }
  };
  try {
    await startWorker();
    await cmd('ensureCircuit');
    const settings = await repo('getSettings');
    await repo('saveSettings', { ...settings, imageEngine: 'comfy', autoVoice: false, autoJudge: false, autoOriginals: false });
    const founder = (await repo('listComedians'))[0];
    const comic = { ...founder, id: 'comedian_test_shift', name: 'Integration Comic', autopilotConfig: { ...founder.autopilotConfig, enabled: true, clipsPerSet: 3, generateVideo: false, lastSetAt: undefined } };
    await repo('saveComedian', comic);

    // An open shift owns one production even when two clients request Run now.
    await cmd('autopilotStart', 1000);
    await until(async () => (await cmd('autopilotStatus')).currentJob?.agent === 'writer', 'writer started');
    const one = cmd('autopilotRunNow', comic.id);
    const two = cmd('autopilotRunNow', comic.id);
    await until(async () => (await cmd('autopilotStatus')).currentJob?.agent === 'clipper', 'clipper started');
    const current = await repo('getComedian', comic.id);
    await repo('saveComedian', { ...current, tagline: 'Edited while working', autopilotConfig: { ...current.autopilotConfig, enabled: false } });
    await cmd('autopilotStop');
    await Promise.all([one, two]);
    assert.equal((await repo('listSets', comic.id)).length, 1, 'concurrent requests share the writer');
    assert.equal((await repo('getComedian', comic.id)).autopilotConfig.enabled, false, 'off-shift edit survives');
    assert.equal((await repo('getComedian', comic.id)).tagline, 'Edited while working');
    assert.equal((await checkStream()).running, false, 'a new client receives the actual stopped state');
    let saved = JSON.parse(fs.readFileSync(path.join(dir, 'night-shift.json'), 'utf8'));
    assert.equal(saved.enabled, false);
    assert.ok(saved.cycles[comic.id]?.setId, 'interrupted chain has a durable set checkpoint');
    console.log('PASS: concurrent clients, mid-cycle edits, stop, and status stream');

    // Explicitly reopen, then restart the process during the remaining chain.
    const paused = await repo('getComedian', comic.id);
    await repo('saveComedian', { ...paused, autopilotConfig: { ...paused.autopilotConfig, enabled: true } });
    await cmd('autopilotStart', 1000);
    await until(async () => !!(await cmd('autopilotStatus')).currentJob, 'saved chain resumed');
    await stopWorker();
    await startWorker();
    await until(async () => (await repo('getComedian', comic.id))?.autopilotConfig.lastSetAt, 'restart finished saved chain');
    assert.equal((await repo('listSets', comic.id)).length, 1, 'restart reconnects the existing set');
    assert.equal((await repo('listClips', comic.id)).length, 3, 'restart fills only missing clips');
    assert.equal((await repo('listPromos', comic.id)).length, 1, 'restart does not duplicate a saved promo');
    assert.equal((await checkStream()).running, true, 'reconnecting browser sees persisted running intent');
    await cmd('autopilotStop');
    await stopWorker();
    await startWorker();
    assert.equal((await cmd('autopilotStatus')).running, false, 'stop persists through restart');
    console.log('PASS: process restart recovery, asset deduplication, persisted stop');
  } finally {
    await stopWorker();
    mock.closeAllConnections?.();
    await new Promise(resolve => mock.close(resolve));
    // Only remove the explicitly created test directory under the OS temp root.
    const resolved = path.resolve(dir);
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.ok(path.basename(resolved).startsWith('standupify-night-shift-test-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}
