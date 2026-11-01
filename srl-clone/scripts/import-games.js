'use strict';

// Imports games into data/games.json.
//
//   node scripts/import-games.js data/raw/sample-games.csv
//   node scripts/import-games.js my-games.json
//
// CSV columns: name, releaseDate, source, minimum, recommended
// (minimum/recommended are the free-text requirement blocks from a store page).
// JSON input: an array of objects with the same keys.
// Existing games with the same slug are replaced; new ones get the next id.

const fs = require('fs');
const path = require('path');
const { parseGameRequirements } = require('../server/parser');
const { slugify } = require('../shared/names');

const GAMES_FILE = path.join(__dirname, '..', 'data', 'games.json');

// Small RFC-4180 style CSV reader: handles quoted fields, escaped quotes and CRLF.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((v) => v !== '')) rows.push(row);
  const [header, ...body] = rows;
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] || '').trim()])));
}

function readInput(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  return file.toLowerCase().endsWith('.json') ? JSON.parse(text) : parseCsv(text);
}

function importRows(rows, existing = []) {
  const bySlug = new Map(existing.map((g) => [g.slug, g]));
  let nextId = existing.reduce((m, g) => Math.max(m, g.id || 0), 0) + 1;
  const report = { added: 0, updated: 0, skipped: [], warnings: [] };
  const now = new Date().toISOString();

  for (const raw of rows) {
    const name = (raw.name || '').trim();
    if (!name || !raw.minimum) {
      report.skipped.push(name || '(no name)');
      continue;
    }
    const slug = raw.slug || slugify(name);
    const { requirements, warnings } = parseGameRequirements({ minimum: raw.minimum, recommended: raw.recommended });
    warnings.forEach((w) => report.warnings.push(`${name}: ${w}`));
    const prev = bySlug.get(slug);
    const game = {
      id: prev ? prev.id : nextId++,
      slug,
      name,
      releaseDate: raw.releaseDate || (prev && prev.releaseDate) || null,
      source: raw.source || (prev && prev.source) || 'import',
      addedAt: prev && prev.addedAt ? prev.addedAt : now,
      requirements,
    };
    if (raw.steamAppId) game.steamAppId = Number(raw.steamAppId);
    if (prev) report.updated += 1;
    else report.added += 1;
    bySlug.set(slug, game);
  }
  return { games: [...bySlug.values()].sort((a, b) => a.id - b.id), report };
}

function main() {
  const input = process.argv[2];
  if (!input) {
    console.error('Usage: node scripts/import-games.js <games.csv|games.json>');
    process.exit(1);
  }
  const existing = fs.existsSync(GAMES_FILE)
    ? JSON.parse(fs.readFileSync(GAMES_FILE, 'utf8').replace(/^﻿/, ''))
    : [];
  const { games, report } = importRows(readInput(input), existing);
  fs.writeFileSync(GAMES_FILE, JSON.stringify(games, null, 2) + '\n');
  console.log(`Added ${report.added}, updated ${report.updated}, skipped ${report.skipped.length}. Total: ${games.length}`);
  report.skipped.forEach((s) => console.log(`  skipped: ${s}`));
  report.warnings.forEach((w) => console.log(`  warning: ${w}`));
}

if (require.main === module) main();

module.exports = { parseCsv, importRows };
