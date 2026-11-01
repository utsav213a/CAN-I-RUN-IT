'use strict';

const fs = require('fs');
const path = require('path');

// Anonymous aggregate counters only: how often each game was checked and how often
// the result was a pass. No scan contents, tokens, IPs or user identifiers are stored.
class Stats {
  constructor(file = null) {
    this.file = file;
    this.data = { totalScans: 0, games: {} };
    if (file && fs.existsSync(file)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (parsed && typeof parsed.totalScans === 'number' && parsed.games) this.data = parsed;
      } catch (err) {
        // A corrupt stats file must not stop the server; start fresh and keep the bad file aside.
        fs.renameSync(file, `${file}.corrupt-${Date.now()}`);
      }
    }
  }

  save() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  recordScan() {
    this.data.totalScans += 1;
    this.save();
  }

  // level: 'recommended' | 'minimum' | 'fail' | 'unknown'
  recordCheck(slug, level) {
    const g = this.data.games[slug] || (this.data.games[slug] = { views: 0, passMinimum: 0, passRecommended: 0 });
    g.views += 1;
    if (level === 'minimum' || level === 'recommended') g.passMinimum += 1;
    if (level === 'recommended') g.passRecommended += 1;
    this.save();
  }

  gameStats(slug) {
    const g = this.data.games[slug];
    if (!g) return { views: 0, passPct: null };
    return { views: g.views, passPct: g.views ? Math.round((g.passMinimum / g.views) * 1000) / 10 : null };
  }

  popular(limit = 20, catalogue = null) {
    return Object.entries(this.data.games)
      .filter(([, g]) => g.views > 0)
      .sort((a, b) => b[1].views - a[1].views)
      .slice(0, limit)
      .map(([slug, g]) => ({
        slug,
        name: catalogue && catalogue.getGame(slug) ? catalogue.getGame(slug).name : slug,
        views: g.views,
        passPct: Math.round((g.passMinimum / g.views) * 1000) / 10,
      }));
  }

  summary() {
    return { totalScans: this.data.totalScans, gamesChecked: Object.keys(this.data.games).length };
  }
}

module.exports = { Stats };
