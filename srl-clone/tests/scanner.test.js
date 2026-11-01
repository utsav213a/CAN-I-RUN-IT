'use strict';

// Scanner tests: argument parsing, preview page, and the send/save flow against a live server.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { parseArgs, DEMO_SCAN, previewPage, startPreview, saveJson, collectHardware, PS_SCRIPT } = require('../scanner/scan');
const { start } = require('../server/index');

const ROOT = path.join(__dirname, '..');
let srv;
let base;
let workDir;
let originalCwd;

test.before(async () => {
  process.env.SRL_NO_BROWSER = '1';
  originalCwd = process.cwd();
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srl-scanner-'));
  srv = await start({
    port: 0,
    host: '127.0.0.1',
    dataDir: path.join(ROOT, 'data'),
    publicDir: path.join(ROOT, 'public'),
    statsFile: path.join(workDir, 'stats.json'),
  });
  base = `http://127.0.0.1:${srv.port}`;
  process.chdir(workDir);
});

test.after(() => {
  process.chdir(originalCwd);
  srv.server.close();
  fs.rmSync(workDir, { recursive: true, force: true });
});

test('argument parsing supports every documented flag and rejects unknown ones', () => {
  assert.equal(parseArgs(['--local']).local, true);
  assert.equal(parseArgs(['--print']).print, true);
  assert.equal(parseArgs(['--demo']).demo, true);
  assert.equal(parseArgs(['--server', 'http://x:1']).server, 'http://x:1');
  assert.throws(() => parseArgs(['--upload-everything']), /Unknown option/);
});

test('the PowerShell script reads only the allowed fields', () => {
  for (const forbidden of ['SerialNumber', 'UserName', 'MACAddress', 'IPAddress', 'ProcessorId', 'PNPDeviceID', 'Win32_Product', 'ProductKey', 'Get-ChildItem -Path $env:USERPROFILE']) {
    assert.ok(!PS_SCRIPT.includes(forbidden), `script must not reference ${forbidden}`);
  }
});

test('demo collection returns a valid sanitised scan on any OS', async () => {
  const s = await collectHardware({ demo: true });
  assert.equal(s.cpu.name, DEMO_SCAN.cpu.name);
  assert.equal(s.ramGB, 16);
});

test('collection on a non-Windows system explains what to do', async () => {
  if (process.platform === 'win32') return; // only meaningful off Windows
  await assert.rejects(collectHardware({}), /Use --demo/);
});

test('preview page shows the exact payload and a CSRF secret path', () => {
  const html = previewPage(DEMO_SCAN, 'abc');
  assert.match(html, /Nothing has been sent yet/);
  assert.ok(html.includes('&quot;') || html.includes('"cpu"'));
  assert.ok(html.includes('Intel(R) Core(TM) i5-8400'));
  // The page must build action URLs without a doubled slash (the secret path ends with "/").
  assert.match(html, /location\.pathname\.replace\(/);
  const script = html.slice(html.indexOf('<script>'), html.indexOf('</script>'));
  assert.ok(!/base \+ kind/.test(script) || /replace/.test(script));
});

test('preview server: page loads, wrong paths are refused, send uploads and returns a token', async () => {
  const preview = await startPreview(DEMO_SCAN, { server: base, log: () => {}, onDone: () => {} });
  const pageUrl = preview.url;
  const page = await fetch(pageUrl);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /default-src 'none'/);
  const secretBase = new URL(pageUrl).pathname.replace(/\/$/, '');

  const bad = await fetch(`http://127.0.0.1:${new URL(pageUrl).port}/nosecret/send`, { method: 'POST', body: '{}' });
  assert.equal(bad.status, 404);

  const sent = await fetch(`http://127.0.0.1:${new URL(pageUrl).port}${secretBase}/send`, { method: 'POST', body: '{}' });
  assert.equal(sent.status, 200);
  const body = await sent.json();
  assert.match(body.token, /^[A-Za-z0-9_-]{22}$/);
  assert.match(body.reportUrl, /#\/report\//);

  const check = await fetch(`${base}/api/scan/${body.token}`);
  assert.equal(check.status, 200);
  preview.close();
});

test('save-only writes a JSON file locally and sends nothing', () => {
  const file = saveJson(DEMO_SCAN);
  assert.ok(fs.existsSync(file));
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(parsed.generatedBy, 'SRL Hardware Check');
  assert.equal(parsed.scan.gpus[0].name, DEMO_SCAN.gpus[0].name);
});

test('--local mode runs end to end with --demo and writes a file', async () => {
  const { main } = require('../scanner/scan');
  const before = fs.readdirSync(workDir).length;
  await main(['--demo', '--local']);
  assert.equal(fs.readdirSync(workDir).length, before + 1);
});

test('--print mode prints the payload and sends nothing', async () => {
  const { main } = require('../scanner/scan');
  const lines = [];
  const orig = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  try {
    await main(['--demo', '--print']);
  } finally {
    console.log = orig;
  }
  const json = JSON.parse(lines.join('\n').slice(lines.join('\n').indexOf('{')));
  assert.ok(json.cpu);
});
