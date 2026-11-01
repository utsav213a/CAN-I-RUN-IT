'use strict';

const crypto = require('crypto');

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // results are deleted after about 24 hours

// Holds scan results in memory only, keyed by an anonymous random token.
// Nothing is written to disk, and nothing identifies the visitor.
class ReportStore {
  constructor({ ttlMs = DEFAULT_TTL_MS, maxEntries = 10000, now = () => Date.now() } = {}) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.now = now;
    this.entries = new Map(); // insertion order == creation order, so purging is cheap
  }

  purge() {
    const cutoff = this.now();
    for (const [token, entry] of this.entries) {
      if (entry.expiresAt > cutoff) break;
      this.entries.delete(token);
    }
  }

  create(scan) {
    this.purge();
    if (this.entries.size >= this.maxEntries) {
      // Drop the oldest entry rather than refuse new scans.
      this.entries.delete(this.entries.keys().next().value);
    }
    const token = crypto.randomBytes(16).toString('base64url');
    const createdAt = this.now();
    const expiresAt = createdAt + this.ttlMs;
    this.entries.set(token, { scan, createdAt, expiresAt });
    return { token, createdAt, expiresAt };
  }

  // Returns { status: 'ok', scan, expiresAt } | { status: 'expired' } | { status: 'invalid' } | { status: 'missing' }
  get(token) {
    if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) return { status: 'invalid' };
    const entry = this.entries.get(token);
    if (!entry) return { status: 'missing' };
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(token);
      return { status: 'expired' };
    }
    return { status: 'ok', scan: entry.scan, expiresAt: entry.expiresAt };
  }

  delete(token) {
    return this.entries.delete(token);
  }

  get size() {
    return this.entries.size;
  }
}

module.exports = { ReportStore, TOKEN_PATTERN, DEFAULT_TTL_MS };
