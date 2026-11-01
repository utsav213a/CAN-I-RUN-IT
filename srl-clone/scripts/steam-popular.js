'use strict';

// Step 1 of the popular-games import: the most-owned apps on Steam, from SteamSpy.
//
//   node scripts/steam-popular.js            pages 0 and 1 (the 2,000 most-owned apps)
//   node scripts/steam-popular.js --pages 3  more pages
//
// SteamSpy's "all" list holds 1,000 apps per page, sorted by owners. It allows one request
// per 60 seconds, so this takes about two minutes. Output: data/raw/steam-popular.json, in
// owner order, as [{ appid, name }]. Then run steam-details.js with --from on that file.

const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'data', 'raw', 'steam-popular.json');
const PAGE_DELAY_MS = 61000;
const RETRY_DELAY_MS = 90000;
const MAX_RETRIES = 5;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// SteamSpy gives owners as a range, "20,000,000 .. 50,000,000". Its lower bound ranks apps.
function ownersFloor(text) {
  const m = /^\s*([\d,]+)/.exec(String(text || ''));
  return m ? Number(m[1].replace(/,/g, '')) : 0;
}

// The API returns an object keyed by app ID. Keys are numeric, so JavaScript would reorder
// them by ID. We sort by owners ourselves.
function toRanked(page) {
  return Object.entries(page || {})
    .map(([appid, row]) => ({ appid: Number(appid), name: row.name || '', owners: ownersFloor(row.owners) }))
    .filter((row) => row.appid && row.name && row.appid !== 999999)
    .sort((a, b) => b.owners - a.owners || a.appid - b.appid);
}

async function fetchPage(page) {
  const url = `https://steamspy.com/api.php?request=all&page=${page}`;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const text = await res.text();
        return JSON.parse(text); // SteamSpy sometimes returns an error text here; that throws and retries
      }
      console.log(`page ${page}: HTTP ${res.status}, retry in 90 s`);
    } catch (err) {
      console.log(`page ${page}: ${err.message}, retry in 90 s`);
    }
    await sleep(RETRY_DELAY_MS);
  }
  throw new Error(`SteamSpy page ${page} failed after ${MAX_RETRIES} attempts`);
}

async function main(argv = process.argv.slice(2)) {
  const pagesIdx = argv.indexOf('--pages');
  const pages = pagesIdx >= 0 ? Number(argv[pagesIdx + 1]) : 2;
  const seen = new Map();
  for (let page = 0; page < pages; page++) {
    if (page > 0) await sleep(PAGE_DELAY_MS);
    const rows = toRanked(await fetchPage(page));
    for (const row of rows) if (!seen.has(row.appid)) seen.set(row.appid, row);
    console.log(`page ${page}: ${rows.length} apps (unique so far ${seen.size})`);
  }
  const ranked = [...seen.values()].sort((a, b) => b.owners - a.owners || a.appid - b.appid);
  const list = ranked.map(({ appid, name }) => ({ appid, name }));
  fs.writeFileSync(OUT, JSON.stringify(list));
  console.log(`Wrote ${list.length} apps to ${OUT}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}

module.exports = { ownersFloor, toRanked };
