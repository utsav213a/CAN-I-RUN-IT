'use strict';

// Builds data/cpus.json and data/gpus.json from public benchmark results.
//
//   node scripts/build-benchmarks.js <opendata.jsonl> [--rightnow <all-gpus.json>]
//
// Benchmark source: Blender Open Data (https://opendata.blender.org/), licensed CC0 1.0.
// Every submission reports how long the standard "bmw27" scene took to render on one device.
// We keep the median time per device model (at least MIN_RUNS submissions) and convert it to
// a score: higher means faster. This is a render benchmark, not a game benchmark.
//
// Video memory for GPUs comes from the name when it states it ("GTX 1060 6GB"). Otherwise it
// comes from the optional RightNow GPU database (Apache 2.0; its specs are sourced from
// TechPowerUp), passed with --rightnow.
//
// Get the snapshot: https://opendata.blender.org/snapshots/opendata-latest.zip (about 100 MB,
// about 1.9 GB unzipped). Get the GPU specs: data/raw is not committed, so download
// https://raw.githubusercontent.com/rightnow-ai/rightnow-gpu-database/main/data/all-gpus.json.

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { normName, stripVram } = require('../shared/names');

const DATA = path.join(__dirname, '..', 'data');
const SCENE = 'bmw27';
const MIN_RUNS = 5;
const SCORE_SCALE = 100000; // score = SCORE_SCALE / median render seconds

function cleanName(raw) {
  return String(raw || '').replace(/\(R\)|\(TM\)|®|™/gi, '').replace(/\s+/g, ' ').trim();
}

// "Intel Core i5-8400 CPU @ 2.80GHz" and "AMD Ryzen 3 3100 4-Core Processor" become plain model names.
function cleanCpuName(raw) {
  return cleanName(raw)
    .replace(/\s+CPU\s*@.*$/i, '')
    .replace(/\s+\d+-Core Processor$/i, '')
    .replace(/\s+Processor$/i, '')
    .trim();
}

// Submitters name the same model differently ("Radeon RX 580 Series", "12th Gen Intel Core i7-12700K").
// This removes the extra words so the variants group together.
function familyName(raw) {
  return cleanName(raw)
    .replace(/^\d+(st|nd|rd|th) Gen\s+/i, '')
    .replace(/\s+(Series|Graphics|Eight-Core|Six-Core|Quad-Core)\b/gi, '')
    .trim();
}

function groupKey(name) {
  return normName(familyName(name).replace(/\b(NVIDIA|AMD|Intel)\b/gi, ''));
}

// Pulls (kind, name, seconds) observations out of one Blender Open Data record.
// A run counts only when exactly one device model was used, so each time maps to one part.
function observationsFrom(record) {
  const out = [];
  if (!Array.isArray(record.data)) return out;
  for (const run of record.data) {
    if (!run || !run.scene || run.scene.label !== SCENE) continue;
    const seconds = run.stats ? run.stats.total_render_time : null;
    if (!(seconds > 0) || seconds > 100000) continue;
    const info = run.device_info || {};
    const devices = info.compute_devices || [];
    if (info.device_type === 'CPU') {
      const names = [...new Set(devices.filter((d) => d.type === 'CPU').map((d) => cleanCpuName(d.name)))];
      if (names.length === 1) out.push({ kind: 'cpu', name: names[0], seconds });
    } else {
      const names = [...new Set(devices.filter((d) => d.type !== 'CPU').map((d) => cleanName(d.name)))];
      if (names.length === 1) out.push({ kind: 'gpu', name: names[0], seconds });
    }
  }
  return out;
}

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Short forms users type in requirement text: "GTX 1060", "Ryzen 5 3600", "i5-8400".
function aliasesFor(name, kind) {
  const short = name.replace(/^(NVIDIA|AMD|Intel)\s+/i, '');
  if (kind === 'cpu') {
    return [...new Set([short, short.replace(/^Core\s+/i, '')])].filter((a) => a && a !== name);
  }
  const withoutVram = stripVram(short).replace(/\s+/g, ' ').trim();
  return [...new Set([withoutVram, withoutVram.replace(/^(GeForce|Radeon)\s+/i, '')])].filter((a) => a && a !== name);
}

function readRightNow(file) {
  const rows = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  const memoryByName = new Map();
  for (const r of rows) {
    if (!r.name || typeof r.memorySize !== 'number') continue;
    const key = normName(stripVram(r.name));
    if (!memoryByName.has(key)) memoryByName.set(key, r.memorySize);
  }
  return memoryByName;
}

function vramMBFor(name, memoryByName) {
  const stated = /(\d+(?:\.\d+)?)\s*GB\b/i.exec(name);
  if (stated) return Math.round(Number(stated[1]) * 1024);
  const gb = memoryByName.get(normName(stripVram(name.replace(/\b(NVIDIA|AMD|Intel)\b/gi, ''))));
  return typeof gb === 'number' ? Math.round(gb * 1024) : null;
}

// Reads the snapshot one line at a time. Each line is one submission.
async function readObservations(file) {
  const groups = { cpu: new Map(), gpu: new Map() };
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch (e) {
      continue; // a damaged line is skipped, not fatal
    }
    for (const obs of observationsFrom(record)) {
      const key = groupKey(obs.name);
      const group = groups[obs.kind];
      if (!group.has(key)) group.set(key, { names: new Map(), seconds: [] });
      const entry = group.get(key);
      const name = familyName(obs.name);
      entry.names.set(name, (entry.names.get(name) || 0) + 1);
      entry.seconds.push(obs.seconds);
    }
  }
  return groups;
}

function toEntries(group, kind, memoryByName) {
  const rows = [];
  for (const { names, seconds } of group.values()) {
    if (seconds.length < MIN_RUNS) continue;
    // The most common spelling becomes the display name. A name with no model number
    // ("AMD Radeon") would match too many requirements, so it is left out.
    const name = [...names.entries()].sort((a, b) => b[1] - a[1])[0][0];
    if (!/\d/.test(name)) continue;
    const entry = {
      name,
      aliases: aliasesFor(name, kind).filter((a) => /\d/.test(a)),
      score: Math.round(SCORE_SCALE / median(seconds)),
      runs: seconds.length,
      price: null,
    };
    if (kind === 'gpu') entry.vramMB = vramMBFor(name, memoryByName);
    rows.push(entry);
  }
  // A short alias shared by several models (GTX 1060 3GB and 6GB) goes to the best-tested one.
  const owner = new Map();
  for (const r of [...rows].sort((a, b) => b.runs - a.runs)) {
    for (const a of r.aliases) {
      const key = normName(a);
      if (!owner.has(key)) owner.set(key, r);
    }
  }
  for (const r of rows) r.aliases = r.aliases.filter((a) => owner.get(normName(a)) === r);
  return rows.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
}

function writeJson(file, rows) {
  const body = '[\n' + rows.map((r) => '  ' + JSON.stringify(r)).join(',\n') + '\n]\n';
  fs.writeFileSync(file, body);
}

async function main(argv = process.argv.slice(2)) {
  const input = argv[0];
  if (!input || input.startsWith('--')) throw new Error('Usage: node scripts/build-benchmarks.js <opendata.jsonl> [--rightnow <all-gpus.json>]');
  const rnIdx = argv.indexOf('--rightnow');
  const memoryByName = rnIdx >= 0 ? readRightNow(argv[rnIdx + 1]) : new Map();

  const groups = await readObservations(input);
  const cpus = toEntries(groups.cpu, 'cpu', memoryByName);
  const gpus = toEntries(groups.gpu, 'gpu', memoryByName);
  writeJson(path.join(DATA, 'cpus.json'), cpus);
  writeJson(path.join(DATA, 'gpus.json'), gpus);
  const withVram = gpus.filter((g) => g.vramMB !== null).length;
  console.log(`CPUs: ${cpus.length} models (at least ${MIN_RUNS} runs each)`);
  console.log(`GPUs: ${gpus.length} models, ${withVram} with video memory`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}

module.exports = { observationsFrom, median, aliasesFor, cleanName, cleanCpuName, toEntries, vramMBFor };
