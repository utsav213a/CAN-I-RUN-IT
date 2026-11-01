'use strict';

// HTTP-level tests: start the real server on an ephemeral port with a temp stats file.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { start } = require('../server/index');

const ROOT = path.join(__dirname, '..');
let srv;
let base;
let tmpDir;

test.before(async () => {
  process.env.SRL_NO_BROWSER = '1';
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srl-api-'));
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

async function call(method, url, body) {
  const res = await fetch(base + url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { json = null; }
  return { status: res.status, json, text, headers: res.headers };
}

const SCAN = {
  cpu: { name: 'Intel(R) Core(TM) i7-8700K CPU @ 3.70GHz', cores: 6, threads: 12 },
  gpus: [{ name: 'NVIDIA GeForce GTX 1070', vramMB: 8192 }],
  ramGB: 16,
  os: { name: 'Microsoft Windows 11 Pro', version: '10.0.22631' },
  storage: [{ type: 'NVMe', freeGB: 300 }],
  directX: 12,
  vulkan: true,
  resolution: { width: 2560, height: 1440 },
  email: 'should-be-dropped@example.com',
  userName: 'should-be-dropped',
};

test('health and stats respond', async () => {
  const h = await call('GET', '/api/health');
  assert.equal(h.status, 200);
  assert.equal(h.json.ok, true);
  assert.ok(h.json.games >= 3);
  const s = await call('GET', '/api/stats');
  assert.equal(typeof s.json.totalScans, 'number');
});

test('autocomplete returns matches and empty array for blank query', async () => {
  const r = await call('GET', '/api/games/search?q=elden');
  assert.equal(r.json.results[0].slug, 'elden-ring');
  const empty = await call('GET', '/api/games/search?q=');
  assert.deepEqual(empty.json.results, []);
});

test('game requirements page data includes min and recommended', async () => {
  const r = await call('GET', '/api/games/elden-ring');
  assert.equal(r.status, 200);
  assert.ok(r.json.requirements.minimum.cpu);
  assert.ok(r.json.requirements.recommended);
});

test('unknown game and unknown endpoint return JSON errors', async () => {
  const g = await call('GET', '/api/games/does-not-exist');
  assert.equal(g.status, 404);
  assert.ok(g.json.error);
  const u = await call('GET', '/api/nope');
  assert.equal(u.status, 404);
});

test('wrong method returns 405', async () => {
  const r = await call('DELETE', '/api/games/elden-ring');
  assert.equal(r.status, 405);
});

test('A–Z browse, letters and recently added', async () => {
  const letters = await call('GET', '/api/games/letters');
  assert.ok(letters.json.letters.some((l) => l.letter === 'E'));
  const e = await call('GET', '/api/games?letter=E');
  assert.ok(e.json.items.every((g) => g.name.toUpperCase().startsWith('E')));
  const recent = await call('GET', '/api/games/recent');
  assert.ok(Array.isArray(recent.json.items));
});

test('scan upload strips identifiers and returns an anonymous token', async () => {
  const r = await call('POST', '/api/scan', { scan: SCAN });
  assert.equal(r.status, 200);
  assert.match(r.json.token, /^[A-Za-z0-9_-]{22}$/);
  const got = await call('GET', `/api/scan/${r.json.token}`);
  assert.equal(got.status, 200);
  assert.ok(!JSON.stringify(got.json).includes('should-be-dropped'));
  assert.equal(got.json.scan.cpu.name, SCAN.cpu.name);
  globalThis.__token = r.json.token;
});

test('invalid scan payloads are rejected with 400', async () => {
  const r = await call('POST', '/api/scan', { scan: { ramGB: 8 } });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /CPU/);
  const bad = await call('POST', '/api/scan', '{not json');
  assert.equal(bad.status, 400);
});

test('unknown and malformed tokens return 404', async () => {
  assert.equal((await call('GET', '/api/scan/AAAAAAAAAAAAAAAAAAAAAA')).status, 404);
  assert.equal((await call('GET', '/api/scan/short')).status, 404);
});

test('token-based comparison returns a verdict, components, upgrades and PCs', async () => {
  const r = await call('POST', '/api/games/elden-ring/compare', { token: globalThis.__token });
  assert.equal(r.status, 200);
  assert.equal(r.json.verdict.level, 'recommended');
  assert.ok(r.json.minimum.components.length > 0);
  assert.ok(Array.isArray(r.json.recommendedPcs));
  for (const pc of r.json.recommendedPcs) assert.ok(pc.url.includes('testtag-20'), 'affiliate tag applied');
});

test('the same comparison through the generic endpoint works', async () => {
  const r = await call('POST', '/api/compare', { slug: 'elden-ring', token: globalThis.__token });
  assert.equal(r.status, 200);
  assert.equal(r.json.slug, 'elden-ring');
});

test('manual spec comparison, including non-Windows and approximate flags', async () => {
  const mac = await call('POST', '/api/compare', {
    slug: 'elden-ring',
    spec: { cpu: { name: 'Apple M2' }, gpus: [{ name: 'Apple M2 GPU' }], ramGB: 16, os: { name: 'macOS', version: '14' } },
  });
  assert.equal(mac.status, 200);
  assert.equal(mac.json.verdict.level, 'fail');
  const approx = await call('POST', '/api/compare', {
    slug: 'elden-ring',
    spec: { approximate: true, cpu: { name: 'Intel Core i5-8400' }, gpus: [{ name: 'GTX 1060' }], ramGB: 8, os: { name: 'Windows', version: '10.0' } },
  });
  assert.equal(approx.json.approximate, true);
});

test('expired and missing tokens are reported as 410/404 on compare', async () => {
  const r = await call('POST', '/api/compare', { slug: 'elden-ring', token: 'AAAAAAAAAAAAAAAAAAAAAA' });
  assert.equal(r.status, 404);
  const bad = await call('POST', '/api/compare', { slug: 'elden-ring', token: 'not valid!' });
  assert.equal(bad.status, 400);
});

test('token-based checks are counted in anonymous popular stats', async () => {
  const pop = await call('GET', '/api/popular');
  const e = pop.json.items.find((x) => x.slug === 'elden-ring');
  assert.ok(e && e.views >= 1);
  assert.equal(typeof e.passPct, 'number');
});

test('Cyri-style score endpoint and lists with verdicts', async () => {
  const score = await call('POST', '/api/score', { token: globalThis.__token });
  assert.equal(score.status, 200);
  assert.ok(score.json.score.totalGames >= 3);
  const list = await call('GET', `/api/lists/1?token=${globalThis.__token}`);
  assert.equal(list.status, 200);
  assert.ok(list.json.games.every((g) => g.verdict && g.verdict.level));
  const noToken = await call('GET', '/api/lists/1');
  assert.equal(noToken.json.games[0].verdict, undefined);
  assert.equal((await call('GET', '/api/lists/999')).status, 404);
});

test('hardware lookup and PC catalogue', async () => {
  const cpus = await call('GET', '/api/hardware/cpus?q=ryzen');
  assert.ok(cpus.json.items.length > 0);
  const pcs = await call('GET', '/api/pcs');
  assert.ok(pcs.json.items.every((p) => p.url.includes('testtag-20')));
});

test('static pages are served with security headers, and unknown routes fall back to the app shell', async () => {
  const home = await call('GET', '/');
  assert.equal(home.status, 200);
  assert.match(home.text, /<title>Can I Run It/);
  assert.match(home.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(home.headers.get('x-content-type-options'), 'nosniff');
  const js = await call('GET', '/app.js');
  assert.match(js.headers.get('content-type'), /javascript/);
  const route = await call('GET', '/#/game/elden-ring');
  assert.equal(route.status, 200);
});

test('path traversal attempts never return files outside public/', async () => {
  const r = await call('GET', '/%2e%2e/package.json');
  assert.ok(!r.text.includes('"srl-clone"'));
  const r2 = await call('GET', '/..%5C..%5Cpackage.json');
  assert.ok(!r2.text.includes('"srl-clone"'));
});

test('oversized request bodies are rejected', async () => {
  const big = 'x'.repeat(300 * 1024);
  const res = await fetch(base + '/api/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scan: { cpu: { name: big } } }) }).catch(() => null);
  if (res) assert.equal(res.status, 413);
});
