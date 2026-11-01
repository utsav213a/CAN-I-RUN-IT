'use strict';

// Step 1 of 3 for the full catalogue: download the list of Steam app IDs and names.
//
//   node scripts/steam-applist.js
//
// Source: SteamSpy's documented "all" endpoint (1,000 apps per page, one request per
// 60 seconds as their rules require). Output: data/raw/steam-applist.json
// Re-running overwrites the list, so run it again only when you want a fresh list.

const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'data', 'raw', 'steam-applist.json');
const PAGE_DELAY_MS = 61000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const seen = new Map();
  for (let page = 0; ; page++) {
    const res = await fetch(`https://steamspy.com/api.php?request=all&page=${page}`);
    if (!res.ok) {
      console.log(`page ${page}: HTTP ${res.status}, retrying in 90 seconds`);
      await sleep(90000);
      page--;
      continue;
    }
    const entries = Object.values(await res.json());
    if (!entries.length) break;
    for (const e of entries) {
      const appid = Number(e.appid);
      if (appid && !seen.has(appid)) seen.set(appid, { appid, name: String(e.name || '') });
    }
    console.log(`page ${page}: ${entries.length} entries (unique so far ${seen.size})`);
    await sleep(PAGE_DELAY_MS);
  }
  fs.writeFileSync(OUT, JSON.stringify([...seen.values()]));
  console.log(`Wrote ${seen.size} apps to ${OUT}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { main };
