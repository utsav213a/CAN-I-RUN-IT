'use strict';

// Step 2 of 3: fetch each app's PC requirements from the public Steam store API.
//
//   node scripts/steam-details.js            resume and fetch everything
//   node scripts/steam-details.js --limit 20 fetch at most 20 apps (for testing)
//
// Input:  data/raw/steam-applist.json (from steam-applist.js)
// Output: data/raw/steam-details.ndjson, one line per app, appended as it goes.
//         Re-running skips app IDs already in the file, so an interrupted run resumes.
//
// Valve allows about 200 store requests per 5 minutes, so this runs at one request per
// 1.6 seconds and backs off for 5 minutes on HTTP 429. A full run takes many hours.

const fs = require('fs');
const path = require('path');

const RAW = path.join(__dirname, '..', 'data', 'raw');
const APPLIST = path.join(RAW, 'steam-applist.json');
const OUT = path.join(RAW, 'steam-details.ndjson');
const DELAY_MS = 1600;
const BACKOFF_MS = 5 * 60 * 1000;
const MAX_RETRIES = 6;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadDone() {
  const done = new Set();
  if (!fs.existsSync(OUT)) return done;
  for (const line of fs.readFileSync(OUT, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { done.add(JSON.parse(line).appid); } catch (e) { /* skip a torn last line */ }
  }
  return done;
}

// Reduces the store response to the fields we keep. Nothing else is stored.
function toRecord(appid, entry) {
  if (!entry || !entry.success || !entry.data) return { appid, skip: 'unavailable' };
  const d = entry.data;
  if (d.type !== 'game') return { appid, skip: d.type || 'not-a-game' };
  const pc = d.pc_requirements || {};
  return {
    appid,
    type: 'game',
    name: d.name || '',
    release: (d.release_date && !d.release_date.coming_soon && d.release_date.date) || null,
    minimum: pc.minimum || '',
    recommended: pc.recommended || '',
  };
}

async function fetchApp(appid) {
  const url = `https://store.steampowered.com/api/appdetails?appids=${appid}&filters=basic,pc_requirements,release_date`;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const res = await fetch(url);
    if (res.status === 429 || res.status >= 500) {
      console.log(`HTTP ${res.status} at app ${appid}; waiting 5 minutes`);
      await sleep(BACKOFF_MS);
      continue;
    }
    if (!res.ok) return { appid, skip: `http-${res.status}` };
    const json = await res.json();
    return toRecord(appid, json[appid]);
  }
  return null; // give up on this run; it is retried next time because nothing was written
}

async function main(argv = process.argv.slice(2)) {
  const limitIdx = argv.indexOf('--limit');
  const limit = limitIdx >= 0 ? Number(argv[limitIdx + 1]) : Infinity;
  // --keep N stops after N games with store data in this run (skipped apps do not count).
  const keepIdx = argv.indexOf('--keep');
  const keepTarget = keepIdx >= 0 ? Number(argv[keepIdx + 1]) : Infinity;
  // --from <file> reads another list in the same [{ appid, name }] format, such as steam-popular.json.
  const fromIdx = argv.indexOf('--from');
  const source = fromIdx >= 0 ? path.resolve(argv[fromIdx + 1]) : APPLIST;
  if (!fs.existsSync(source)) throw new Error(fromIdx >= 0 ? `No list at ${source}` : 'Run scripts/steam-applist.js first.');
  const apps = JSON.parse(fs.readFileSync(source, 'utf8').replace(/^﻿/, ''));
  const done = loadDone();
  const todo = apps.filter((a) => !done.has(a.appid));
  console.log(`${apps.length} apps in list, ${done.size} already done, ${todo.length} to fetch`);

  let fetched = 0;
  let kept = 0;
  for (const { appid } of todo) {
    if (fetched >= limit || kept >= keepTarget) break;
    const rec = await fetchApp(appid);
    if (!rec) {
      console.log(`giving up on app ${appid} for this run`);
      break;
    }
    fs.appendFileSync(OUT, JSON.stringify(rec) + '\n');
    fetched++;
    if (!rec.skip) kept++;
    if (fetched % 100 === 0) console.log(`${fetched} fetched, ${kept} games kept`);
    await sleep(DELAY_MS);
  }
  console.log(`Done for now: ${fetched} fetched this run, ${kept} games with store data.`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { toRecord, loadDone };
