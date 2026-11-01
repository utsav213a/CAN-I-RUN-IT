'use strict';

const http = require('http');
const path = require('path');
const { Catalogue } = require('./store');
const { ReportStore } = require('./reports');
const { Stats } = require('./stats');
const { createApp } = require('./app');

const ROOT = path.resolve(__dirname, '..');

function start({
  port = Number(process.env.PORT) || 3000,
  host = process.env.HOST || '127.0.0.1',
  dataDir = path.join(ROOT, 'data'),
  publicDir = path.join(ROOT, 'public'),
  statsFile = path.join(ROOT, 'data', 'stats.json'),
  affiliateTag = process.env.AFFILIATE_TAG,
} = {}) {
  const catalogue = Catalogue.fromDir(dataDir);
  const reports = new ReportStore();
  const stats = new Stats(statsFile);
  const handler = createApp({ catalogue, reports, stats, publicDir, config: { affiliateTag } });
  const server = http.createServer(handler);
  // Purge expired reports even when nobody is making requests.
  const timer = setInterval(() => reports.purge(), 10 * 60 * 1000);
  timer.unref();
  return new Promise((resolve) => {
    server.listen(port, host, () => {
      const addr = server.address();
      console.log(`System Requirements Lab clone running at http://${host}:${addr.port}`);
      console.log(`Catalogue: ${catalogue.games.length} games`);
      resolve({ server, port: addr.port, catalogue, reports, stats });
    });
  });
}

if (require.main === module) {
  start();
}

module.exports = { start };
