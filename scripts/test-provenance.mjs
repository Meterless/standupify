// Provenance and workflow checks. Runs on files in the repo, no GPU needed:
//   - the graph reader finds the embedded ComfyUI workflow in a real MP4 and PNG
//   - every example workflow is valid API JSON with no local paths or secrets
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { extractGraph, summarizeGraph, modelLabel } from '../services/comfy/provenance.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = (f) => path.join(root, 'docs', 'verification', f);

test('reads the LTX graph embedded in a real ComfyUI MP4', () => {
  const g = extractGraph(fs.readFileSync(fixture('ltx-clip-2026-10-30.mp4')));
  assert.ok(g, 'graph found');
  const s = summarizeGraph(g);
  assert.equal(s.kind, 'video');
  assert.equal(s.family, 'LTX-Video 2B v0.9.5');
  assert.equal(s.width, 768);
  assert.equal(s.height, 512);
  assert.equal(s.frames, 97);
  assert.equal(s.steps, 30);
  assert.ok(s.chain.some(n => n.type === 'LTXVImgToVideo'));
  assert.ok(s.prompt.length > 20, 'positive prompt traced through the guider');
  // Inputs come before the nodes that use them.
  const at = (t) => s.chain.findIndex(n => n.type === t);
  assert.ok(at('CheckpointLoaderSimple') < at('LTXVImgToVideo') && at('LTXVImgToVideo') < at('SaveVideo'));
});

test('reads the Kontext graph embedded in a real ComfyUI PNG', () => {
  const g = extractGraph(fs.readFileSync(fixture('kontext-wide-2026-10-30.png')));
  assert.ok(g, 'graph found');
  const s = summarizeGraph(g);
  assert.equal(s.kind, 'still');
  assert.equal(s.family, 'FLUX.1 Kontext dev');
  assert.ok(s.chain.some(n => n.type === 'ReferenceLatent'));
  assert.equal(s.startImage, 'standupify_dez_master.png');
});

test('a file without a graph reads as null, not a crash', () => {
  assert.equal(extractGraph(new TextEncoder().encode('no graph here {"class_type": oops')), null);
  assert.equal(extractGraph(new Uint8Array(0)), null);
});

test('model labels', () => {
  assert.equal(modelLabel('wan2.2_ti2v_5B_fp16.safetensors'), 'Wan 2.2 5B');
  assert.equal(modelLabel('flux1-schnell-fp8-e4m3fn.safetensors'), 'FLUX.1 schnell');
  assert.equal(modelLabel('wan2.2_vae.safetensors'), 'Wan VAE');
  assert.equal(modelLabel('ae.safetensors'), 'FLUX VAE');
});

test('example workflows are clean API graphs', () => {
  const dir = path.join(root, 'workflows', 'examples');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  assert.ok(files.length >= 6);
  for (const f of files) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    const g = JSON.parse(text);
    assert.ok(Object.values(g).every(n => typeof n.class_type === 'string' && n.inputs), `${f} is API format`);
    // Every link points at a node that exists.
    for (const n of Object.values(g)) {
      for (const v of Object.values(n.inputs)) if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'string') assert.ok(g[v[0]], `${f}: link to missing node ${v[0]}`);
    }
    assert.doesNotMatch(text, /[A-Z]:\\\\|\/Users\/|\/home\//, `${f} has a local path`);
    assert.doesNotMatch(text, /api[_-]?key|bearer|hf_[A-Za-z0-9]{20}|sk-[A-Za-z0-9]{20}/i, `${f} has a secret`);
    assert.doesNotMatch(text, /"class_type":\s*"[^"]*(Api|Partner)Node/i, `${f} uses an API node`);
    assert.ok(summarizeGraph(g).nodeCount === Object.keys(g).length, `${f}: every node reachable in order`);
  }
});
