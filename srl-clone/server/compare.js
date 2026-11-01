'use strict';

const { normName, stripVram } = require('../shared/names');

// ---------------------------------------------------------------------------
// Hardware lookup
// ---------------------------------------------------------------------------

const prepared = new WeakMap();
const lookupCache = new WeakMap();

// Precomputes normalised keys once per database object.
function prepare(db) {
  if (prepared.has(db)) return db;
  for (const list of [db.cpus, db.gpus]) {
    for (const item of list) {
      item._keys = [item.name, ...(item.aliases || [])].map(normName).filter(Boolean);
    }
  }
  prepared.set(db, true);
  lookupCache.set(db, new Map());
  return db;
}

// Finds the database entry for a free-text hardware name. The longest matching key wins,
// and a key ending in a digit must not be followed by another digit ("RX 580" != "RX 5800").
function findHardware(db, list, rawName, isGpu) {
  prepare(db);
  const cacheKey = `${isGpu ? 'g' : 'c'}|${rawName}`;
  const cache = lookupCache.get(db);
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const n = normName(isGpu ? stripVram(rawName) : rawName);
  let best = null;
  let bestLen = 0;
  if (n) {
    for (const item of list) {
      for (const k of item._keys) {
        if (k.length <= bestLen) continue;
        const i = n.indexOf(k);
        if (i < 0) continue;
        const after = n.charAt(i + k.length);
        if (/\d/.test(after) && /\d/.test(k.charAt(k.length - 1))) continue;
        best = item;
        bestLen = k.length;
      }
    }
  }
  if (cache.size < 50000) cache.set(cacheKey, best);
  return best;
}

// Any one alternative is enough, so the requirement is the easiest (lowest) resolvable score.
function requiredScore(db, list, alternatives, isGpu) {
  let min = null;
  for (const alt of alternatives || []) {
    const item = findHardware(db, list, alt, isGpu);
    if (item && (min === null || item.score < min)) min = item.score;
  }
  return min;
}

// ---------------------------------------------------------------------------
// Tier evaluation (minimum or recommended)
// ---------------------------------------------------------------------------

function windowsMajor(version) {
  const m = /^(\d+)/.exec(String(version || ''));
  return m ? Number(m[1]) : null;
}

function aggregate(components) {
  const active = components.filter((c) => c.status !== 'na');
  if (active.some((c) => c.status === 'fail')) return false;
  if (active.some((c) => c.status === 'unknown')) return null;
  return true;
}

function evaluateTier(spec, req, db) {
  const components = [];
  const add = (id, label, required, actual, status, note = '') =>
    components.push({ id, label, required, actual, status, note });
  const na = (id, label) => components.push({ id, label, required: '—', actual: '—', status: 'na', note: '' });
  // Adds the benchmark numbers to the component just pushed, so the UI can draw the comparison.
  const withBench = (item, reqScore) => Object.assign(components[components.length - 1], {
    hardware: item ? item.name : null,
    score: item ? item.score : null,
    requiredScore: reqScore === undefined ? null : reqScore,
  });

  // CPU
  if (req.cpu) {
    const reqScore = requiredScore(db, db.cpus, req.cpu.alternatives, false);
    const userCpu = spec.cpu.name ? findHardware(db, db.cpus, spec.cpu.name, false) : null;
    const requiredText = req.cpu.alternatives.join(' or ');
    if (reqScore === null) add('cpu', 'Processor', requiredText, spec.cpu.name, 'unknown', 'Required CPU is not in our benchmark database');
    else if (!userCpu) add('cpu', 'Processor', requiredText, spec.cpu.name || 'Unknown', 'unknown', 'Your CPU is not in our benchmark database');
    else add('cpu', 'Processor', requiredText, userCpu.name, userCpu.score >= reqScore ? 'pass' : 'fail');
    withBench(userCpu, reqScore);
  } else na('cpu', 'Processor');

  // RAM
  if (req.ramGB !== null && req.ramGB !== undefined) {
    if (spec.ramGB === null) add('ram', 'Memory', `${req.ramGB} GB`, 'Unknown', 'unknown');
    else add('ram', 'Memory', `${req.ramGB} GB`, `${spec.ramGB} GB`, spec.ramGB >= req.ramGB ? 'pass' : 'fail');
  } else na('ram', 'Memory');

  // GPU (best of the installed GPUs)
  if (req.gpu && req.gpu.alternatives.length) {
    const reqScore = requiredScore(db, db.gpus, req.gpu.alternatives, true);
    let best = null;
    for (const g of spec.gpus) {
      const item = findHardware(db, db.gpus, g.name, true);
      if (item && (!best || item.score > best.score)) best = item;
    }
    const requiredText = req.gpu.alternatives.join(' or ');
    const shown = best ? best.name : spec.gpus[0] ? spec.gpus[0].name : 'Unknown';
    if (reqScore === null) add('gpu', 'Video card', requiredText, shown, 'unknown', 'Required GPU is not in our benchmark database');
    else if (!best) add('gpu', 'Video card', requiredText, shown, 'unknown', 'Your GPU is not in our benchmark database');
    else add('gpu', 'Video card', requiredText, best.name, best.score >= reqScore ? 'pass' : 'fail');
    withBench(best, reqScore);
  } else na('gpu', 'Video card');

  // VRAM (largest dedicated memory reported by any GPU)
  if (req.gpu && req.gpu.vramMB) {
    const known = spec.gpus.filter((g) => g.vramMB !== null && g.vramMB !== undefined);
    const requiredText = `${(req.gpu.vramMB / 1024).toFixed(0)} GB`;
    if (!known.length) add('vram', 'Video memory', requiredText, 'Unknown', 'unknown');
    else {
      const max = Math.max(...known.map((g) => g.vramMB));
      add('vram', 'Video memory', requiredText, `${(max / 1024).toFixed(1)} GB`, max >= req.gpu.vramMB ? 'pass' : 'fail');
    }
  } else na('vram', 'Video memory');

  // OS
  if (req.os && req.os.minVersion) {
    const requiredText = `Windows ${req.os.minVersion}`;
    if (!spec.os.name) add('os', 'Operating system', requiredText, 'Unknown', 'unknown');
    else if (!/windows/i.test(spec.os.name)) add('os', 'Operating system', requiredText, spec.os.name, 'fail', 'This game requires Windows');
    else {
      const major = windowsMajor(spec.os.version);
      const actual = `${spec.os.name} ${spec.os.version}`.trim();
      if (major === null) add('os', 'Operating system', requiredText, actual, 'unknown');
      else add('os', 'Operating system', requiredText, actual, major >= req.os.minVersion ? 'pass' : 'fail');
    }
  } else na('os', 'Operating system');

  // Storage (any drive with enough free space)
  if (req.storageGB) {
    const free = spec.storage.filter((d) => d.freeGB !== null && d.freeGB !== undefined).map((d) => d.freeGB);
    if (!free.length) add('storage', 'Free disk space', `${req.storageGB} GB`, 'Unknown', 'unknown');
    else {
      const max = Math.max(...free);
      add('storage', 'Free disk space', `${req.storageGB} GB`, `${max} GB`, max >= req.storageGB ? 'pass' : 'fail');
    }
  } else na('storage', 'Free disk space');

  // DirectX
  if (req.directX) {
    if (spec.directX === null || spec.directX === undefined) add('directx', 'DirectX', `${req.directX}`, 'Unknown', 'unknown');
    else add('directx', 'DirectX', `${req.directX}`, `${spec.directX}`, spec.directX >= req.directX ? 'pass' : 'fail');
  } else na('directx', 'DirectX');

  // Vulkan
  if (req.vulkan) {
    if (spec.vulkan === null || spec.vulkan === undefined) add('vulkan', 'Vulkan', 'Required', 'Unknown', 'unknown');
    else add('vulkan', 'Vulkan', 'Required', spec.vulkan ? 'Supported' : 'Not found', spec.vulkan ? 'pass' : 'fail');
  } else na('vulkan', 'Vulkan');

  return { components, pass: aggregate(components) };
}

function verdictFor(minPass, recPass) {
  if (minPass === false) return { level: 'fail', text: 'Your PC does not meet the minimum requirements' };
  if (minPass === null) return { level: 'unknown', text: "We couldn't verify every component" };
  if (recPass === true) return { level: 'recommended', text: 'Your PC can run this game at recommended settings' };
  return { level: 'minimum', text: 'Your PC can run this game at minimum settings' };
}

// ---------------------------------------------------------------------------
// Upgrade suggestions
// ---------------------------------------------------------------------------

function suggestUpgrades(db, failing) {
  const out = [];
  for (const c of failing) {
    const forTier = c.tier === 'recommended' ? ' for recommended settings' : '';
    if (c.id === 'cpu') {
      const score = requiredScore(db, db.cpus, c.requiredAlternatives, false);
      const options = db.cpus.filter((x) => x.score >= score).sort((a, b) => a.score - b.score).slice(0, 3);
      out.push({ component: 'cpu', tier: c.tier, text: `Upgrade your processor${forTier}. A CPU at this level or better is needed`, options: options.map((o) => ({ name: o.name, price: o.price })) });
    } else if (c.id === 'gpu') {
      const score = requiredScore(db, db.gpus, c.requiredAlternatives, true);
      const options = db.gpus.filter((x) => x.score >= score).sort((a, b) => a.score - b.score).slice(0, 3);
      out.push({ component: 'gpu', tier: c.tier, text: `Upgrade your graphics card${forTier}. A GPU at this level or better is needed`, options: options.map((o) => ({ name: o.name, price: o.price })) });
    } else if (c.id === 'vram') {
      const options = db.gpus.filter((x) => x.vramMB >= c.requiredMB).sort((a, b) => a.score - b.score).slice(0, 3);
      out.push({ component: 'vram', tier: c.tier, text: `Choose a graphics card with at least ${c.required} of video memory${forTier}`, options: options.map((o) => ({ name: o.name, price: o.price })) });
    } else if (c.id === 'ram') {
      out.push({ component: 'ram', tier: c.tier, text: `Install at least ${c.required} of RAM${forTier}`, options: [] });
    } else if (c.id === 'storage') {
      out.push({ component: 'storage', tier: c.tier, text: `Free up disk space: the game needs ${c.required}`, options: [] });
    } else if (c.id === 'os') {
      out.push({ component: 'os', tier: c.tier, text: `Use ${c.required} or newer`, options: [] });
    } else if (c.id === 'directx') {
      out.push({ component: 'directx', tier: c.tier, text: `Update Windows and your graphics driver to support DirectX ${c.required}`, options: [] });
    } else if (c.id === 'vulkan') {
      out.push({ component: 'vulkan', tier: c.tier, text: 'Update your graphics driver to one that supports Vulkan', options: [] });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// Adds the numbers the suggestion text needs, taken from the requirement tier that failed.
function withRequirement(component, req, tier) {
  const extra = { tier };
  if (component.id === 'cpu' && req.cpu) extra.requiredAlternatives = req.cpu.alternatives;
  if (component.id === 'gpu' && req.gpu) extra.requiredAlternatives = req.gpu.alternatives;
  if (component.id === 'vram' && req.gpu) {
    extra.requiredMB = req.gpu.vramMB;
    extra.required = `${(req.gpu.vramMB / 1024).toFixed(0)} GB`;
  }
  if (component.id === 'ram') extra.required = `${req.ramGB} GB`;
  if (component.id === 'storage') extra.required = `${req.storageGB} GB`;
  if (component.id === 'os') extra.required = `Windows ${req.os.minVersion}`;
  if (component.id === 'directx') extra.required = `${req.directX}`;
  return { ...component, ...extra };
}

function checkGame(game, spec, db) {
  prepare(db);
  const minT = evaluateTier(spec, game.requirements.minimum, db);
  const recT = game.requirements.recommended ? evaluateTier(spec, game.requirements.recommended, db) : null;
  const recPass = recT ? recT.pass : null;
  const verdict = verdictFor(minT.pass, recPass);

  // Suggestions target the tier that failed: minimum failures use the minimum spec,
  // recommended-only failures use the recommended spec.
  const upgradeInput = [];
  for (const c of minT.components.filter((x) => x.status === 'fail')) {
    upgradeInput.push(withRequirement(c, game.requirements.minimum, 'minimum'));
  }
  if (recT) {
    for (const c of recT.components.filter((x) => x.status === 'fail')) {
      if (minT.components.some((m) => m.id === c.id && m.status === 'fail')) continue;
      upgradeInput.push(withRequirement(c, game.requirements.recommended, 'recommended'));
    }
  }

  return {
    slug: game.slug,
    name: game.name,
    minimum: { pass: minT.pass, components: minT.components },
    recommended: recT ? { pass: recT.pass, components: recT.components } : null,
    verdict,
    upgrades: suggestUpgrades(db, upgradeInput),
  };
}

// Builds a spec-shaped object for a PC from the catalogue, for "What will run it?"
function pcSpec(db, pc) {
  const gpu = findHardware(db, db.gpus, pc.gpu, true);
  return {
    approximate: false,
    cpu: { name: pc.cpu },
    gpus: [{ name: pc.gpu, vramMB: gpu ? gpu.vramMB : null }],
    ramGB: pc.ramGB,
    os: { name: 'Windows', version: '10.0' },
    storage: [{ type: 'SSD', freeGB: pc.storageGB }],
    directX: 12,
    vulkan: true,
  };
}

function recommendPcs(db, game, limit = 3) {
  const rows = db.pcs
    .map((pc) => {
      const r = checkGame(game, pcSpec(db, pc), db);
      return { pc, level: r.verdict.level };
    })
    .filter((x) => x.level === 'recommended' || x.level === 'minimum');
  rows.sort((a, b) => (a.level === b.level ? a.pc.price - b.pc.price : a.level === 'recommended' ? -1 : 1));
  return rows.slice(0, limit).map((x) => ({
    id: x.pc.id,
    name: x.pc.name,
    cpu: x.pc.cpu,
    gpu: x.pc.gpu,
    ramGB: x.pc.ramGB,
    price: x.pc.price,
    meets: x.level,
    url: x.pc.url,
  }));
}

// Cyri-style score: how many catalogue games this machine can run.
function runScore(db, games, spec) {
  let total = 0;
  let minimum = 0;
  let recommended = 0;
  let unverified = 0;
  for (const game of games) {
    if (!game.requirements || !game.requirements.minimum) continue;
    total += 1;
    const r = checkGame(game, spec, db);
    if (r.verdict.level === 'unknown') unverified += 1;
    if (r.minimum.pass === true) minimum += 1;
    // Recommended implies minimum: a machine that fails the minimum tier cannot count here.
    if (r.minimum.pass === true && r.recommended && r.recommended.pass === true) recommended += 1;
  }
  const pct = (n) => (total ? Math.round((n / total) * 1000) / 10 : 0);
  return {
    totalGames: total,
    canRunMinimum: minimum,
    canRunRecommended: recommended,
    unverified,
    minimumPct: pct(minimum),
    recommendedPct: pct(recommended),
  };
}

// ---------------------------------------------------------------------------
// Related parts: used when a part is not in the benchmark database. They share the
// product line ("RTX", "Ryzen 5", "Core i7") and have the closest model number.
// ---------------------------------------------------------------------------

const BRAND_WORDS = new Set(['nvidia', 'amd', 'intel', 'geforce', 'radeon', 'gpu', 'graphics', 'laptop',
  'desktop', 'cpu', 'processor', 'with', 'the', 'series', 'edition', 'card', 'video', 'max', 'q', 'design', 'mobile']);

function wordsOf(name) {
  return String(name || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function modelNumber(name) {
  const m = /\d{3,5}/.exec(String(name || ''));
  return m ? Number(m[0]) : null;
}

// Returns up to `count` catalogue entries that share the most product-line words with `rawName`.
// Ties go to the closest model number. Returns [] when nothing shares a product-line word.
function relatedHardware(list, rawName, count = 8) {
  const words = wordsOf(rawName).filter((w) => !BRAND_WORDS.has(w) && !/^\d+$/.test(w));
  if (!words.length) return [];
  const model = modelNumber(rawName);
  const scored = [];
  for (const item of list) {
    const itemWords = new Set(wordsOf(item.name));
    const shared = words.filter((w) => itemWords.has(w)).length;
    if (!shared) continue;
    const itemModel = modelNumber(item.name);
    const distance = model !== null && itemModel !== null ? Math.abs(model - itemModel) : Number.MAX_SAFE_INTEGER;
    scored.push({ item, shared, distance });
  }
  scored.sort((a, b) => b.shared - a.shared || a.distance - b.distance || a.item.name.localeCompare(b.item.name));
  return scored.slice(0, count).map((x) => x.item);
}

module.exports = { relatedHardware, prepare, findHardware, requiredScore, evaluateTier, verdictFor, checkGame, recommendPcs, runScore, pcSpec };
