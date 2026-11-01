/* System Requirements Lab clone: vanilla JS single-page app with hash routing. */
(function () {
  'use strict';

  const app = document.getElementById('app');
  const CONSENT_KEY = 'srl.consent';
  const TOKEN_KEY = 'srl.lastToken';

  // ---------------------------------------------------------------- helpers
  function h(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function storage() {
    try {
      return localStorage.getItem(CONSENT_KEY) === 'accepted' ? localStorage : null;
    } catch (e) {
      return null;
    }
  }

  function getStoredToken() {
    try {
      const s = storage();
      return s ? s.getItem(TOKEN_KEY) : null;
    } catch (e) {
      return null;
    }
  }

  let token = getStoredToken();

  function setToken(t) {
    token = t;
    try {
      const s = storage();
      if (s) {
        if (t) s.setItem(TOKEN_KEY, t);
        else s.removeItem(TOKEN_KEY);
      }
    } catch (e) { /* storage unavailable: keep token in memory only */ }
  }

  async function api(path, options) {
    const res = await fetch(path, options);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  function post(path, body) {
    return api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }

  function setView(html) {
    app.innerHTML = html;
    app.focus();
    window.scrollTo(0, 0);
  }

  function errorBox(message) {
    return `<div class="error" role="alert">${h(message)}</div>`;
  }

  const STATUS_LABEL = { pass: 'Pass', fail: 'Fail', unknown: 'Unknown', na: 'Not required' };

  function badge(status) {
    return `<span class="badge ${h(status)}">${h(STATUS_LABEL[status] || status)}</span>`;
  }

  function money(n) {
    return n ? `$${Number(n).toLocaleString('en-US')}` : 'Free';
  }

  // ------------------------------------------------------------ autocomplete
  function attachAutocomplete(input, onPick) {
    const wrap = input.parentElement;
    const list = document.createElement('ul');
    list.className = 'suggest';
    list.setAttribute('role', 'listbox');
    list.hidden = true;
    wrap.appendChild(list);
    let items = [];
    let active = -1;
    let timer = null;
    let seq = 0;

    function render() {
      list.innerHTML = items.map((g, i) =>
        `<li role="option" aria-selected="${i === active}"><button type="button" data-slug="${h(g.slug)}" data-name="${h(g.name)}">${h(g.name)}</button></li>`
      ).join('');
      list.hidden = items.length === 0;
    }

    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.addEventListener('input', () => {
      clearTimeout(timer);
      const q = input.value.trim();
      if (!q) { items = []; render(); return; }
      timer = setTimeout(async () => {
        const mine = ++seq;
        try {
          const data = await api(`/api/games/search?q=${encodeURIComponent(q)}&limit=8`);
          if (mine !== seq) return;
          items = data.results;
          active = -1;
          render();
        } catch (e) { items = []; render(); }
      }, 150);
    });
    input.addEventListener('keydown', (e) => {
      if (list.hidden) return;
      if (e.key === 'ArrowDown') { active = Math.min(active + 1, items.length - 1); render(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { active = Math.max(active - 1, 0); render(); e.preventDefault(); }
      else if (e.key === 'Enter' && active >= 0 && items[active]) { e.preventDefault(); onPick(items[active]); }
      else if (e.key === 'Escape') { items = []; render(); }
    });
    list.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-slug]');
      if (!btn) return;
      const g = { slug: btn.dataset.slug, name: btn.dataset.name };
      onPick(g);
    });
    document.addEventListener('click', (e) => {
      if (!wrap.contains(e.target)) { items = []; render(); }
    });
  }

  function gotoGame(slug) {
    location.hash = `#/game/${encodeURIComponent(slug)}`;
  }

  // ---------------------------------------------------------------- views
  async function viewHome() {
    const [popular, recent] = await Promise.all([api('/api/popular'), api('/api/games/recent')]);
    const popularRows = popular.items.length
      ? `<ol class="list">${popular.items.map((g) => `<li><a href="#/game/${h(g.slug)}">${h(g.name)}</a> <span class="muted">${g.views} checks · ${g.passPct === null ? '—' : h(g.passPct) + '% can run'}</span></li>`).join('')}</ol>`
      : '<p class="muted">No checks yet. Popular games appear here once people run a scan.</p>';
    setView(`
      <section class="hero">
        <h1>Can I run it?</h1>
        <p>Free and under a minute. Search for a game, then compare its minimum and recommended requirements with your PC.</p>
        <div class="search">
          <label for="home-search" class="visually-hidden">Search games</label>
          <input id="home-search" type="search" placeholder="Search a game, e.g. Elden Ring" autocomplete="off">
        </div>
      </section>
      <div class="grid">
        <div class="card">
          <h2>Scan my PC</h2>
          <p class="muted">A small Windows app reads CPU, GPU, RAM, OS, storage and DirectX/Vulkan. You preview everything before it is sent.</p>
          <a class="btn primary" href="#/scan">Get the scanner</a>
        </div>
        <div class="card">
          <h2>How many games can I run?</h2>
          <p class="muted">One test against our catalogue, for minimum and recommended specs.</p>
          <a class="btn" href="#/score">Run the score</a>
        </div>
        <div class="card">
          <h2>Other devices</h2>
          <p class="muted">Mac, Linux or mobile? Enter specs manually, or try a quick approximate check in your browser.</p>
          <div class="row"><a class="btn" href="#/manual">Manual specs</a><a class="btn" href="#/quick">Quick browser check</a></div>
        </div>
      </div>
      <div class="grid">
        <div class="card"><h2>Popular this month</h2>${popularRows}<a href="#/popular">All popular games</a></div>
        <div class="card"><h2>Recently added</h2>
          <ul class="list">${recent.items.slice(0, 8).map((g) => `<li><a href="#/game/${h(g.slug)}">${h(g.name)}</a></li>`).join('') || '<li class="muted">Nothing yet.</li>'}</ul>
          <a href="#/recent">All recently added</a>
        </div>
      </div>
    `);
    attachAutocomplete(document.getElementById('home-search'), (g) => gotoGame(g.slug));
  }

  async function viewSearch(q) {
    const data = await api(`/api/games/search?q=${encodeURIComponent(q)}&limit=25`);
    setView(`
      <h1>Search results</h1>
      <form class="search" id="search-form" role="search">
        <label for="q" class="visually-hidden">Search</label>
        <input id="q" name="q" value="${h(q)}" autocomplete="off">
      </form>
      <div class="card">${data.results.length ? `<ul class="list">${data.results.map((g) => `<li><a href="#/game/${h(g.slug)}">${h(g.name)}</a></li>`).join('')}</ul>` : '<p class="muted">No games match that search.</p>'}</div>
    `);
    document.getElementById('search-form').addEventListener('submit', (e) => {
      e.preventDefault();
      location.hash = `#/search?q=${encodeURIComponent(document.getElementById('q').value.trim())}`;
    });
  }

  async function viewAZ(letter, page) {
    const [letters, data] = await Promise.all([
      api('/api/games/letters'),
      api(`/api/games?${letter ? `letter=${encodeURIComponent(letter)}&` : ''}page=${page}&pageSize=50`),
    ]);
    const all = ['#'].concat(Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i)));
    const have = new Set(letters.letters.map((l) => l.letter));
    const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
    setView(`
      <h1>A–Z game list</h1>
      <nav class="letters" aria-label="Letters">
        ${all.map((l) => have.has(l) ? `<a href="#/az/${encodeURIComponent(l)}" class="${data.letter === l ? 'active' : ''}">${h(l)}</a>` : `<span class="muted">${h(l)}</span>`).join('')}
      </nav>
      <div class="card">
        <p class="muted">${data.total} ${data.total === 1 ? 'game' : 'games'}${data.letter ? ` starting with ${h(data.letter)}` : ''}</p>
        <ul class="list">${data.items.map((g) => `<li><a href="#/game/${h(g.slug)}">${h(g.name)}</a></li>`).join('')}</ul>
        <div class="row" style="margin-top:12px">
          ${page > 1 ? `<a class="btn" href="#/az/${encodeURIComponent(data.letter || 'all')}?page=${page - 1}">Previous</a>` : ''}
          <span class="muted">Page ${page} of ${pages}</span>
          ${page < pages ? `<a class="btn" href="#/az/${encodeURIComponent(data.letter || 'all')}?page=${page + 1}">Next</a>` : ''}
        </div>
      </div>
    `);
  }

  async function viewPopular() {
    const data = await api('/api/popular');
    setView(`
      <h1>Popular games</h1>
      <p class="muted">Ranked by checks. Pass % is the share of checks where the PC could run the game at least at minimum settings.</p>
      <div class="card">
        ${data.items.length ? `<table><thead><tr><th>Game</th><th>Checks</th><th>Can run</th></tr></thead><tbody>
          ${data.items.map((g) => `<tr><td data-label="Game"><a href="#/game/${h(g.slug)}">${h(g.name)}</a></td><td data-label="Checks">${g.views}</td><td data-label="Can run">${g.passPct}%</td></tr>`).join('')}
        </tbody></table>` : '<p class="muted">No checks have been recorded yet.</p>'}
      </div>
    `);
  }

  async function viewRecent() {
    const data = await api('/api/games/recent');
    setView(`
      <h1>Recently added</h1>
      <div class="card"><ul class="list">${data.items.map((g) => `<li><a href="#/game/${h(g.slug)}">${h(g.name)}</a> <span class="muted small">released ${h((g.addedAt || '').slice(0, 10))}</span></li>`).join('') || '<li class="muted">Nothing yet.</li>'}</ul></div>
    `);
  }

  async function viewLists(id) {
    if (!id) {
      const data = await api('/api/lists');
      setView(`
        <h1>Test multiple games</h1>
        <p class="muted">Curated lists. Scan your PC first to see a verdict for each game.</p>
        <div class="grid">${data.items.map((l) => `<div class="card"><h2><a href="#/list/${h(l.id)}">${h(l.title)}</a></h2><p class="muted">${h(l.description)}</p><p class="small">${l.count} games</p></div>`).join('')}</div>
      `);
      return;
    }
    const data = await api(`/api/lists/${encodeURIComponent(id)}${token ? `?token=${encodeURIComponent(token)}` : ''}`);
    setView(`
      <h1>${h(data.title)}</h1>
      <p class="muted">${h(data.description)}</p>
      ${token ? '' : '<p class="notice">Scan your PC to see verdicts. <a href="#/scan">Scan my PC</a></p>'}
      <div class="card"><table><thead><tr><th>Game</th><th>Verdict</th></tr></thead><tbody>
        ${data.games.map((g) => `<tr><td data-label="Game"><a href="#/game/${h(g.slug)}">${h(g.name)}</a></td><td data-label="Verdict">${g.verdict ? badge(g.verdict.level === 'recommended' ? 'pass' : g.verdict.level === 'minimum' ? 'pass' : g.verdict.level === 'fail' ? 'fail' : 'unknown') + ' ' + h(g.verdict.text) : '<span class="muted">—</span>'}</td></tr>`).join('')}
      </tbody></table></div>
    `);
  }

  async function viewPcs() {
    const data = await api('/api/pcs');
    setView(`
      <h1>What will run it?</h1>
      <p class="muted">Pre-built gaming PCs. Use these as a starting point if your current machine falls short.</p>
      <p class="disclosure">Some links are affiliate links. We may earn a commission at no extra cost to you. Prices are approximate.</p>
      <div class="grid">${data.items.map((pc) => `
        <div class="card">
          <h2>${h(pc.name)}</h2>
          <ul class="list small">
            <li>CPU: ${h(pc.cpu)}</li><li>GPU: ${h(pc.gpu)}</li><li>RAM: ${h(pc.ramGB)} GB</li><li>Storage: ${h(pc.storageGB)} GB</li>
          </ul>
          <p><strong>${money(pc.price)}</strong></p>
          <a class="btn" href="${h(pc.url)}" rel="sponsored nofollow noopener" target="_blank">View PC</a>
        </div>`).join('')}</div>
    `);
  }

  async function viewScan() {
    setView(`
      <h1>Scan my PC</h1>
      <div class="grid">
        <div class="card">
          <h2>1. Download the scanner</h2>
          <p class="muted">Windows only. Portable: no installer, no background service, nothing added to startup. Run it, check the preview, then choose <em>Send</em> or <em>Save as JSON only</em>.</p>
          <a class="btn primary" href="downloads/SRL-Hardware-Check.exe" download>Download scanner (.exe)</a>
          <p class="small muted">Build it yourself from the source if you prefer. See the README.</p>
        </div>
        <div class="card">
          <h2>2. Enter your result token</h2>
          <p class="muted">After sending, the scanner shows a token. Paste it here to open your report.</p>
          <form id="token-form">
            <div class="field"><label for="token">Result token</label><input id="token" autocomplete="off" required></div>
            <button class="btn primary" type="submit">Open report</button>
          </form>
          <p id="token-error" class="error" hidden></p>
        </div>
      </div>
      <div class="card">
        <h2>What the scanner collects</h2>
        <ul class="list">
          <li>CPU name, cores and threads</li><li>GPU name and video memory</li><li>RAM size</li>
          <li>Operating system name and version</li><li>Storage type and free space on the system drive</li>
          <li>DirectX 12 and Vulkan availability</li><li>Screen resolution</li>
        </ul>
        <p class="small muted">Never collected: username, PC name, IP or MAC address, serial numbers, product key, installed software, files, location or device IDs.</p>
      </div>
    `);
    document.getElementById('token-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const t = document.getElementById('token').value.trim();
      if (t) location.hash = `#/report/${encodeURIComponent(t)}`;
    });
  }

  async function viewReport(t) {
    let data;
    try {
      data = await api(`/api/scan/${encodeURIComponent(t)}`);
    } catch (e) {
      setView(`<h1>Report</h1>${errorBox(e.message)}<p><a href="#/scan">Scan again</a></p>`);
      return;
    }
    setToken(t);
    const s = data.scan;
    const gpus = s.gpus.map((g) => `${h(g.name)}${g.vramMB ? ` (${(g.vramMB / 1024).toFixed(1)} GB)` : ''}`).join(', ') || 'Unknown';
    setView(`
      <h1>Your PC report</h1>
      <p class="muted">Expires ${h(new Date(data.expiresAt).toLocaleString())}. Results are deleted after about 24 hours.</p>
      ${s.approximate ? '<p class="notice">Approximate result from your browser.</p>' : ''}
      <div class="card">
        <table><tbody>
          <tr><th>CPU</th><td>${h(s.cpu.name) || 'Unknown'}</td></tr>
          <tr><th>GPU</th><td>${gpus}</td></tr>
          <tr><th>RAM</th><td>${s.ramGB === null ? 'Unknown' : h(s.ramGB) + ' GB'}</td></tr>
          <tr><th>OS</th><td>${h([s.os.name, s.os.version].filter(Boolean).join(' ')) || 'Unknown'}</td></tr>
          <tr><th>Storage</th><td>${s.storage.map((d) => `${h(d.type)}, ${d.freeGB === null ? '?' : h(d.freeGB) + ' GB free'}`).join('; ') || 'Unknown'}</td></tr>
          <tr><th>DirectX</th><td>${s.directX === null ? 'Unknown' : h(s.directX)}</td></tr>
          <tr><th>Vulkan</th><td>${s.vulkan === null ? 'Unknown' : s.vulkan ? 'Supported' : 'Not found'}</td></tr>
          <tr><th>Resolution</th><td>${s.resolution.width ? `${h(s.resolution.width)} × ${h(s.resolution.height)}` : 'Unknown'}</td></tr>
        </tbody></table>
      </div>
      <div class="card">
        <h2>Check a game</h2>
        <div class="search"><label for="report-search" class="visually-hidden">Search games</label>
          <input id="report-search" type="search" placeholder="Search a game" autocomplete="off"></div>
        <p class="row" style="margin-top:12px"><a class="btn" href="#/score">How many games can I run?</a><a class="btn" href="#/lists">Test curated lists</a></p>
      </div>
    `);
    attachAutocomplete(document.getElementById('report-search'), (g) => gotoGame(g.slug));
  }

  async function viewScore() {
    if (!token) {
      setView(`<h1>How many games can I run?</h1>${errorBox('Scan your PC first.')}<a class="btn primary" href="#/scan">Scan my PC</a>`);
      return;
    }
    const data = await post('/api/score', { token });
    const s = data.score;
    setView(`
      <h1>How many games can I run?</h1>
      <div class="grid">
        <div class="card"><h2>${s.canRunRecommended}</h2><p>of ${s.totalGames} games at recommended settings (${s.recommendedPct}%)</p></div>
        <div class="card"><h2>${s.canRunMinimum}</h2><p>of ${s.totalGames} games at least at minimum settings (${s.minimumPct}%)</p></div>
        <div class="card"><h2>${s.unverified}</h2><p>games we could not fully verify (missing hardware in our database)</p></div>
      </div>
      <p class="muted small">Based on the games in our catalogue, which is currently a sample. Target size is 19,000+ games.</p>
    `);
  }

  function renderComponents(components) {
    return renderTable(components) + components.map(compareBlock).join('');
  }

  function renderTable(components) {
    return `<table><thead><tr><th>Component</th><th>Required</th><th>Your PC</th><th>Result</th></tr></thead><tbody>
      ${components.filter((c) => c.status !== 'na').map((c) => `
        <tr>
          <td data-label="Component">${h(c.label)}</td>
          <td data-label="Required">${h(c.required)}</td>
          <td data-label="Your PC">${h(c.actual)}${c.note ? `<br><span class="small muted">${h(c.note)}</span>` : ''}</td>
          <td data-label="Result">${badge(c.status)}</td>
        </tr>`).join('') || '<tr><td colspan="4" class="muted">No requirements listed.</td></tr>'}
    </tbody></table>`;
  }

  function verdictClass(level) {
    return ['recommended', 'minimum', 'fail', 'unknown'].includes(level) ? level : 'unknown';
  }

  function renderResult(r) {
    const req = r.recommended ? `<div class="grid"><div class="card"><h2>Minimum</h2>${renderComponents(r.minimum.components)}</div>
      <div class="card"><h2>Recommended</h2>${renderComponents(r.recommended.components)}</div></div>`
      : `<div class="card"><h2>Minimum</h2>${renderComponents(r.minimum.components)}</div>`;
    const upgrades = r.upgrades.length
      ? `<div class="card"><h2>Upgrade suggestions</h2><ul class="list">${r.upgrades.map((u) => `
          <li>${h(u.text)}${u.options && u.options.length ? `<div class="small muted">Options: ${u.options.map((o) => `${h(o.name)}${o.price ? ` (${money(o.price)})` : ''}`).join(', ')}</div>` : ''}</li>`).join('')}</ul></div>`
      : '';
    const pcs = r.recommendedPcs && r.recommendedPcs.length
      ? `<div class="card"><h2>What will run it?</h2><p class="disclosure">Affiliate links: we may earn a commission at no extra cost to you.</p><ul class="list">${r.recommendedPcs.map((pc) => `
          <li><a href="${h(pc.url)}" rel="sponsored nofollow noopener" target="_blank">${h(pc.name)}</a> · ${money(pc.price)} · ${pc.meets === 'recommended' ? 'meets recommended' : 'meets minimum'}</li>`).join('')}</ul></div>`
      : '';
    return `
      <div class="card verdict ${verdictClass(r.verdict.level)}">
        <h2>${h(r.verdict.text)}</h2>
        <p class="muted small">${r.approximate ? 'Approximate result: values come from your browser. ' : ''}Checked against ${h(r.name)}.</p>
      </div>
      ${req}${upgrades}${pcs}`;
  }

  async function viewGame(slug) {
    const game = await api(`/api/games/${encodeURIComponent(slug)}`);
    const reqBlock = game.requirements.recommended
      ? `<p class="muted small">Source: ${h(game.source)}${game.source.startsWith('sample') ? ' (sample data, verify before relying on it)' : ''}</p>`
      : '';
    const panel = token
      ? `<div id="check" class="card"><p class="muted">Checking your PC…</p></div>`
      : `<div class="card">
          <h2>Can my PC run ${h(game.name)}?</h2>
          <p class="muted">Pick a way to tell us about your PC.</p>
          <div class="row">
            <a class="btn primary" href="#/scan">Scan my PC</a>
            <a class="btn" href="#/quick">Quick browser check</a>
            <a class="btn" href="#/manual?game=${encodeURIComponent(game.slug)}">Enter specs manually</a>
          </div>
        </div>`;
    setView(`
      <h1>${h(game.name)} system requirements</h1>
      ${reqBlock}
      ${panel}
      <div class="card">
        <h2>Requirements</h2>
        <div class="grid">${['minimum', 'recommended'].map((tier) => tier === 'minimum' || game.requirements.recommended ? `
          <div><h3>${tier === 'minimum' ? 'Minimum' : 'Recommended'}</h3>
          <ul class="list small">${reqList(game.requirements[tier]).map((l) => `<li>${h(l)}</li>`).join('')}</ul></div>` : '').join('')}</div>
      </div>
    `);
    if (token) {
      try {
        const r = await post(`/api/games/${encodeURIComponent(slug)}/compare`, { token });
        document.getElementById('check').innerHTML = renderResult(r);
      } catch (e) {
        document.getElementById('check').innerHTML = errorBox(e.message) + '<p><a href="#/scan">Scan again</a></p>';
        if (/expired/.test(e.message)) setToken(null);
      }
    }
  }

  function reqList(req) {
    const out = [];
    if (req.os) out.push(`OS: ${req.os.minVersion ? 'Windows ' + req.os.minVersion : 'Unknown'}`);
    if (req.cpu) out.push(`Processor: ${req.cpu.alternatives.join(' or ')}`);
    if (req.ramGB) out.push(`Memory: ${req.ramGB} GB`);
    if (req.gpu && req.gpu.alternatives.length) out.push(`Graphics: ${req.gpu.alternatives.join(' or ')}`);
    if (req.gpu && req.gpu.vramMB) out.push(`Video memory: ${(req.gpu.vramMB / 1024).toFixed(1)} GB`);
    if (req.directX) out.push(`DirectX: ${req.directX}`);
    if (req.vulkan) out.push('Vulkan: required');
    if (req.storageGB) out.push(`Storage: ${req.storageGB} GB free`);
    return out;
  }

  async function viewQuick() {
    setView(`
      <h1>Quick browser check</h1>
      <div class="notice">Approximate. Browsers do not expose your CPU model or exact memory. Check the values below and correct them before comparing.</div>
      <div class="card">
        <form id="quick-form">
          <div class="field"><label for="q-cpu">CPU (type it, e.g. Intel Core i5-8400)</label><input id="q-cpu" list="cpu-list" autocomplete="off"></div>
          <div class="field"><label for="q-gpu">GPU</label><input id="q-gpu" autocomplete="off"></div>
          <div class="field"><label for="q-ram">RAM (GB, browsers cap this at 8)</label><input id="q-ram" type="number" min="1" max="4096"></div>
          <div class="field"><label for="q-os">OS</label><select id="q-os"><option>Windows 10</option><option>Windows 11</option><option>macOS</option><option>Linux</option><option>Android</option><option>iOS</option></select></div>
          <div class="field"><label for="q-game">Game (name)</label><div class="search"><input id="q-game" autocomplete="off" placeholder="Search a game"><input type="hidden" id="q-slug"></div></div>
          <button class="btn primary" type="submit">Compare</button>
        </form>
        <datalist id="cpu-list"></datalist>
        <div id="quick-result"></div>
      </div>
    `);
    const gpuName = detectGpu();
    document.getElementById('q-gpu').value = gpuName || '';
    document.getElementById('q-ram').value = navigator.deviceMemory ? String(Math.min(navigator.deviceMemory, 8)) : '';
    if (/Windows NT 11|Windows NT 10/.test(navigator.userAgent)) document.getElementById('q-os').value = 'Windows 10';
    else if (/Mac OS X/.test(navigator.userAgent)) document.getElementById('q-os').value = 'macOS';
    else if (/Linux/.test(navigator.userAgent)) document.getElementById('q-os').value = 'Linux';
    attachAutocomplete(document.getElementById('q-game'), (g) => {
      document.getElementById('q-game').value = g.name;
      document.getElementById('q-slug').value = g.slug;
    });
    document.getElementById('quick-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const slug = document.getElementById('q-slug').value;
      if (!slug) { document.getElementById('quick-result').innerHTML = errorBox('Pick a game from the search list.'); return; }
      const osName = document.getElementById('q-os').value;
      const spec = {
        approximate: true,
        cpu: { name: document.getElementById('q-cpu').value.trim() },
        gpus: [{ name: document.getElementById('q-gpu').value.trim() }],
        ramGB: Number(document.getElementById('q-ram').value) || null,
        os: { name: osName.startsWith('Windows') ? 'Windows' : osName, version: osName === 'Windows 11' ? '10.0.22631' : osName === 'Windows 10' ? '10.0' : '' },
        storage: [],
        directX: null,
        vulkan: null,
      };
      try {
        const r = await post(`/api/games/${encodeURIComponent(slug)}/compare`, { spec });
        document.getElementById('quick-result').innerHTML = renderResult(r);
      } catch (err) {
        document.getElementById('quick-result').innerHTML = errorBox(err.message);
      }
    });
  }

  // Best-effort GPU name from WebGL's unmasked renderer string, e.g.
  // "ANGLE (NVIDIA, NVIDIA GeForce GTX 1060 6GB Direct3D11 vs_5_0 ps_5_0, D3D11)"
  // -> "NVIDIA GeForce GTX 1060 6GB". Returns '' when nothing useful is exposed.
  function detectGpu() {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl');
      const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
      const raw = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '') : '';
      const angle = /^ANGLE \((.*)\)$/.exec(raw);
      let name = raw;
      if (angle) {
        const parts = angle[1].split(', ');
        name = parts.length > 1 ? parts[1] : parts[0];
      }
      return name
        .replace(/\s*\(0x[0-9a-f]+\)/i, '')
        .replace(/\s+(Direct3D|OpenGL|Metal|Vulkan|vs_|ps_).*$/i, '')
        .replace(/\(R\)|\(TM\)/g, '')
        .trim();
    } catch (e) {
      return '';
    }
  }

  function viewManual(prefillSlug) {
    setView(`
      <h1>Enter your specs</h1>
      <p class="muted">For Mac, Linux, mobile, or any PC you do not want to scan. Games require Windows, so non-Windows systems will show a fail with a note.</p>
      <div class="card">
        <form id="manual-form">
          <div class="field"><label for="m-game">Game</label><div class="search"><input id="m-game" autocomplete="off" placeholder="Search a game"><input type="hidden" id="m-slug" value="${h(prefillSlug || '')}"></div></div>
          <div class="field"><label for="m-os">Operating system</label><select id="m-os"><option>Windows 11</option><option>Windows 10</option><option>macOS</option><option>Linux</option><option>Android</option><option>iOS</option></select></div>
          <div class="field"><label for="m-cpu">CPU</label><input id="m-cpu" list="m-cpu-list" autocomplete="off"><datalist id="m-cpu-list"></datalist></div>
          <div class="field"><label for="m-gpu">GPU</label><input id="m-gpu" list="m-gpu-list" autocomplete="off"><datalist id="m-gpu-list"></datalist></div>
          <div class="field"><label for="m-vram">Video memory (GB)</label><input id="m-vram" type="number" min="0" step="0.5"></div>
          <div class="field"><label for="m-ram">RAM (GB)</label><input id="m-ram" type="number" min="1" step="1" required></div>
          <div class="field"><label for="m-free">Free disk space (GB)</label><input id="m-free" type="number" min="0" step="1"></div>
          <div class="field"><label for="m-dx">DirectX</label><select id="m-dx"><option value="">Unknown</option><option>11</option><option selected>12</option></select></div>
          <div class="field"><label for="m-vk">Vulkan</label><select id="m-vk"><option value="">Unknown</option><option value="true">Supported</option><option value="false">Not supported</option></select></div>
          <button class="btn primary" type="submit">Compare</button>
        </form>
        <div id="manual-result"></div>
      </div>
    `);
    attachAutocomplete(document.getElementById('m-game'), (g) => {
      document.getElementById('m-game').value = g.name;
      document.getElementById('m-slug').value = g.slug;
    });
    wireHardwareList('m-cpu', 'm-cpu-list', 'cpus');
    wireHardwareList('m-gpu', 'm-gpu-list', 'gpus');
    document.getElementById('manual-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const slug = document.getElementById('m-slug').value;
      if (!slug) { document.getElementById('manual-result').innerHTML = errorBox('Pick a game from the search list.'); return; }
      const osName = document.getElementById('m-os').value;
      const vramGB = document.getElementById('m-vram').value;
      const free = document.getElementById('m-free').value;
      const vk = document.getElementById('m-vk').value;
      const spec = {
        cpu: { name: document.getElementById('m-cpu').value.trim() },
        gpus: [{ name: document.getElementById('m-gpu').value.trim(), vramMB: vramGB ? Math.round(Number(vramGB) * 1024) : null }],
        ramGB: Number(document.getElementById('m-ram').value),
        os: { name: osName.startsWith('Windows') ? 'Windows' : osName, version: osName === 'Windows 11' ? '10.0.22631' : osName === 'Windows 10' ? '10.0.19045' : '' },
        storage: [{ type: 'Unknown', freeGB: free === '' ? null : Number(free) }],
        directX: document.getElementById('m-dx').value ? Number(document.getElementById('m-dx').value) : null,
        vulkan: vk === '' ? null : vk === 'true',
      };
      try {
        const r = await post(`/api/games/${encodeURIComponent(slug)}/compare`, { spec });
        document.getElementById('manual-result').innerHTML = renderResult(r);
      } catch (err) {
        document.getElementById('manual-result').innerHTML = errorBox(err.message);
      }
    });
  }

  function wireHardwareList(inputId, listId, kind) {
    const input = document.getElementById(inputId);
    const list = document.getElementById(listId);
    let timer = null;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        try {
          const data = await api(`/api/hardware/${kind}?q=${encodeURIComponent(input.value.trim())}`);
          list.innerHTML = data.items.map((x) => `<option value="${h(x.name)}"></option>`).join('');
        } catch (e) { list.innerHTML = ''; }
      }, 150);
    });
  }

  function viewStatic(title, html) {
    setView(`<h1>${h(title)}</h1><div class="card">${html}</div>`);
  }

  const FAQ_HTML = `
    <h3>How does the check work?</h3>
    <p>We compare the hardware you give us (from the scanner, the browser check, or your manual entry) with the minimum and recommended requirements for a game. Each component gets a pass, fail or unknown result.</p>
    <h3>Why is a component "unknown"?</h3>
    <p>When a CPU or GPU is not in our benchmark database, we cannot compare it fairly. We do not guess.</p>
    <h3>What does the scanner send?</h3>
    <p>Only CPU, GPU and VRAM, RAM, OS, storage type and free space, DirectX/Vulkan support, and resolution. You preview the exact data before anything leaves your PC.</p>
    <h3>Can I keep everything local?</h3>
    <p>Yes. Choose "Save as JSON only" in the scanner and nothing is sent.</p>
    <h3>How long are results kept?</h3>
    <p>About 24 hours, then deleted. Your result token is random and not linked to you.</p>
    <h3>Is the scanner signed and open source?</h3>
    <p>The source is in this repository. Code signing depends on the certificate you use when you build it; see the README.</p>
    <h3>Why do you link to stores?</h3>
    <p>Some links are affiliate links. We may earn a commission at no extra cost to you. We label them.</p>`;

  const PRIVACY_HTML = `
    <p><strong>Draft text for review.</strong> This is a template. Have a qualified person review it before you publish.</p>
    <p>The scanner collects only the hardware fields listed in the FAQ. It never collects username, PC name, IP or MAC address, serial numbers, product key, installed software, files, location or device identifiers.</p>
    <p>Scan results are stored in server memory under a random token and deleted after about 24 hours. We keep anonymous aggregate counts (number of scans, games checked, pass rates). We do not keep IP addresses.</p>
    <p>We use local storage only if you accept cookies, to remember your last result token on this device. You can clear it at any time.</p>`;

  const TERMS_HTML = `
    <p><strong>Draft text for review.</strong> Replace with terms written for your business.</p>
    <p>Results are estimates based on publisher requirements and benchmark data. They are not a guarantee of performance. Game and product names are trademarks of their owners.</p>`;

  // ------------------------------------------------------ benchmark charts
  const BENCH_RADIUS = [2, 4, 8];

  function shortName(name) {
    return name.length > 18 ? name.slice(0, 17) + '…' : name;
  }

  // Bars drawn as 3D blocks (front, top and side faces) in an oblique projection.
  // items: [{ name, score, target }]. threshold: optional score, drawn as a dashed line.
  function benchChart(items, threshold) {
    const max = Math.max(1, ...items.map((i) => i.score), threshold || 0);
    const bw = 34;
    const gap = 26;
    const dx = 12;
    const dy = 9;
    const plotH = 180;
    const left = 30;
    const baseY = plotH + 26;
    const width = left + items.length * (bw + gap) + dx + 80;
    const height = baseY + 95;
    const yFor = (score) => baseY - Math.max(12, (score / max) * plotH);
    let svg = '';
    if (threshold) {
      const ty = baseY - (threshold / max) * plotH;
      svg += `<line class="bench-threshold" x1="${left - 8}" x2="${width - 80}" y1="${ty}" y2="${ty}"/>
        <text class="bench-axis" x="${width - 84}" y="${ty - 6}" text-anchor="end">required ${h(threshold)}</text>`;
    }
    items.forEach((it, idx) => {
      const x = left + idx * (bw + gap);
      const top = yFor(it.score);
      svg += `<g class="${it.target ? 'is-target' : ''}"><title>${h(it.name)}: score ${h(it.score)}</title>
        <polygon class="bench-side" points="${x + bw},${top + dy} ${x + bw + dx},${top} ${x + bw + dx},${baseY - dy} ${x + bw},${baseY}"/>
        <polygon class="bench-top" points="${x},${top + dy} ${x + dx},${top} ${x + bw + dx},${top} ${x + bw},${top + dy}"/>
        <rect class="bench-front" x="${x}" y="${top + dy}" width="${bw}" height="${baseY - top - dy}"/>
        <text class="bench-value" x="${x + (bw + dx) / 2}" y="${top - 6}" text-anchor="middle">${h(it.score)}</text>
        <text class="bench-label" transform="translate(${x + (bw + dx) / 2 - 4},${baseY + 14}) rotate(35)">${h(shortName(it.name))}</text>
      </g>`;
    });
    return `<svg class="bench-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="3D bar chart of benchmark scores">${svg}</svg>`;
  }

  // Loads the parts just above and below a benchmarked part into box, and draws them.
  async function loadNearby(kind, name, threshold, box, radius = 4) {
    box.hidden = false;
    box.innerHTML = '<p class="muted small">Loading benchmark neighbours…</p>';
    try {
      const data = await api(`/api/hardware/${kind}/nearby?name=${encodeURIComponent(name)}&radius=${radius}`);
      const label = kind === 'gpus' ? 'Graphics cards' : 'Processors';
      const buttons = BENCH_RADIUS.map((r) => `<button type="button" class="btn small${r === radius ? ' primary' : ''}" data-nearby="${kind}" data-name="${h(name)}"${threshold ? ` data-threshold="${h(threshold)}"` : ''} data-radius="${r}">±${r} parts</button>`).join('');
      box.innerHTML = `
        <p class="small muted">${label} near <strong>${h(data.target.name)}</strong>, ordered by score (higher is faster). The highlighted bar is the part you asked about.</p>
        <div class="bench-scroll">${benchChart(data.items, threshold)}</div>
        <div class="row">${buttons}</div>
        <p class="small muted">Source: Blender Open Data render benchmark (CC0). It measures 3D rendering, not game frame rates.</p>`;
    } catch (e) {
      box.innerHTML = errorBox(e.message);
    }
  }

  // A "Compare nearby" button under a CPU or GPU row of the result, with a chart box it fills.
  function compareBlock(c) {
    if (!c.hardware || (c.id !== 'cpu' && c.id !== 'gpu')) return '';
    const kind = c.id === 'cpu' ? 'cpus' : 'gpus';
    const threshold = c.requiredScore ? ` data-threshold="${h(c.requiredScore)}"` : '';
    return `<div class="compare-nearby">
      <button type="button" class="btn small" data-nearby="${kind}" data-name="${h(c.hardware)}"${threshold} data-radius="4">Compare nearby: ${h(c.label)} benchmarks</button>
      <div class="nearby-box" hidden></div>
    </div>`;
  }

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-nearby]');
    if (!btn) return;
    const box = btn.closest('.nearby-box') || btn.parentElement.querySelector('.nearby-box');
    if (!box) return;
    loadNearby(btn.dataset.nearby, btn.dataset.name, Number(btn.dataset.threshold) || null, box, Number(btn.dataset.radius) || 4);
  });

  function viewBenchmarks() {
    setView(`
      <h1>Benchmark results</h1>
      <p class="muted">Pick a graphics card or processor to see how it compares with the parts just above and below it in score.</p>
      <div class="card">
        <form id="bench-form" class="row" autocomplete="off">
          <select id="bench-kind" aria-label="Part type"><option value="gpus">Graphics card</option><option value="cpus">Processor</option></select>
          <input id="bench-q" list="bench-list" placeholder="e.g. RTX 3060" aria-label="Part name">
          <datalist id="bench-list"></datalist>
          <button class="btn primary" type="submit">Show chart</button>
        </form>
        <div class="nearby-box" id="bench-out"></div>
      </div>`);
    const input = document.getElementById('bench-q');
    const kindSelect = document.getElementById('bench-kind');
    const list = document.getElementById('bench-list');
    let timer = null;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        try {
          const data = await api(`/api/hardware/${kindSelect.value}?q=${encodeURIComponent(input.value.trim())}`);
          list.innerHTML = data.items.map((x) => `<option value="${h(x.name)}"></option>`).join('');
        } catch (e) { list.innerHTML = ''; }
      }, 150);
    });
    document.getElementById('bench-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const name = input.value.trim();
      if (name) loadNearby(kindSelect.value, name, null, document.getElementById('bench-out'));
    });
  }

  // ---------------------------------------------------------------- router
  function parseHash() {
    const raw = location.hash.replace(/^#/, '') || '/';
    const [pathPart, query = ''] = raw.split('?');
    const parts = pathPart.split('/').filter(Boolean).map(decodeURIComponent);
    return { parts, params: new URLSearchParams(query) };
  }

  async function route() {
    const { parts, params } = parseHash();
    setView('<p class="muted">Loading…</p>');
    try {
      const [a, b] = parts;
      if (!a) return viewHome();
      if (a === 'game' && b) return viewGame(b);
      if (a === 'search') return viewSearch(params.get('q') || '');
      if (a === 'az') return viewAZ(b && b !== 'all' ? b.toUpperCase() : null, Number(params.get('page')) || 1);
      if (a === 'popular') return viewPopular();
      if (a === 'recent') return viewRecent();
      if (a === 'lists') return viewLists();
      if (a === 'list' && b) return viewLists(b);
      if (a === 'pcs') return viewPcs();
      if (a === 'scan') return viewScan();
      if (a === 'report' && b) return viewReport(b);
      if (a === 'score') return viewScore();
      if (a === 'quick') return viewQuick();
      if (a === 'manual') return viewManual(params.get('game'));
      if (a === 'benchmarks') return viewBenchmarks();
      if (a === 'faq') return viewStatic('FAQ', FAQ_HTML);
      if (a === 'privacy') return viewStatic('Privacy policy', PRIVACY_HTML);
      if (a === 'terms') return viewStatic('Terms of service', TERMS_HTML);
      return setView(errorBox('Page not found.') + '<a href="#/">Home</a>');
    } catch (e) {
      setView(errorBox(e.message));
    }
  }

  // ---------------------------------------------------------- cookie banner
  function initCookies() {
    const banner = document.getElementById('cookie-banner');
    let choice = null;
    try { choice = localStorage.getItem(CONSENT_KEY); } catch (e) { choice = null; }
    banner.hidden = choice !== null;
    document.getElementById('cookie-accept').addEventListener('click', () => {
      try { localStorage.setItem(CONSENT_KEY, 'accepted'); } catch (e) { /* ignore */ }
      banner.hidden = true;
      if (token) setToken(token);
    });
    document.getElementById('cookie-decline').addEventListener('click', () => {
      try { localStorage.setItem(CONSENT_KEY, 'declined'); localStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ }
      banner.hidden = true;
    });
    document.getElementById('cookie-settings').addEventListener('click', () => { banner.hidden = false; });
  }

  window.addEventListener('hashchange', route);
  document.addEventListener('DOMContentLoaded', () => {});
  initCookies();
  route();
})();
