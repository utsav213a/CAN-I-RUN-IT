'use strict';

const fs = require('fs');
const path = require('path');

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw new Error(`Could not read ${file}: ${err.message}`);
  }
}

function letterOf(name) {
  const c = String(name).charAt(0).toUpperCase();
  return /[A-Z]/.test(c) ? c : '#';
}

function summary(g) {
  return { id: g.id, slug: g.slug, name: g.name, releaseDate: g.releaseDate || null, addedAt: g.addedAt || null };
}

// In-memory catalogue. Loaded once at start-up; 19,000+ entries fit comfortably.
class Catalogue {
  constructor({ games, cpus, gpus, pcs, lists }) {
    this.games = games.slice().sort((a, b) => a.name.localeCompare(b.name));
    this.bySlug = new Map(this.games.map((g) => [g.slug, g]));
    this.cpus = cpus;
    this.gpus = gpus;
    this.pcs = pcs;
    this.lists = lists;
    this.letters = new Map();
    for (const g of this.games) {
      const l = letterOf(g.name);
      this.letters.set(l, (this.letters.get(l) || 0) + 1);
    }
  }

  static fromDir(dir) {
    return new Catalogue({
      games: readJson(path.join(dir, 'games.json'), []),
      cpus: readJson(path.join(dir, 'cpus.json'), []),
      gpus: readJson(path.join(dir, 'gpus.json'), []),
      pcs: readJson(path.join(dir, 'pcs.json'), []),
      lists: readJson(path.join(dir, 'lists.json'), []),
    });
  }

  get db() {
    return { cpus: this.cpus, gpus: this.gpus, pcs: this.pcs };
  }

  getGame(slug) {
    return this.bySlug.get(String(slug || '')) || null;
  }

  // Prefix matches rank above substring matches. Used for autocomplete.
  search(query, limit = 8) {
    const needle = String(query || '').trim().toLowerCase();
    if (!needle) return [];
    const prefix = [];
    const contains = [];
    for (const g of this.games) {
      const n = g.name.toLowerCase();
      if (n.startsWith(needle)) prefix.push(g);
      else if (n.includes(needle)) contains.push(g);
      if (prefix.length >= limit) break;
    }
    return prefix.concat(contains).slice(0, limit).map(summary);
  }

  // A–Z browsing. letter: 'A'..'Z', '#' for digits and symbols, or omitted for all.
  browse({ letter, page = 1, pageSize = 50 } = {}) {
    const filtered = letter ? this.games.filter((g) => letterOf(g.name) === letter.toUpperCase()) : this.games;
    const size = Math.min(Math.max(1, pageSize), 200);
    const p = Math.max(1, page);
    return {
      letter: letter ? letter.toUpperCase() : null,
      total: filtered.length,
      page: p,
      pageSize: size,
      items: filtered.slice((p - 1) * size, p * size).map(summary),
    };
  }

  recent(limit = 20) {
    return this.games
      .filter((g) => g.addedAt)
      .sort((a, b) => (a.addedAt < b.addedAt ? 1 : -1))
      .slice(0, limit)
      .map(summary);
  }

  list(id) {
    return this.lists.find((l) => String(l.id) === String(id)) || null;
  }
}

module.exports = { Catalogue, letterOf, readJson };
