'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRequirements, parseGameRequirements, alternatives, toGB, toMB } = require('../server/parser');
const { normName, stripVram, slugify } = require('../shared/names');
const { sanitizeScan, validateScan } = require('../shared/sanitize');

test('slugify matches the site style (apostrophes dropped, hyphens)', () => {
  assert.equal(slugify("Baldur's Gate 3"), 'baldurs-gate-3');
  assert.equal(slugify('Call of Duty: Modern Warfare 4'), 'call-of-duty-modern-warfare-4');
});

test('normName ignores (R)/(TM), CPU word and clock speed', () => {
  assert.equal(normName('Intel(R) Core(TM) i5-8400 CPU @ 2.80GHz'), normName('Intel Core i5-8400'));
  assert.equal(stripVram('NVIDIA GeForce GTX 1060 6GB'), 'NVIDIA GeForce GTX 1060 ');
});

test('toGB and toMB convert units', () => {
  assert.equal(toGB('12 GB RAM'), 12);
  assert.equal(toGB('8192 MB'), 8);
  assert.equal(toMB('3 GB (4GB AMD)'), 3072);
  assert.equal(toMB('no memory here'), null);
});

test('alternatives split on pipes, "or", and newlines', () => {
  assert.deepEqual(alternatives('Intel Core i5-8400 | AMD Ryzen 3 3300X'), ['Intel Core i5-8400', 'AMD Ryzen 3 3300X']);
  assert.deepEqual(alternatives('GTX 970 or RX 480'), ['GTX 970', 'RX 480']);
});

test('parses a full requirements block into structured fields', () => {
  const r = parseRequirements(
    'OS: Windows 10 64-bit Processor: Intel Core i5-8400 | AMD Ryzen 3 3300X ' +
    'Memory: 12 GB RAM Graphics: Nvidia GeForce GTX 1060, 3GB | AMD Radeon RX 580, 4GB ' +
    'Video RAM: 3 GB Storage: 60 GB available DirectX: Version 12'
  );
  assert.equal(r.os.minVersion, 10);
  assert.deepEqual(r.cpu.alternatives, ['Intel Core i5-8400', 'AMD Ryzen 3 3300X']);
  assert.equal(r.ramGB, 12);
  assert.deepEqual(r.gpu.alternatives, ['Nvidia GeForce GTX 1060', 'AMD Radeon RX 580']);
  assert.equal(r.gpu.vramMB, 3072);
  assert.equal(r.storageGB, 60);
  assert.equal(r.directX, 12);
});

test('store HTML is converted to label lines, and filler is dropped from lists', () => {
  const { htmlToText } = require('../server/parser');
  const text = htmlToText('<strong>Minimum:</strong><br><ul><li><strong>OS:</strong> Windows&reg; 10<br></li><li><strong>Processor:</strong> INTEL CORE I5-8400 or AMD RYZEN 3 3300X<br></li><li><strong>Graphics:</strong> NVIDIA GEFORCE GTX 1060 3 GB or AMD RADEON RX 580 4 GB</li></ul>');
  const r = parseRequirements(text);
  assert.equal(r.os.minVersion, 10);
  assert.deepEqual(r.cpu.alternatives, ['INTEL CORE I5-8400', 'AMD RYZEN 3 3300X']);
  assert.equal(r.gpu.alternatives.length, 2);
  const cs = parseRequirements('Processor: 4 hardware CPU threads - Intel Core i5 750 or higher\nGraphics: Video card must be 1 GB,more and should be a DirectX 11-compatible card');
  assert.deepEqual(cs.cpu.alternatives, ['4 hardware CPU threads - Intel Core i5 750']);
  assert.deepEqual(cs.gpu.alternatives, []);
});

test('parser handles "Vulkan" and missing fields without throwing', () => {
  const r = parseRequirements('Processor: Intel Core i3-3217U\nVulkan: required');
  assert.equal(r.vulkan, true);
  assert.equal(r.ramGB, null);
  assert.equal(r.os, null);
});

test('parseGameRequirements reports missing CPU/GPU as warnings', () => {
  const { warnings } = parseGameRequirements({ minimum: 'Memory: 8 GB', recommended: null });
  assert.ok(warnings.some((w) => w.includes('processor')));
  assert.ok(warnings.some((w) => w.includes('graphics')));
});

test('sanitizeScan keeps only allowed fields and drops identifiers', () => {
  const dirty = {
    cpu: { name: 'Intel Core i5-8400', cores: 6, threads: 6, speedMHz: 2800, processorId: 'BFEBFBFF000906EA' },
    gpus: [{ name: 'GTX 1060', vramMB: 6144, pnpDeviceId: 'PCI\\VEN_10DE' }],
    ramGB: 16,
    os: { name: 'Windows 10 Pro', version: '10.0.19045', is64: true, serialNumber: 'ABC123', registeredUser: 'alice' },
    computerName: 'ALICES-PC',
    userName: 'alice',
    ipAddress: '192.168.1.20',
    macAddress: '00:11:22:33:44:55',
    productKey: 'XXXXX-XXXXX',
    installedSoftware: ['Steam'],
    storage: [{ type: 'SSD', freeGB: 100, serial: 'S3RIAL', drive: 'C:' }],
    location: { lat: 1, lon: 2 },
  };
  const s = sanitizeScan(dirty);
  const json = JSON.stringify(s);
  for (const secret of ['BFEBFBFF', 'PCI', 'ABC123', 'alice', 'ALICES-PC', '192.168', '00:11', 'XXXXX', 'Steam', 'S3RIAL', 'lat']) {
    assert.ok(!json.includes(secret), `leaked: ${secret}`);
  }
  assert.equal(s.cpu.name, 'Intel Core i5-8400');
  assert.equal(s.storage[0].type, 'SSD');
});

test('sanitizeScan clamps and rejects bad numbers and unknown storage types', () => {
  const s = sanitizeScan({ cpu: { name: 'X', cores: -4 }, ramGB: 'lots', storage: [{ type: 'Floppy', freeGB: 'NaN' }], directX: 'twelve' });
  assert.equal(s.cpu.cores, null);
  assert.equal(s.ramGB, null);
  assert.equal(s.storage[0].type, 'Unknown');
  assert.equal(s.storage[0].freeGB, null);
  assert.equal(s.directX, null);
});

test('sanitizeScan truncates long strings and strips control characters', () => {
  const s = sanitizeScan({ cpu: { name: 'A'.repeat(500) + '\u0007' } });
  assert.equal(s.cpu.name.length, 120);
  assert.ok(!/[\u0000-\u001f]/.test(s.cpu.name));
});

test('validateScan requires CPU, RAM and a GPU', () => {
  const ok = sanitizeScan({ cpu: { name: 'i5' }, ramGB: 8, gpus: [{ name: 'GTX 1060' }] });
  assert.equal(validateScan(ok), null);
  assert.match(validateScan(sanitizeScan({ ramGB: 8, gpus: [{ name: 'x' }] })), /CPU/);
  assert.match(validateScan(sanitizeScan({ cpu: { name: 'i5' }, gpus: [{ name: 'x' }] })), /RAM/);
  assert.match(validateScan(sanitizeScan({ cpu: { name: 'i5' }, ramGB: 8 })), /GPU/);
});
