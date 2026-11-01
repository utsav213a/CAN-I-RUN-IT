'use strict';

const fs = require('fs');
const path = require('path');
const { sanitizeScan, validateScan } = require('../shared/sanitize');
const compare = require('./compare');
const { TOKEN_PATTERN } = require('./reports');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.exe': 'application/vnd.microsoft.portable-executable',
  '.txt': 'text/plain; charset=utf-8',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};

const MAX_BODY = 256 * 1024;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    ...SECURITY_HEADERS,
    ...extraHeaders,
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (e) {
        reject(new HttpError(400, 'Body must be valid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function intParam(url, name, fallback) {
  const v = Number(url.searchParams.get(name));
  return Number.isInteger(v) && v > 0 ? v : fallback;
}

function createApp({ catalogue, reports, stats, publicDir, config = {} }) {
  const affiliateTag = config.affiliateTag || 'YOUR-AFFILIATE-TAG';
  const routes = [];

  function route(method, pattern, handler) {
    routes.push({ method, pattern, handler });
  }

  function matchRoute(method, pathname) {
    let pathMatched = false;
    for (const r of routes) {
      const m = r.pattern.exec(pathname);
      if (!m) continue;
      pathMatched = true;
      if (r.method === method) return { handler: r.handler, params: m.groups || {} };
    }
    return { pathMatched };
  }

  function withAffiliateTag(list) {
    return list.map((pc) => ({ ...pc, url: pc.url.replace('{tag}', encodeURIComponent(affiliateTag)) }));
  }

  // Loads and validates a spec from either a stored token or a manual/browser spec.
  function resolveSpec(body) {
    if (body.token !== undefined) {
      const r = reports.get(body.token);
      if (r.status === 'invalid') throw new HttpError(400, 'Invalid token');
      if (r.status === 'missing') throw new HttpError(404, 'Result not found. Scan again.');
      if (r.status === 'expired') throw new HttpError(410, 'This result has expired (results are deleted after about 24 hours).');
      return { spec: r.scan, fromScan: true };
    }
    const spec = sanitizeScan(body.spec || {});
    const err = validateScan(spec);
    if (err) throw new HttpError(400, err);
    return { spec, fromScan: false };
  }

  function gameOr404(slug) {
    const g = catalogue.getGame(slug);
    if (!g) throw new HttpError(404, 'Game not found');
    return g;
  }

  // ---- Health and stats ---------------------------------------------------
  route('GET', /^\/api\/health$/, async (ctx) => ({ ok: true, games: catalogue.games.length }));

  route('GET', /^\/api\/stats$/, async () => ({
    ...stats.summary(),
    gamesInCatalogue: catalogue.games.length,
  }));

  // ---- Games ----------------------------------------------------------------
  route('GET', /^\/api\/games\/search$/, async (ctx) => ({
    results: catalogue.search(ctx.url.searchParams.get('q') || '', Math.min(intParam(ctx.url, 'limit', 8), 25)),
  }));

  route('GET', /^\/api\/games\/recent$/, async () => ({ items: catalogue.recent(30) }));

  route('GET', /^\/api\/games$/, async (ctx) => catalogue.browse({
    letter: ctx.url.searchParams.get('letter') || undefined,
    page: intParam(ctx.url, 'page', 1),
    pageSize: intParam(ctx.url, 'pageSize', 50),
  }));

  route('GET', /^\/api\/games\/letters$/, async () => ({
    letters: [...catalogue.letters.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([letter, count]) => ({ letter, count })),
  }));

  route('GET', /^\/api\/games\/(?<slug>[a-z0-9-]+)$/, async ({ params }) => {
    const g = gameOr404(params.slug);
    return {
      slug: g.slug,
      name: g.name,
      releaseDate: g.releaseDate || null,
      source: g.source || 'unknown',
      requirements: g.requirements,
      stats: stats.gameStats(g.slug),
    };
  });

  route('POST', /^\/api\/games\/(?<slug>[a-z0-9-]+)\/compare$/, async ({ params, body }) => {
    const g = gameOr404(params.slug);
    return runCompare(g, body);
  });

  // ---- Popular, lists, PCs ----------------------------------------------------
  route('GET', /^\/api\/popular$/, async () => ({ items: stats.popular(20, catalogue) }));

  route('GET', /^\/api\/lists$/, async () => ({
    items: catalogue.lists.map((l) => ({ id: l.id, title: l.title, description: l.description, count: l.gameSlugs.length })),
  }));

  route('GET', /^\/api\/lists\/(?<id>[A-Za-z0-9_-]+)$/, async ({ params, url }) => {
    const list = catalogue.list(params.id);
    if (!list) throw new HttpError(404, 'List not found');
    const token = url.searchParams.get('token');
    const games = list.gameSlugs.map((s) => catalogue.getGame(s)).filter(Boolean).map((g) => summaryWithVerdict(g, token));
    return { id: list.id, title: list.title, description: list.description, games };
  });

  route('GET', /^\/api\/pcs$/, async () => ({ items: withAffiliateTag(catalogue.pcs) }));

  route('GET', /^\/api\/hardware\/(?<kind>cpus|gpus)$/, async ({ params, url }) => {
    const q = (url.searchParams.get('q') || '').toLowerCase();
    const list = params.kind === 'cpus' ? catalogue.cpus : catalogue.gpus;
    return { items: list.filter((x) => !q || x.name.toLowerCase().includes(q)).slice(0, 25).map((x) => ({ name: x.name, score: x.score, price: x.price })) };
  });

  // Benchmark neighbours: the part and the parts just above and below it, ordered by score.
  route('GET', /^\/api\/hardware\/(?<kind>cpus|gpus)\/nearby$/, async ({ params, url }) => {
    const isGpu = params.kind === 'gpus';
    const sorted = (isGpu ? catalogue.gpus : catalogue.cpus)
      .slice()
      .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
    const name = (url.searchParams.get('name') || '').slice(0, 120);
    const radius = Math.min(10, Math.max(1, Number(url.searchParams.get('radius')) || 4));
    const target = name ? compare.findHardware(catalogue.db, sorted, name, isGpu) : null;
    if (!target) throw new HttpError(404, 'That part is not in the benchmark database');
    const i = sorted.indexOf(target);
    const items = sorted
      .slice(Math.max(0, i - radius), i + radius + 1)
      .map((x) => ({ name: x.name, score: x.score, vramMB: x.vramMB ?? null, target: x === target }));
    return { kind: params.kind, target: { name: target.name, score: target.score }, items };
  });

  // ---- Scans ------------------------------------------------------------------
  route('POST', /^\/api\/scan$/, async ({ body }) => {
    const scan = sanitizeScan(body.scan !== undefined ? body.scan : body);
    const err = validateScan(scan);
    if (err) throw new HttpError(400, err);
    const { token, expiresAt } = reports.create(scan);
    stats.recordScan();
    return { token, expiresAt: new Date(expiresAt).toISOString(), reportPath: `#/report/${token}` };
  });

  route('GET', /^\/api\/scan\/(?<token>[A-Za-z0-9_-]+)$/, async ({ params }) => {
    const r = reports.get(params.token);
    if (r.status === 'invalid' || r.status === 'missing') throw new HttpError(404, 'Result not found');
    if (r.status === 'expired') throw new HttpError(410, 'This result has expired (results are deleted after about 24 hours).');
    return { scan: r.scan, expiresAt: new Date(r.expiresAt).toISOString() };
  });

  route('POST', /^\/api\/compare$/, async ({ body }) => {
    const g = gameOr404(body.slug);
    return runCompare(g, body);
  });

  route('POST', /^\/api\/score$/, async ({ body }) => {
    const { spec } = resolveSpec(body);
    return { score: compare.runScore(catalogue.db, catalogue.games, spec) };
  });

  function summaryWithVerdict(g, token) {
    const base = { slug: g.slug, name: g.name };
    if (!token) return base;
    const r = reports.get(token);
    if (r.status !== 'ok') return { ...base, verdict: null };
    const result = compare.checkGame(g, r.scan, catalogue.db);
    return { ...base, verdict: result.verdict };
  }

  function runCompare(game, body) {
    const { spec, fromScan } = resolveSpec(body);
    const result = compare.checkGame(game, spec, catalogue.db);
    if (fromScan) stats.recordCheck(game.slug, result.verdict.level);
    return {
      ...result,
      spec: summarizeSpec(spec),
      recommendedPcs: withAffiliateTag(compare.recommendPcs(catalogue.db, game)),
      approximate: spec.approximate === true,
    };
  }

  function summarizeSpec(spec) {
    return {
      cpu: spec.cpu.name,
      gpus: spec.gpus.map((g) => g.name),
      ramGB: spec.ramGB,
      os: [spec.os.name, spec.os.version].filter(Boolean).join(' '),
      storage: spec.storage,
      directX: spec.directX,
      vulkan: spec.vulkan,
      resolution: spec.resolution,
    };
  }

  // ---- Static files -----------------------------------------------------------
  function serveStatic(req, res, pathname) {
    const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
    const file = path.resolve(publicDir, rel);
    if (!file.startsWith(path.resolve(publicDir) + path.sep) && file !== path.resolve(publicDir, 'index.html')) {
      return sendJson(res, 400, { error: 'Bad path' });
    }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) {
        // Unknown paths fall back to the app shell so hash routes always load.
        if (!path.extname(pathname)) return serveFile(req, res, path.join(publicDir, 'index.html'));
        return sendJson(res, 404, { error: 'Not found' });
      }
      serveFile(req, res, file);
    });
  }

  function serveFile(req, res, file) {
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache', ...SECURITY_HEADERS });
    fs.createReadStream(file).pipe(res);
  }

  // ---- Dispatcher -------------------------------------------------------------
  return async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;
    try {
      if (!pathname.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'Method not allowed' });
        return serveStatic(req, res, pathname);
      }
      const m = matchRoute(req.method, pathname);
      if (!m.handler) {
        if (m.pathMatched) return sendJson(res, 405, { error: 'Method not allowed' });
        return sendJson(res, 404, { error: 'Unknown endpoint' });
      }
      const body = req.method === 'POST' ? await readBody(req) : {};
      const result = await m.handler({ url, body, params: m.params });
      return sendJson(res, 200, result);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      if (res.headersSent) return res.end();
      return sendJson(res, status, { error: status === 500 ? 'Internal server error' : err.message });
    }
  };
}

module.exports = { createApp, TOKEN_PATTERN };
