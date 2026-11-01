'use strict';

// Benchmark import (Blender Open Data), SteamSpy popularity list, and the "compare nearby" API.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bench = require('../scripts/build-benchmarks');
const popular = require('../scripts/steam-popular');
const { start } = require('../server/index');

test('requirement alternatives drop clock speeds and feature lines', () => {
  const { alternatives } = require('../server/parser');
  assert.deepEqual(alternatives('Intel Core i5-750, 2.67 GHz'), ['Intel Core i5-750']);
  assert.deepEqual(alternatives('Shader 3.0 | GeForce GTX 660'), ['GeForce GTX 660']);
  assert.deepEqual(alternatives('DirectX 9.0c'), []);
});

// ---- Blender Open Data records ------------------------------------------------

function run(seconds, deviceType, devices, label = 'bmw27') {
  return { scene: { label }, stats: { total_render_time: seconds }, device_info: { device_type: deviceType, compute_devices: devices } };
}

test('observationsFrom keeps single-device CPU and GPU runs of the standard scene only', () => {
  const record = {
    data: [
      run(100, 'CPU', [{ type: 'CPU', name: 'Intel Core i5-8400 CPU @ 2.80GHz' }, { type: 'CPU', name: 'Intel Core i5-8400 CPU @ 2.80GHz' }]),
      run(50, 'CUDA', [{ type: 'CUDA', name: 'GeForce GTX 1060 6GB' }, { type: 'CPU', name: 'Intel Core i5-8400 CPU @ 2.80GHz' }]),
      run(10, 'CPU', [{ type: 'CPU', name: 'Other' }], 'other-scene'),
      run(10, 'OPTIX', [{ type: 'OPTIX', name: 'A' }, { type: 'OPTIX', name: 'B' }]),
      run(0, 'CPU', [{ type: 'CPU', name: 'Zero' }]),
    ],
  };
  const obs = bench.observationsFrom(record);
  assert.deepEqual(obs, [
    { kind: 'cpu', name: 'Intel Core i5-8400', seconds: 100 },
    { kind: 'gpu', name: 'GeForce GTX 1060 6GB', seconds: 50 },
  ]);
  assert.deepEqual(bench.observationsFrom({ data: 'not a list' }), []);
});

test('names are cleaned and variants of one model group together', () => {
  assert.equal(bench.cleanCpuName('AMD Ryzen 3 3100 4-Core Processor'), 'AMD Ryzen 3 3100');
  assert.equal(bench.cleanCpuName('Intel(R) Core(TM) i5-8400 CPU @ 2.80GHz'), 'Intel Core i5-8400');
  assert.deepEqual(bench.aliasesFor('Intel Core i5-8400', 'cpu'), ['Core i5-8400', 'i5-8400']);
  assert.deepEqual(bench.aliasesFor('NVIDIA GeForce GTX 1060 6GB', 'gpu'), ['GeForce GTX 1060', 'GTX 1060']);

  const group = new Map();
  const add = (key, name, seconds) => {
    if (!group.has(key)) group.set(key, { names: new Map(), seconds: [] });
    const e = group.get(key);
    e.names.set(name, (e.names.get(name) || 0) + 1);
    e.seconds.push(...seconds);
  };
  add('g1', 'GeForce GTX 660', [100, 100, 100, 100, 100]);
  add('g1', 'NVIDIA GeForce GTX 660', [100]);
  add('g2', 'Radeon RX 580', [50, 50, 50, 50, 50]);
  add('g3', 'AMD Radeon', [10, 10, 10, 10, 10]); // no model number: left out
  add('g4', 'Thin', [10, 10]); // too few runs: left out
  const rows = bench.toEntries(group, 'gpu', new Map());
  assert.equal(rows.length, 2);
  const gtx = rows.find((r) => /GTX 660/.test(r.name));
  assert.equal(gtx.runs, 6);
  assert.equal(gtx.score, Math.round(100000 / 100));
  assert.equal(rows.find((r) => /RX 580/.test(r.name)).score, 2000);
});

test('median and video memory helpers', () => {
  assert.equal(bench.median([3, 1, 2]), 2);
  assert.equal(bench.median([4, 1, 2, 3]), 2.5);
  assert.equal(bench.vramMBFor('GeForce GTX 1060 6GB', new Map()), 6144);
  assert.equal(bench.vramMBFor('NVIDIA GeForce RTX 3060', new Map([['geforcertx3060', 12]])), 12288);
  assert.equal(bench.vramMBFor('Unknown Card', new Map()), null);
});

// ---- SteamSpy popularity list --------------------------------------------------

test('SteamSpy rows are ranked by the lower bound of owners, without the hidden-data app', () => {
  assert.equal(popular.ownersFloor('20,000,000 .. 50,000,000'), 20000000);
  const ranked = popular.toRanked({
    10: { name: 'Small', owners: '1,000 .. 2,000' },
    20: { name: 'Big', owners: '5,000,000 .. 10,000,000' },
    999999: { name: 'Hidden', owners: '0 .. 0' },
    30: { name: '', owners: '9 .. 9' },
  });
  assert.deepEqual(ranked.map((r) => r.name), ['Big', 'Small']);
});

// ---- "Compare nearby" API ------------------------------------------------------

const ROOT = path.join(__dirname, '..');
let srv;
let base;
let tmpDir;

test.before(async () => {
  process.env.SRL_NO_BROWSER = '1';
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srl-bench-'));
  srv = await start({
    port: 0,
    host: '127.0.0.1',
    dataDir: path.join(ROOT, 'data'),
    publicDir: path.join(ROOT, 'public'),
    statsFile: path.join(tmpDir, 'stats.json'),
    affiliateTag: 'testtag-20',
  });
  base = `http://127.0.0.1:${srv.port}`;
});

test.after(() => {
  srv.server.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('nearby returns the part and its neighbours in score order, with the part flagged', async () => {
  const res = await fetch(`${base}/api/hardware/gpus/nearby?name=GTX%201060&radius=2`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.kind, 'gpus');
  assert.match(body.target.name, /GTX 1060/);
  const targets = body.items.filter((i) => i.target);
  assert.equal(targets.length, 1);
  assert.equal(targets[0].name, body.target.name);
  assert.ok(body.items.length <= 5);
  const scores = body.items.map((i) => i.score);
  assert.deepEqual(scores, [...scores].sort((a, b) => a - b));
});

test('nearby rejects unknown parts and an out-of-range radius is clamped', async () => {
  const missing = await fetch(`${base}/api/hardware/cpus/nearby?name=Acme%20Quantum%209000`);
  assert.equal(missing.status, 404);
  const wide = await (await fetch(`${base}/api/hardware/cpus/nearby?name=Intel%20Core%20i5-8400&radius=999`)).json();
  assert.ok(wide.items.length <= 21);
});
