'use strict';

// Converts free-text requirement blocks (as published on store pages) into structured specs.
//
//   "OS: Windows 10 64-bit  Processor: Intel Core i5-8400 | AMD Ryzen 3 3300X
//    Memory: 12 GB RAM  Graphics: GTX 1060 3GB | RX 580 4GB  Storage: 60 GB"
//
// -> { os: {minVersion: 10}, cpu: {alternatives: [...]}, ramGB: 12, gpu: {alternatives, vramMB}, ... }

const LABEL_PATTERN =
  /(Operating System|OS|Processor|CPU|Memory|RAM|System Memory|Graphics Card|Graphics|Video Card|GPU|Video RAM|VRAM|Dedicated Video RAM|DirectX|Direct X|Free Disk Space|Hard Drive|Hard Disk|Storage|Disk Space|Vulkan)\s*:/gi;

const KEY_FOR_LABEL = {
  'operating system': 'os',
  os: 'os',
  processor: 'cpu',
  cpu: 'cpu',
  memory: 'ram',
  ram: 'ram',
  'system memory': 'ram',
  'graphics card': 'gpu',
  graphics: 'gpu',
  'video card': 'gpu',
  gpu: 'gpu',
  'video ram': 'vram',
  vram: 'vram',
  'dedicated video ram': 'vram',
  directx: 'directx',
  'direct x': 'directx',
  'free disk space': 'storage',
  'hard drive': 'storage',
  'hard disk': 'storage',
  storage: 'storage',
  'disk space': 'storage',
  vulkan: 'vulkan',
};

function splitFields(raw) {
  const fields = {};
  const matches = [...String(raw || '').matchAll(LABEL_PATTERN)];
  matches.forEach((m, i) => {
    const key = KEY_FOR_LABEL[m[1].toLowerCase()];
    const start = m.index + m[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : String(raw).length;
    const value = String(raw).slice(start, end).replace(/[|;,\s]+$/, '').trim();
    if (!fields[key]) fields[key] = value;
  });
  return fields;
}

function toMB(value) {
  const m = /(\d+(?:\.\d+)?)\s*(GB|MB)/i.exec(value || '');
  if (!m) return null;
  const n = Number(m[1]);
  return Math.round(m[2].toUpperCase() === 'GB' ? n * 1024 : n);
}

function toGB(value) {
  const mb = toMB(value);
  return mb === null ? null : Math.round((mb / 1024) * 10) / 10;
}

// Free-text lists use "|", " or ", newlines, or commas between hardware names.
// Filler such as "Video card must be 1 GB,more" is dropped: a real alternative names
// a product, so it must contain a digit or a known brand word.
const FILLER = /\b(higher|better|more|equivalent|must|should|required|recommended|compatible)\b/i;
const HARDWARE_HINT = /\d|intel|amd|nvidia|geforce|radeon|ryzen|core|arc\b/i;

// Clock speeds ("2.67 GHz") are dropped from an alternative, and so are feature lines that
// land in the graphics field ("Shader 3.0", "DirectX 9.0c").
const CLOCK = /,?\s*\d+(\.\d+)?\s*(GHz|MHz)\b/gi;
const NOT_HARDWARE = /^(shader|directx|direct x|dx)\b/i;

function alternatives(value) {
  return String(value || '')
    .split(/\s\|\s|\|| or |\n|,\s*(?=(?:intel|amd|nvidia|geforce|radeon|ryzen|core|arc\b))/i)
    .map((s) => s.replace(CLOCK, '').trim())
    .filter((s) => s && !FILLER.test(s) && HARDWARE_HINT.test(s) && !NOT_HARDWARE.test(s));
}

function parseRequirements(raw) {
  const f = splitFields(raw);
  const result = {
    os: null,
    cpu: null,
    ramGB: null,
    gpu: null,
    directX: null,
    storageGB: null,
    vulkan: null,
  };

  if (f.os) {
    const v = /Windows\s*(\d+)/i.exec(f.os);
    result.os = { minVersion: v ? Number(v[1]) : null };
  }
  if (f.cpu) result.cpu = { alternatives: alternatives(f.cpu) };
  if (f.ram) result.ramGB = toGB(f.ram);
  if (f.gpu) {
    // "GTX 1060, 3GB" -> name "GTX 1060", vram 3072 (alternatives may carry their own VRAM)
    const alts = alternatives(f.gpu).map((a) => a.replace(/,\s*\d+(\.\d+)?\s*(GB|MB)\b.*$/i, '').trim());
    result.gpu = { alternatives: alts, vramMB: toMB(f.gpu) };
  }
  if (f.vram) result.gpu = { alternatives: result.gpu ? result.gpu.alternatives : [], vramMB: toMB(f.vram) };
  if (f.directx) {
    const v = /(\d+(?:\.\d+)?)/.exec(f.directx);
    result.directX = v ? Number(v[1]) : null;
  }
  if (f.storage) result.storageGB = toGB(f.storage);
  if (f.vulkan !== undefined) result.vulkan = true;

  return result;
}

// Parses the two blocks a store page publishes and reports what was not recognised.
function parseGameRequirements({ minimum, recommended }) {
  const out = { minimum: parseRequirements(minimum), recommended: recommended ? parseRequirements(recommended) : null };
  const warnings = [];
  if (!out.minimum.cpu) warnings.push('minimum: no processor found');
  if (!out.minimum.gpu) warnings.push('minimum: no graphics card found');
  return { requirements: out, warnings };
}

// Store pages publish requirements as HTML (<ul><li><strong>Processor:</strong> ...).
// Turn that into plain "Label: value" lines the parser understands.
function htmlToText(html) {
  return String(html || '')
    .replace(/[®™©]/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(li|p|div|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&#x27;|&apos;|&rsquo;|&lsquo;/gi, "'")
    .replace(/&trade;/gi, '')
    .replace(/&reg;/gi, '')
    .replace(/&copy;/gi, '')
    .replace(/&[a-z]+;/gi, ' ')
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

module.exports = { parseRequirements, parseGameRequirements, alternatives, toGB, toMB, htmlToText };
