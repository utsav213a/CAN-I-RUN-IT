#!/usr/bin/env node
'use strict';

// SRL Hardware Check: a portable, one-click hardware scanner for Windows.
//
// Behaviour (by design):
//   * Collects only: CPU, GPU and VRAM, RAM, OS, storage type and free space,
//     DirectX/Vulkan, resolution.
//   * Shows the exact payload in a local preview page before anything is sent.
//   * --local: no network at all; saves the report as JSON next to the program.
//   * No installer, no background service, no startup entry, no registry writes.
//   * The process exits by itself when finished (idle timeout otherwise).
//
// Usage:
//   SRL-Hardware-Check.exe                 scan, preview, then send or save
//   SRL-Hardware-Check.exe --local         scan and save JSON only (no network)
//   SRL-Hardware-Check.exe --print         print the payload to stdout and exit
//   SRL-Hardware-Check.exe --server URL    send to a different server
//   SRL-Hardware-Check.exe --demo          use fixed sample data (for testing on any OS)

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { sanitizeScan, validateScan } = require('../shared/sanitize');

const DEFAULT_SERVER = process.env.SRL_SERVER || 'http://127.0.0.1:3000';
const PREVIEW_IDLE_MS = 10 * 60 * 1000;
const EXIT_AFTER_ACTION_MS = 60 * 1000;

// ----------------------------------------------------------------------------
// Collection (Windows). Every field below is one the product is allowed to read.
// ----------------------------------------------------------------------------
const PS_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$cpu = Get-CimInstance -ClassName Win32_Processor | Select-Object -First 1
$cs = Get-CimInstance -ClassName Win32_ComputerSystem
$os = Get-CimInstance -ClassName Win32_OperatingSystem
$vc = @(Get-CimInstance -ClassName Win32_VideoController)
$classKey = 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}'
$regVram = @{}
Get-ChildItem -Path $classKey | ForEach-Object {
  $p = Get-ItemProperty -Path $_.PSPath
  if ($p.DriverDesc) {
    $v = $p.'HardwareInformation.qwMemorySize'
    if ($v -is [byte[]] -and $v.Length -ge 8) { $v = [BitConverter]::ToInt64($v, 0) }
    if ($v) { $regVram[[string]$p.DriverDesc] = [math]::Round([double]$v / 1MB) }
  }
}
$gpus = @($vc | ForEach-Object {
  $vram = $regVram[[string]$_.Name]
  if ($null -eq $vram -and $_.AdapterRAM) { $vram = [math]::Round([double]$_.AdapterRAM / 1MB) }
  [pscustomobject]@{ name = $_.Name; vramMB = $vram }
})
$res = $vc | Where-Object { $_.CurrentHorizontalResolution } | Select-Object -First 1
$sysDrive = $env:SystemDrive
$disk = Get-CimInstance -ClassName Win32_LogicalDisk -Filter ("DeviceID='" + $sysDrive + "'")
$mediaType = 'Unknown'
try {
  $pd = Get-Partition -DriveLetter $sysDrive.Substring(0,1) | Get-Disk | Get-PhysicalDisk
  if ($pd) {
    $mediaType = [string]$pd.MediaType
    if ($pd.BusType -eq 'NVMe') { $mediaType = 'NVMe' }
  }
} catch {}
$sys32 = Join-Path $env:SystemRoot 'System32'
$dx = $null
if (Test-Path (Join-Path $sys32 'd3d12.dll')) { $dx = 12 } elseif (Test-Path (Join-Path $sys32 'd3d11.dll')) { $dx = 11 }
[pscustomobject]@{
  cpu = [pscustomobject]@{ name = $cpu.Name; cores = $cpu.NumberOfCores; threads = $cpu.NumberOfLogicalProcessors; speedMHz = $cpu.MaxClockSpeed }
  gpus = $gpus
  ramGB = [math]::Round($cs.TotalPhysicalMemory / 1GB, 1)
  os = [pscustomobject]@{ name = $os.Caption; version = $os.Version; is64 = ($os.OSArchitecture -eq '64-bit') }
  storage = @([pscustomobject]@{ type = $mediaType; freeGB = [math]::Round($disk.FreeSpace / 1GB, 1) })
  directX = $dx
  vulkan = [bool](Test-Path (Join-Path $sys32 'vulkan-1.dll'))
  resolution = if ($res) { [pscustomobject]@{ width = $res.CurrentHorizontalResolution; height = $res.CurrentVerticalResolution } } else { $null }
} | ConvertTo-Json -Depth 6 -Compress
`;

function runPowerShell(script, timeoutMs = 60000) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return reject(new Error(`PowerShell failed: ${err.message}`));
        resolve(stdout);
      }
    );
  });
}

const DEMO_SCAN = {
  cpu: { name: 'Intel(R) Core(TM) i5-8400 CPU @ 2.80GHz', cores: 6, threads: 6, speedMHz: 2800 },
  gpus: [{ name: 'NVIDIA GeForce GTX 1060 6GB', vramMB: 6144 }],
  ramGB: 16,
  os: { name: 'Microsoft Windows 10 Pro', version: '10.0.19045', is64: true },
  storage: [{ type: 'SSD', freeGB: 210.5 }],
  directX: 12,
  vulkan: true,
  resolution: { width: 1920, height: 1080 },
};

async function collectHardware({ demo = false } = {}) {
  if (demo) return sanitizeScan(DEMO_SCAN);
  if (process.platform !== 'win32') {
    throw new Error('Hardware collection needs Windows. Use --demo to test this program on another system.');
  }
  const out = await runPowerShell(PS_SCRIPT);
  const line = out.split(/\r?\n/).reverse().find((l) => l.trim().startsWith('{'));
  if (!line) throw new Error('Could not read hardware information from Windows.');
  return sanitizeScan(JSON.parse(line));
}

// ----------------------------------------------------------------------------
// Output helpers
// ----------------------------------------------------------------------------
function outputDir() {
  let sea = false;
  try { sea = require('node:sea').isSea(); } catch (e) { sea = false; }
  return sea ? path.dirname(process.execPath) : process.cwd();
}

function saveJson(scan) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(outputDir(), `srl-scan-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify({ generatedBy: 'SRL Hardware Check', scan }, null, 2));
  return file;
}

function openInBrowser(url) {
  if (process.platform !== 'win32' || process.env.SRL_NO_BROWSER === '1') return;
  execFile('rundll32', ['url.dll,FileProtocolHandler', url], { windowsHide: true }, () => {});
}

async function sendScan(server, scan) {
  const res = await fetch(new URL('/api/scan', server), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scan }),
    signal: AbortSignal.timeout(15000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Server responded ${res.status}`);
  return body;
}

// ----------------------------------------------------------------------------
// Preview page: shows the exact payload and asks what to do with it.
// ----------------------------------------------------------------------------
function previewPage(scan, secret) {
  const json = JSON.stringify(scan, null, 2)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SRL Hardware Check: preview</title>
<style>
body{font:16px/1.5 system-ui,Segoe UI,sans-serif;margin:0;background:#f5f7fa;color:#1d2430}
main{max-width:760px;margin:0 auto;padding:24px 16px}
pre{background:#fff;border:1px solid #d9dee7;border-radius:8px;padding:12px;overflow:auto;font-size:13px}
button{font:inherit;padding:10px 14px;border-radius:8px;border:1px solid #2563eb;background:#2563eb;color:#fff;cursor:pointer;margin:4px 4px 4px 0}
button.secondary{background:#fff;color:#2563eb}
button:disabled{opacity:.5}
#status{margin-top:12px;padding:10px;border-radius:8px}
.ok{background:#dcfce7}.bad{background:#fee2e2}
.muted{color:#667085;font-size:14px}
</style></head><body><main>
<h1>Preview: this is exactly what will be shared</h1>
<p class="muted">Nothing has been sent yet. Usernames, PC names, IP and MAC addresses, serial numbers, installed software and files are not part of this data.</p>
<pre>${json}</pre>
<p>
<button id="send">Send to System Requirements Lab</button>
<button id="save" class="secondary">Save as JSON only (no network)</button>
</p>
<p class="muted">Results expire after about 24 hours.</p>
<div id="status" hidden></div>
<script>
const base = location.pathname.replace(/\\/+$/, '');
async function act(kind) {
  document.getElementById('send').disabled = true;
  document.getElementById('save').disabled = true;
  const st = document.getElementById('status');
  st.hidden = false; st.className = ''; st.textContent = 'Working...';
  try {
    const res = await fetch(base + kind, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed');
    st.className = 'ok';
    st.innerHTML = kind === '/send'
      ? 'Sent. Your result token is <strong>' + data.token + '</strong>. The report is opening in your browser. This window closes automatically.'
      : 'Saved to <strong>' + data.file.replace(/&/g,'&amp;').replace(/</g,'&lt;') + '</strong>. Nothing was sent.';
  } catch (e) {
    st.className = 'bad'; st.textContent = e.message;
    document.getElementById('send').disabled = false;
    document.getElementById('save').disabled = false;
  }
}
document.getElementById('send').onclick = () => act('/send');
document.getElementById('save').onclick = () => act('/save');
</script></main></body></html>`;
}

// ----------------------------------------------------------------------------
// Local preview server (127.0.0.1 only, random path secret for CSRF protection)
// ----------------------------------------------------------------------------
function startPreview(scan, { server, onDone, log }) {
  const secret = crypto.randomBytes(16).toString('hex');
  const base = `/${secret}`;
  let exitTimer = null;
  let idleTimer = null;

  const finish = () => {
    clearTimeout(idleTimer);
    exitTimer = setTimeout(() => { httpServer.close(); onDone(); }, EXIT_AFTER_ACTION_MS);
    exitTimer.unref();
  };
  const resetIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { httpServer.close(); onDone(); }, PREVIEW_IDLE_MS);
    idleTimer.unref();
  };

  const httpServer = http.createServer(async (req, res) => {
    resetIdle();
    const send = (status, obj) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(JSON.stringify(obj));
    };
    if (req.method === 'GET' && req.url === `${base}/`) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'" });
      return res.end(previewPage(scan, secret));
    }
    if (req.method === 'POST' && (req.url === `${base}/send` || req.url === `${base}/save`)) {
      req.resume();
      try {
        if (req.url.endsWith('/save')) {
          const file = saveJson(scan);
          log(`Saved: ${file}`);
          send(200, { file });
          return finish();
        }
        const result = await sendScan(server, scan);
        const reportUrl = `${server.replace(/\/$/, '')}/${result.reportPath}`;
        log(`Result token: ${result.token}`);
        log(`Report: ${reportUrl}`);
        openInBrowser(reportUrl);
        send(200, { token: result.token, reportUrl });
        return finish();
      } catch (err) {
        return send(502, { error: `Could not send: ${err.message}` });
      }
    }
    send(404, { error: 'Not found' });
  });

  return new Promise((resolve) => {
    httpServer.listen(0, '127.0.0.1', () => {
      const url = `http://127.0.0.1:${httpServer.address().port}${base}/`;
      resetIdle();
      resolve({ url, close: () => httpServer.close() });
    });
  });
}

// ----------------------------------------------------------------------------
// Entry point
// ----------------------------------------------------------------------------
function parseArgs(argv) {
  const args = { local: false, print: false, demo: false, server: DEFAULT_SERVER };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--local') args.local = true;
    else if (a === '--print') args.print = true;
    else if (a === '--demo') args.demo = true;
    else if (a === '--server') args.server = argv[++i];
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`Unknown option: ${a}`);
  }
  return args;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log('SRL Hardware Check. Options: --local, --print, --server URL, --demo');
    return;
  }
  const log = (m) => console.log(m);
  log('Scanning your hardware...');
  const scan = await collectHardware({ demo: args.demo });
  const problem = validateScan(scan);
  if (problem) throw new Error(`Scan incomplete: ${problem}. Try again or use manual entry on the website.`);

  if (args.print) {
    console.log(JSON.stringify(scan, null, 2));
    return;
  }
  if (args.local) {
    const file = saveJson(scan);
    log(`Saved report: ${file}`);
    log('Nothing was sent over the network.');
    return;
  }

  const preview = await startPreview(scan, {
    server: args.server,
    log,
    onDone: () => process.exit(0),
  });
  log(`Preview open at ${preview.url}`);
  log('Review the data, then choose Send or Save. Closing this window ends the program.');
  openInBrowser(preview.url);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { main, collectHardware, parseArgs, DEMO_SCAN, previewPage, PS_SCRIPT, startPreview, saveJson };
