'use strict';

// Step 3 of 3: turn the fetched store data into data/games.json.
//
//   node scripts/build-games.js
//
// Reads data/raw/steam-details.ndjson and data/raw/sample-games.csv. Hand-checked CSV rows
// win over store data for the same game. Duplicate names get the Steam app ID appended
// to the slug, so every game keeps a unique URL. Prints how many games have a CPU or GPU
// the benchmark database can resolve, because that decides how often a verdict is known.

const fs = require('fs');
const path = require('path');
const { importRows, parseCsv } = require('./import-games');
const { htmlToText } = require('../server/parser');
const { slugify, normName } = require('../shared/names');
const { findHardware } = require('../server/compare');
const { prepare } = require('../server/compare');

const RAW = path.join(__dirname, '..', 'data', 'raw');
const DATA = path.join(__dirname, '..', 'data');
const GAMES_FILE = path.join(DATA, 'games.json');

function parseDate(text) {
  if (!text) return null;
  const t = Date.parse(text);
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}

function steamRows(file) {
  if (!fs.existsSync(file)) return [];
  const rows = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let r;
    try { r = JSON.parse(line); } catch (e) { continue; }
    if (r.skip || r.type !== 'game' || !r.minimum) continue;
    rows.push({
      name: r.name,
      steamAppId: r.appid,
      releaseDate: parseDate(r.release),
      source: 'steam-store-api',
      minimum: htmlToText(r.minimum),
      recommended: htmlToText(r.recommended),
    });
  }
  return rows;
}

// Give duplicate names a unique slug. The first name keeps the plain slug.
function uniqueSlugs(rows) {
  const count = new Map();
  for (const r of rows) {
    const base = slugify(r.name);
    const n = (count.get(base) || 0) + 1;
    count.set(base, n);
    if (n > 1) r.slug = `${base}-${r.steamAppId || n}`;
  }
  return rows;
}

function main() {
  const csv = fs.existsSync(path.join(RAW, 'sample-games.csv'))
    ? parseCsv(fs.readFileSync(path.join(RAW, 'sample-games.csv'), 'utf8').replace(/^﻿/, ''))
    : [];
  const store = uniqueSlugs(steamRows(path.join(RAW, 'steam-details.ndjson')));
  const csvSlugs = new Set(csv.map((r) => slugify(r.name)));
  const rows = store.filter((r) => !csvSlugs.has(slugify(r.name))).concat(csv);

  const { games, report } = importRows(rows, []);
  // Recently added = newest release date when we know it.
  for (const g of games) if (g.releaseDate) g.addedAt = new Date(g.releaseDate).toISOString();
  fs.writeFileSync(GAMES_FILE, JSON.stringify(games) + '\n');

  const db = { cpus: JSON.parse(fs.readFileSync(path.join(DATA, 'cpus.json'), 'utf8')), gpus: JSON.parse(fs.readFileSync(path.join(DATA, 'gpus.json'), 'utf8')), pcs: [] };
  prepare(db);
  let resolvable = 0;
  for (const g of games) {
    const cpu = g.requirements.minimum.cpu && g.requirements.minimum.cpu.alternatives.some((a) => findHardware(db, db.cpus, a, false));
    const gpu = g.requirements.minimum.gpu && g.requirements.minimum.gpu.alternatives.some((a) => findHardware(db, db.gpus, a, true));
    if (cpu && gpu) resolvable++;
  }
  console.log(`Wrote ${games.length} games to data/games.json (${report.warnings.length} parse warnings, ${report.skipped.length} skipped).`);
  console.log(`Games whose minimum CPU and GPU are both in the benchmark database: ${resolvable} (${((resolvable / Math.max(1, games.length)) * 100).toFixed(1)}%).`);
  console.log('The rest show "Unknown" for those components until the hardware database is expanded.');
}

if (require.main === module) main();

module.exports = { steamRows, uniqueSlugs };
