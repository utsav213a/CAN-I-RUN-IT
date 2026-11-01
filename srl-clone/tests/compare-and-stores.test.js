'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { Catalogue, letterOf } = require('../server/store');
const { ReportStore, TOKEN_PATTERN } = require('../server/reports');
const { Stats } = require('../server/stats');
const compare = require('../server/compare');
const { sanitizeScan } = require('../shared/sanitize');
const { importRows, parseCsv } = require('../scripts/import-games');

const DATA = path.join(__dirname, '..', 'data');
const catalogue = Catalogue.fromDir(DATA);
const db = catalogue.db;
const elden = catalogue.getGame('elden-ring');

function spec(overrides = {}) {
  return sanitizeScan({
    cpu: { name: 'Intel(R) Core(TM) i5-8400 CPU @ 2.80GHz' },
    gpus: [{ name: 'NVIDIA GeForce GTX 1060 6GB', vramMB: 6144 }],
    ramGB: 16,
    os: { name: 'Microsoft Windows 10 Pro', version: '10.0.19045' },
    storage: [{ type: 'SSD', freeGB: 200 }],
    directX: 12,
    vulkan: true,
    ...overrides,
  });
}

const strong = () => spec({
  cpu: { name: 'Intel(R) Core(TM) i7-8700K CPU @ 3.70GHz' },
  gpus: [{ name: 'NVIDIA GeForce GTX 1070', vramMB: 8192 }],
  ramGB: 16,
});

test('findHardware resolves Windows-style names to catalogue entries', () => {
  assert.equal(compare.findHardware(db, db.cpus, 'Intel(R) Core(TM) i5-8400 CPU @ 2.80GHz', false).name, 'Intel Core i5-8400');
  assert.match(compare.findHardware(db, db.gpus, 'NVIDIA GeForce GTX 1060 6GB', true).name, /GTX 1060/);
  assert.match(compare.findHardware(db, db.gpus, 'AMD Radeon(TM) RX 580 Series', true).name, /RX 580$/);
});

test('findHardware does not confuse RX 580 with RX 5800 or RTX 3060 with RTX 3060 Ti', () => {
  assert.equal(compare.findHardware(db, db.gpus, 'AMD Radeon RX 5800 XT', true), null);
  assert.match(compare.findHardware(db, db.gpus, 'NVIDIA GeForce RTX 3060 Ti', true).name, /RTX 3060 Ti$/);
  assert.match(compare.findHardware(db, db.gpus, 'NVIDIA GeForce RTX 3060', true).name, /RTX 3060$/);
});

test('benchmark components carry the matched name, score and requirement for the 3D chart', () => {
  const r = compare.checkGame(elden, strong(), db);
  const cpu = r.minimum.components.find((c) => c.id === 'cpu');
  assert.equal(cpu.hardware, 'Intel Core i7-8700K');
  assert.equal(typeof cpu.score, 'number');
  assert.equal(typeof cpu.requiredScore, 'number');
});

test('a strong PC gets the recommended verdict for Elden Ring', () => {
  const r = compare.checkGame(elden, strong(), db);
  assert.equal(r.verdict.level, 'recommended');
  assert.equal(r.minimum.pass, true);
  assert.equal(r.recommended.pass, true);
});

test('a weak PC fails the minimum tier and gets upgrade suggestions', () => {
  const weak = spec({
    cpu: { name: 'Intel Core i5-4690' },
    gpus: [{ name: 'NVIDIA GeForce GTX 660', vramMB: 2048 }],
    ramGB: 8,
  });
  const r = compare.checkGame(elden, weak, db);
  assert.equal(r.verdict.level, 'fail');
  const failing = r.minimum.components.filter((c) => c.status === 'fail').map((c) => c.id).sort();
  assert.deepEqual(failing, ['cpu', 'gpu', 'ram', 'vram'].sort());
  const upgradeIds = r.upgrades.map((u) => u.component);
  assert.ok(upgradeIds.includes('cpu') && upgradeIds.includes('gpu') && upgradeIds.includes('ram'));
  const cpuUpgrade = r.upgrades.find((u) => u.component === 'cpu');
  assert.ok(cpuUpgrade.options.length > 0 && cpuUpgrade.options.every((o) => o.name));
});

test('upgrade suggestions for recommended-only failures use the recommended spec', () => {
  const mid = spec({
    cpu: { name: 'Intel Core i5-8400' },
    gpus: [{ name: 'NVIDIA GeForce GTX 1060 6GB', vramMB: 6144 }],
    ramGB: 16,
  });
  const r = compare.checkGame(elden, mid, db);
  assert.equal(r.verdict.level, 'minimum');
  const cpu = r.upgrades.find((u) => u.component === 'cpu');
  assert.equal(cpu.tier, 'recommended');
  // Every option must meet the recommended CPU score (the easier of the two alternatives).
  const recScore = compare.requiredScore(db, db.cpus, elden.requirements.recommended.cpu.alternatives, false);
  assert.ok(cpu.options.length > 0 && cpu.options.every((o) => db.cpus.find((c) => c.name === o.name).score >= recScore));
  const vram = r.upgrades.find((u) => u.component === 'vram');
  assert.equal(vram.tier, 'recommended');
  assert.match(vram.text, /8 GB/);
});

test('a mid PC meets minimum but not recommended', () => {
  const mid = spec({
    cpu: { name: 'Intel Core i5-8400' },
    gpus: [{ name: 'NVIDIA GeForce GTX 1060 6GB', vramMB: 6144 }],
    ramGB: 12,
  });
  const r = compare.checkGame(elden, mid, db);
  assert.equal(r.verdict.level, 'minimum');
});

test('unknown hardware gives an unknown verdict, never a false fail', () => {
  const exotic = spec({ cpu: { name: 'Acme Quantum 9000' }, gpus: [{ name: 'Acme Ultra Graphics', vramMB: 16384 }] });
  const r = compare.checkGame(elden, exotic, db);
  const cpu = r.minimum.components.find((c) => c.id === 'cpu');
  assert.equal(cpu.status, 'unknown');
  assert.notEqual(r.verdict.level, 'fail');
  assert.equal(r.verdict.level, 'unknown');
});

test('non-Windows systems fail the OS check with a clear note', () => {
  const mac = spec({ os: { name: 'macOS', version: '14.5' } });
  const r = compare.checkGame(elden, mac, db);
  const osRow = r.minimum.components.find((c) => c.id === 'os');
  assert.equal(osRow.status, 'fail');
  assert.match(osRow.note, /requires Windows/);
  assert.equal(r.verdict.level, 'fail');
});

test('Windows 7 fails the Windows 10 requirement', () => {
  const r = compare.checkGame(elden, spec({ os: { name: 'Windows 7 Ultimate', version: '6.1.7601' } }), db);
  assert.equal(r.minimum.components.find((c) => c.id === 'os').status, 'fail');
});

test('missing Vulkan fails only when the game requires it', () => {
  const game = { ...elden, slug: 'x', requirements: { minimum: { ...elden.requirements.minimum, vulkan: true }, recommended: null } };
  const r = compare.checkGame(game, spec({ vulkan: false }), db);
  assert.equal(r.minimum.components.find((c) => c.id === 'vulkan').status, 'fail');
  const r2 = compare.checkGame(elden, spec({ vulkan: false }), db);
  assert.equal(r2.minimum.components.find((c) => c.id === 'vulkan').status, 'na');
});

test('recommendPcs returns only PCs that meet at least the minimum', () => {
  const pcs = compare.recommendPcs(db, elden, 10);
  assert.ok(pcs.length > 0);
  for (const pc of pcs) assert.ok(['recommended', 'minimum'].includes(pc.meets));
  // "recommended" matches come before "minimum" matches.
  const firstMinimum = pcs.findIndex((pc) => pc.meets === 'minimum');
  if (firstMinimum >= 0) assert.ok(pcs.slice(firstMinimum).every((pc) => pc.meets === 'minimum'));
});

test('runScore counts games and never exceeds the total', () => {
  const s = compare.runScore(db, catalogue.games, strong());
  assert.equal(s.totalGames, catalogue.games.length);
  assert.ok(s.canRunMinimum >= s.canRunRecommended);
  assert.ok(s.canRunMinimum <= s.totalGames);
});

test('ReportStore expires results after the TTL and rejects malformed tokens', () => {
  let now = 1_000_000;
  const store = new ReportStore({ ttlMs: 1000, now: () => now });
  const { token } = store.create(strong());
  assert.match(token, TOKEN_PATTERN);
  assert.equal(store.get(token).status, 'ok');
  now += 1001;
  assert.equal(store.get(token).status, 'expired');
  assert.equal(store.get(token).status, 'missing');
  assert.equal(store.get('../../etc/passwd').status, 'invalid');
  assert.equal(store.get(undefined).status, 'invalid');
});

test('ReportStore purges old entries and caps its size', () => {
  let now = 0;
  const store = new ReportStore({ ttlMs: 100, maxEntries: 3, now: () => now });
  store.create(strong());
  store.create(strong());
  now = 50;
  store.create(strong());
  store.create(strong()); // evicts the oldest
  assert.equal(store.size, 3);
  now = 120;
  store.purge();
  assert.equal(store.size, 2);
});

test('Stats records anonymous counts and computes pass percentages', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'srl-stats-'));
  const file = path.join(dir, 'stats.json');
  const stats = new Stats(file);
  stats.recordScan();
  stats.recordCheck('elden-ring', 'recommended');
  stats.recordCheck('elden-ring', 'fail');
  assert.equal(stats.gameStats('elden-ring').passPct, 50);
  const again = new Stats(file);
  assert.equal(again.summary().totalScans, 1);
  const json = fs.readFileSync(file, 'utf8');
  assert.ok(!/ip|token|cpu/i.test(json), 'stats file must contain only aggregates');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Catalogue search ranks prefix matches first and handles empty queries', () => {
  assert.deepEqual(catalogue.search(''), []);
  const hits = catalogue.search('e', 10).map((g) => g.slug);
  assert.equal(hits[0].startsWith('e'), true);
  assert.equal(catalogue.search('elden').length, 1);
  assert.equal(catalogue.search('Elden RING')[0].slug, 'elden-ring');
});

test('Catalogue browse filters by letter and paginates', () => {
  const e = catalogue.browse({ letter: 'E' });
  assert.ok(e.items.every((g) => g.name.toUpperCase().startsWith('E')));
  const page = catalogue.browse({ page: 2, pageSize: 1 });
  assert.equal(page.items.length, 1);
  assert.equal(page.page, 2);
  assert.equal(letterOf('2K Games'), '#');
});

test('importer parses CSV with quoted commas and merges by slug', () => {
  const rows = parseCsv('name,releaseDate,source,minimum,recommended\n"Test, The Game",2024-01-01,unit,"OS: Windows 10 Processor: Intel Core i3-3217U Memory: 4 GB Graphics: GTX 660",\n');
  assert.equal(rows[0].name, 'Test, The Game');
  const existing = [{ id: 7, slug: 'test-the-game', name: 'Test, The Game', addedAt: '2020-01-01T00:00:00.000Z', requirements: {} }];
  const { games, report } = importRows(rows, existing);
  assert.equal(report.updated, 1);
  assert.equal(report.added, 0);
  const g = games.find((x) => x.slug === 'test-the-game');
  assert.equal(g.id, 7);
  assert.equal(g.addedAt, '2020-01-01T00:00:00.000Z');
  assert.equal(g.requirements.minimum.gpu.alternatives[0], 'GTX 660');
});

test('importer skips rows without a name or minimum requirements', () => {
  const { report } = importRows([{ name: '', minimum: 'x' }, { name: 'No Reqs', minimum: '' }]);
  assert.equal(report.skipped.length, 2);
});
