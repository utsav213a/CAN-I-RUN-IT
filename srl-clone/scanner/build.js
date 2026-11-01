'use strict';

// Builds the portable Windows executable with Node's single-executable-application (SEA) feature.
//
//   node scanner/build.js                      -> dist/SRL-Hardware-Check.exe (unsigned)
//   SIGNTOOL_CERT=... node scanner/build.js     -> also code-signs the exe (see README)
//
// Steps: bundle scanner/scan.js + shared/sanitize.js into one file, generate the SEA blob,
// copy node.exe, inject the blob with postject, optionally sign with signtool.
// Requires Node 20+ and network access once (for `npx postject`).

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const OUT_EXE = path.join(DIST, 'SRL-Hardware-Check.exe');
const SENTINEL = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

// Inline shared/sanitize.js so the single-file bundle has no external requires.
function bundle() {
  const scanSrc = fs.readFileSync(path.join(__dirname, 'scan.js'), 'utf8').replace(/^#!.*\n/, '');
  const sanitizeSrc = fs.readFileSync(path.join(ROOT, 'shared', 'sanitize.js'), 'utf8');
  const inlined = `const __sanitize = (function () { const module = { exports: {} }; const exports = module.exports;\n${sanitizeSrc}\nreturn module.exports; })();`;
  let out = scanSrc.replace("const { sanitizeScan, validateScan } = require('../shared/sanitize');", `${inlined}\nconst { sanitizeScan, validateScan } = __sanitize;`);
  if (out.includes("require('../shared/sanitize')")) throw new Error('sanitize import not replaced');
  // In the SEA bundle the program is always the entry point.
  out = out.replace('if (require.main === module) {', 'if (true) {');
  // The website address the scanner sends results to. Set SRL_PUBLIC_URL when building,
  // so the .exe works for users without them setting anything.
  const publicUrl = process.env.SRL_PUBLIC_URL || 'http://127.0.0.1:3000';
  out = out.replace("process.env.SRL_SERVER || 'http://127.0.0.1:3000'", JSON.stringify(publicUrl));
  return out;
}

// Runs a command without a shell (paths may contain spaces). Only npx/signtool need the shell
// on Windows, because npx is a .cmd shim; their arguments never contain spaces.
function run(cmd, args, opts = {}) {
  console.log(`> ${cmd} ${args.join(' ')}`);
  const shell = process.platform === 'win32' && /^(npx|signtool)$/.test(cmd);
  return execFileSync(cmd, args, { stdio: 'inherit', shell, ...opts });
}

function main() {
  if (Number(process.versions.node.split('.')[0]) < 20) throw new Error('Node 20+ is required for SEA builds');
  fs.mkdirSync(DIST, { recursive: true });

  const bundlePath = path.join(DIST, 'scanner-bundle.js');
  fs.writeFileSync(bundlePath, bundle());

  const seaConfig = path.join(DIST, 'sea-config.json');
  const blob = path.join(DIST, 'sea-prep.blob');
  fs.writeFileSync(seaConfig, JSON.stringify({ main: bundlePath, output: blob, disableExperimentalSEAWarning: true }, null, 2));
  run(process.execPath, ['--experimental-sea-config', seaConfig]);

  fs.copyFileSync(process.execPath, OUT_EXE);
  // Remove the Node signature first, otherwise injection breaks on some builds.
  try { run('signtool', ['remove', '/s', OUT_EXE], { stdio: 'ignore' }); } catch (e) { /* not signed: nothing to remove */ }
  run('npx', ['--yes', 'postject@1.0.0-alpha.6', OUT_EXE, 'NODE_SEA_BLOB', blob, '--sentinel-fuse', SENTINEL]);

  if (process.env.SIGNTOOL_CERT) {
    const args = ['sign', '/fd', 'SHA256', '/tr', process.env.SIGNTOOL_TIMESTAMP || 'http://timestamp.digicert.com', '/td', 'SHA256', '/f', process.env.SIGNTOOL_CERT];
    if (process.env.SIGNTOOL_PASSWORD) args.push('/p', process.env.SIGNTOOL_PASSWORD);
    args.push(OUT_EXE);
    run('signtool', args);
    console.log('Signed with signtool.');
  } else {
    console.log('Not signed. Set SIGNTOOL_CERT to sign (see README).');
  }
  // The website's download link points here. public/downloads is git-ignored: it is a build copy.
  const DOWNLOADS = path.join(ROOT, 'public', 'downloads');
  fs.mkdirSync(DOWNLOADS, { recursive: true });
  fs.copyFileSync(OUT_EXE, path.join(DOWNLOADS, 'SRL-Hardware-Check.exe'));
  console.log(`Built ${OUT_EXE}`);
  console.log(`Copied to ${path.join(DOWNLOADS, 'SRL-Hardware-Check.exe')} for the website download.`);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`Build failed: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { bundle };
