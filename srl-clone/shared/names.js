'use strict';

// Normalises hardware and game names so "Intel(R) Core(TM) i5-8400 CPU @ 2.80GHz"
// and "Intel Core i5-8400" compare equal.
function normName(value) {
  return String(value || '')
    .replace(/\((R|TM|C)\)|[®™]/gi, '')
    .replace(/@.*$/, '')
    .replace(/\bCPU\b/gi, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase();
}

// Removes "3GB", "8 GB", "4096MB" fragments so GPU names match without VRAM suffixes.
function stripVram(value) {
  return String(value || '').replace(/\b\d+(\.\d+)?\s*(GB|MB)\b/gi, '');
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

module.exports = { normName, stripVram, slugify };
