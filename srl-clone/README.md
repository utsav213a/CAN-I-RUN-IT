# Can I Run It: clone with hardware scanner

A clone of the "can my PC run it" tool at systemrequirementslab.com, rebuilt from scratch:

- **Web app** (Node.js, no npm dependencies): game search with autocomplete, minimum and recommended requirements, per-component pass/fail comparison, overall verdict, upgrade suggestions, "What will run it?" PCs, A–Z, popular, lists, "How many games can I run?", manual and browser-based entry, FAQ, privacy, terms, cookie consent.
- **Hardware scanner** (`scanner/scan.js`, single portable `.exe` after build): one-click Windows scan, preview of the exact data, send or save-as-JSON only, opens the report in the browser, no installer, no startup, no background service.

Nothing here is copied from the site. Its pages, URL pattern and the public scanner FAQ informed the feature list only.

---

## 1. Quick start

Requirements: **Node.js 20 or newer**. No `npm install` is needed.

```bash
cd srl-clone
npm start
```

Open http://127.0.0.1:3000 in a browser.

Run the tests:

```bash
npm test
```

Expected result: all 67 tests pass. That total includes the scanner tests in `tests/scanner.test.js`.

Environment variables (optional):

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `HOST` | `127.0.0.1` | Bind address. Use `0.0.0.0` only behind HTTPS and a proxy |
| `AFFILIATE_TAG` | `YOUR-AFFILIATE-TAG` | Tag appended to PC store links. Replace before launch |
| `SRL_SERVER` | `http://127.0.0.1:3000` | Server the scanner sends results to |

---

## 2. What the site does (investigation summary)

Public pages checked with WebFetch on the homepage, a requirements page (`/cyri/requirements/elden-ring/18888`) and the FAQ:

- Game requirement pages use `/cyri/requirements/{slug}/{numeric-id}`. Curated lists use `/cyri/game-lists/{slug}/{id}`. Other paths: `/cyri-score`, `/cyri/gaming-pc`, `/cyri/support/faq`, `/all-games-list/`.
- The requirements page lists CPU, RAM, VIDEO CARD, DEDICATED VIDEO RAM, PIXEL/VERTEX SHADER, OS, FREE DISK SPACE, SOUND CARD, for minimum and recommended.
- On the pages fetched, pass/fail and an overall verdict appear only in the popular-games list (percentages). The per-component verdict and upgrade wording on the game page was not visible in what I could fetch. The pass/fail and upgrade design here is my own.
- The site's scanner requires Windows. The FAQ says it collects CPU, GPU, RAM, OS, DirectX and sound card, and that `Detection.exe` can be deleted after the scan. It does not say whether it is open source, signed, portable, or has a local mode or a 24-hour retention period. Those points come from your feature list, not from the site.
- The `rea` reverse-engineering tools are built for binaries and live browser sessions. A public web page only needed WebFetch, so I did not use `rea`.

---

## 3. Feature status

| # | Feature | Status | Where |
|---|---|---|---|
| 1 | Game search with autocomplete | Done (keyboard and mouse) | `public/app.js` `attachAutocomplete`, `GET /api/games/search` |
| 2 | Requirements page (min and recommended) | Done | `#/game/:slug` |
| 3 | Hardware detection | Done: scanner app plus browser approximate check | `scanner/scan.js`, `#/quick` |
| 4 | Comparison engine, per component | Done | `server/compare.js` `evaluateTier` |
| 5 | Results report with overall verdict | Done | `checkGame`, `verdictFor` |
| 6 | Upgrade suggestions | Done (tiered: minimum and recommended) | `suggestUpgrades` |
| 7 | One-click scan | Done (double-click the exe) | `scanner/scan.js` |
| 8 | Preview before sending | Done | Local preview page |
| 9 | Local-only mode (JSON) | Done (`--local` and "Save as JSON only") | `saveJson` |
| 10 | Opens results in browser after scan | Done after send | `openInBrowser` |
| 11 | Open source | Done: this repository | — |
| 12 | Code-signed executable | **Not done.** Build script supports signtool, but you need a code-signing certificate | `scanner/build.js` |
| 13 | Portable, no installer | Done: one `.exe` (verified built and run on Windows 10) | `dist/SRL-Hardware-Check.exe` |
| 14 | No background service, no startup | Done: the process exits itself, no registry or startup entries | `scan.js` |
| 15 | Collects only the allowed fields | Done | `shared/sanitize.js`, `PS_SCRIPT` |
| 16 | Never collects identifiers | Done, and tested (the sanitiser drops and the tests check for leaks) | `tests/parser-and-names.test.js` |
| 17 | Anonymous result token | Done, but **not strictly one-time**: the token works for viewing until it expires | `server/reports.js` |
| 18 | Results deleted after about 24 hours | Done, in memory. A server restart also clears them | `ReportStore` |
| 19 | Popular games with pass % | Done. Empty until real checks exist | `stats.popular` |
| 20 | Test multiple games (curated lists) | Done (2 sample lists) | `data/lists.json` |
| 21 | "How many games can I run?" | Done | `POST /api/score` |
| 22 | Recently added | Done (from `addedAt` on import) | `#/recent` |
| 23 | A–Z list | Done (paged) | `#/az/:letter` |
| 24 | "What will run it?" with affiliate links | Done. **Links are placeholders** (`example.com`) | `data/pcs.json` |
| 25 | Manual entry (Mac, Linux, mobile) | Done. Non-Windows systems show a fail with a note | `#/manual` |
| 26 | Browser quick detection | Done, approximate. CPU must be typed; RAM is capped at 8 GB by browsers | `#/quick` |
| 27 | FAQ | Done | `#/faq` |
| 28 | Privacy policy and terms | Drafts only. **Have a lawyer review them** | `#/privacy`, `#/terms` |
| 29 | Cookie consent | Done: stores the token only if accepted | cookie banner |
| 30 | Games database (19,000+) | **602 games loaded (about 600 most-owned Steam games). The full 19,000+ import is not done** and takes a day or more (see section 4a). Source: Steam store data | `scripts/steam-*.js`, `scripts/build-games.js` |
| 31 | CPU and GPU database with benchmark scores | **Done from a public source (CC0), render benchmark only.** About 446 CPUs and 183 GPUs, scored from Blender Open Data. Gaming benchmarks are still missing (see section 4b) | `scripts/build-benchmarks.js`, `data/cpus.json`, `data/gpus.json` |
| 34 | Popular games (500+) with requirements | **Done.** Top most-owned Steam games, with requirements | `scripts/steam-popular.js`, `scripts/steam-details.js --from` |
| 35 | 3D benchmark charts with "compare nearby" | **Done.** Shown on the result page and on `#/benchmarks` | `public/app.js` (`benchChart`), `GET /api/hardware/{cpus,gpus}/nearby` |
| 32 | Requirements parser (free text to structured) | Done | `server/parser.js` |
| 33 | Anonymous aggregate stats | Done: counts only, no IPs or tokens | `server/stats.js`, `GET /api/stats` |

---

## 4. Data: what you must replace before launch

**The comparison results are only as accurate as the data.** Three things need real data:

1. **Games (feature 30).** `data/games.json` has 3 games:
   - `elden-ring`: requirements copied from the site's page, which I fetched.
   - `cyberpunk-2077` and `baldurs-gate-3`: **placeholder specs marked `sample-unverified`**. Verify them against publisher pages before use. The UI shows a warning on these pages.

   Add games with a CSV or JSON file in the format of `data/raw/sample-games.csv`, then import:

   ```bash
   node scripts/import-games.js path/to/your-games.csv
   ```

   The importer parses the free-text requirement blocks, reports warnings for anything it cannot read (for example a missing processor), and merges by slug. Check the publisher terms and the source site's terms before bulk-collecting data. Do not scrape the competitor's site without permission.

2. **Benchmark scores (feature 31).** `data/cpus.json` and `data/gpus.json` are built from **Blender Open Data** (CC0). See section 4b. These are **render** scores, not gaming frame rates. Scores are comparable only within the same file (CPUs against CPUs, GPUs against GPUs).

3. **Affiliate links.** Set `AFFILIATE_TAG` and replace the `example.com` URLs in `data/pcs.json`. The UI already labels these as affiliate links.

Unknown hardware is marked **Unknown**, never Fail. This is on purpose. Add the part to the benchmark file to get a real result.

### 4a. Full game import from Steam

The full catalogue comes from Steam's public store API (`appdetails`, which returns each game's PC requirements as HTML). Three steps, each resumable:

```bash
npm run import:steam:list      # 1. app IDs and names (SteamSpy "all" list, ~1 page per minute)
npm run import:steam:details   # 2. requirements per app (Valve limit: about 200 requests per 5 minutes)
npm run build:games            # 3. write data/games.json and print the hardware match rate
```

- Step 2 appends to `data/raw/steam-details.ndjson`. Run it again to resume after an interruption. Add `--limit 100` to test.
- The run takes **many hours**. Steam lists about 90,000 apps, including DLC, tools and software. Only `type: game` entries with PC requirements are kept.
- Hand-checked rows in `data/raw/sample-games.csv` override store data for the same game.
- Data is fetched from third parties under their terms. Check that your use is allowed before you launch commercially. Valve's and SteamSpy's terms restrict heavy use of their services.
- **Hardware is the bottleneck.** `build:games` reports how many games have both a CPU and GPU that the benchmark database can resolve. Until `data/cpus.json` and `data/gpus.json` contain the hardware named in store requirements, most components show **Unknown**. To fix this, supply licensed benchmark data in the same format.

### 4b. Popular games and benchmark data

**Popular games (500+).** `steam-popular.js` reads SteamSpy's most-owned list (two pages, about two minutes). `steam-details.js --from` then fetches store requirements in that order and stops after `--keep` games. The 600 most-owned games take about 20 to 25 minutes.

```bash
npm run import:steam:popular                                  # most-owned Steam apps, saved in owner order
node scripts/steam-details.js --from data/raw/steam-popular.json --keep 600
npm run build:games
```

**Benchmarks.** `build-benchmarks.js` reads the Blender Open Data snapshot (`opendata-latest.zip`, CC0 1.0). Each run renders the standard `bmw27` scene on one device. The script takes the median time per model (at least 5 runs), converts it to a score (`100000 / seconds`, higher is faster), and writes `data/cpus.json` and `data/gpus.json`. Video memory comes from the name ("GTX 1060 6GB") or from the RightNow GPU database (Apache 2.0, specs sourced from TechPowerUp).

```bash
# download https://opendata.blender.org/snapshots/opendata-latest.zip and unzip it
# download https://raw.githubusercontent.com/rightnow-ai/rightnow-gpu-database/main/data/all-gpus.json
npm run build:benchmarks -- path/to/opendata.jsonl --rightnow path/to/all-gpus.json
```

Limits to know before launch:

- **Render, not games.** Blender scores rank hardware for 3D rendering. They correlate with gaming speed but are not frame rates. A licensed gaming benchmark source would be better.
- **Coverage.** Models nobody has rendered on are missing, for example the Ryzen 7 7800X3D in the current build. Those components show **Unknown**.
- **Not a benchmark for every SKU.** Laptop and desktop variants with the same name can differ. The most-tested variant owns a short name such as "GTX 1060".

**Benchmark charts.** Each CPU or GPU row on a result page has a **Compare nearby** button. It draws the parts just above and below yours by score, as 3D bars, with the game's required score as a dashed line. The `#/benchmarks` page does the same for any part you search for. The API is `GET /api/hardware/cpus/nearby?name=...&radius=4`.

### Requirements parser

`server/parser.js` reads text such as:

```
OS: Windows 10 Processor: Intel Core i5-8400 | AMD Ryzen 3 3300X
Memory: 12 GB RAM Graphics: Nvidia GeForce GTX 1060, 3GB | AMD Radeon RX 580, 4GB
Video RAM: 3 GB Storage: 60 GB
```

and returns `os.minVersion`, `cpu.alternatives`, `ramGB`, `gpu.alternatives`, `gpu.vramMB`, `directX`, `storageGB`, and `vulkan`.

---

## 5. Hardware scanner

### Run from source (Windows, Node 20+)

```bash
node scanner/scan.js           # scan, preview, then send or save
node scanner/scan.js --local   # scan, save JSON only, no network
node scanner/scan.js --print   # print the data that would be sent
node scanner/scan.js --demo    # sample data, works on any OS (for testing)
```

Default flow: the scanner reads the hardware through PowerShell (`Get-CimInstance`, registry, DLL presence checks). It opens a local preview page on `127.0.0.1` with a random path. You see the exact JSON, then choose **Send**, which posts to the server and opens the report, or **Save as JSON only**, which writes `srl-scan-<timestamp>.json` next to the program. The process exits after the action (60 seconds) or after 10 minutes idle.

### What it collects, and what it never collects

| Collected | Never collected |
|---|---|
| CPU name, cores, threads, clock speed | Username, PC name |
| GPU name and video memory | IP address, MAC address |
| RAM size | Serial numbers, product key |
| OS name and version, 64-bit flag | Installed software, files |
| System drive type (SSD, HDD, NVMe) and free space | Location, device IDs (PNP IDs, processor ID) |
| DirectX 11/12 (DLL check), Vulkan (DLL check) | |
| Screen resolution | |

The same allowlist (`shared/sanitize.js`) runs in the scanner and again on the server. A test checks that identifiers are dropped.

### Build the portable `.exe`

```bash
node scanner/build.js
```

This produces `dist/SRL-Hardware-Check.exe` using Node's single-executable feature. It needs network access the first time, for `npx postject`. **I built and ran this exe on Windows 10** (`--print` and `--local` work).

To serve it from the website, copy it to `public/downloads/SRL-Hardware-Check.exe`. The exe embeds the Node.js runtime, so it is large (about 95 MB in my build). It is not included in this source tree.

### Code signing (not done)

You need a code-signing certificate (OV or EV). Install Windows SDK `signtool`, then:

```powershell
$env:SIGNTOOL_CERT = "C:\certs\your-cert.pfx"
$env:SIGNTOOL_PASSWORD = "your-pfx-password"
node scanner/build.js
```

An EV certificate builds SmartScreen reputation faster than an OV certificate. The build script runs `signtool remove` first, because injecting the blob breaks Node's own signature.

### Known scanner limitations

- DirectX and Vulkan are detected by checking for `d3d12.dll`, `d3d11.dll` and `vulkan-1.dll` in System32. This shows support, not the exact runtime version.
- Storage is the system drive's media type and free space. Games installed on another drive may need a different check.
- Video memory comes from the display-class registry value, falling back to `AdapterRAM`, which is capped at 4 GB.
- The collection was tested on one Windows 10 laptop (Intel HD 4000). Test on more hardware before release.

---

## 6. API reference

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Status and game count |
| GET | `/api/stats` | Anonymous totals |
| GET | `/api/games/search?q=&limit=` | Autocomplete |
| GET | `/api/games?letter=&page=&pageSize=` | A–Z list |
| GET | `/api/games/letters` | Letters with counts |
| GET | `/api/games/recent` | Recently added |
| GET | `/api/games/:slug` | Requirements (min and recommended) |
| POST | `/api/games/:slug/compare` | Body: `{token}` or `{spec}`. Returns verdict, components, upgrades, PCs |
| POST | `/api/compare` | Same, with `slug` in the body |
| POST | `/api/scan` | Body: `{scan}`. Returns `{token, expiresAt}` |
| GET | `/api/scan/:token` | Returns the stored scan (404 or 410 if gone or expired) |
| POST | `/api/score` | "How many games can I run?" |
| GET | `/api/popular` | Most checked games with pass % |
| GET | `/api/lists`, `/api/lists/:id?token=` | Curated lists, with verdicts when a token is given |
| GET | `/api/pcs` | Recommended PCs (affiliate links) |
| GET | `/api/hardware/cpus?q=`, `/api/hardware/gpus?q=` | Hardware lookup for forms |

Errors are JSON: `{"error": "..."}`. Request bodies are capped at 256 KB. Responses carry a Content-Security-Policy, `nosniff`, and `no-referrer`.

---

## 7. Project layout

```
srl-clone/
  server/
    index.js        start-up
    app.js          routes, validation, static files, security headers
    compare.js      comparison engine, verdicts, upgrade suggestions, PC recommendations
    parser.js       free-text requirements to structured specs
    store.js        in-memory catalogue (search, A–Z, recent)
    reports.js      anonymous scan results with 24-hour expiry
    stats.js        anonymous aggregate counters
  shared/
    names.js        name normalisation and slugs
    sanitize.js     the allowlist of fields that may leave a PC
  scanner/
    scan.js         Windows hardware scanner (preview, send, save)
    build.js        builds the portable exe (SEA)
  public/           single-page front end (HTML, CSS, vanilla JS)
  data/             games, CPUs, GPUs, PCs, lists (JSON); raw/ for importer input
  scripts/import-games.js
  tests/            node:test suites (67 tests in total, including the scanner and benchmarks)
```

---

## 8. Test results

Automated (`npm test`): all 67 tests pass, 9 of them scanner tests.

Benchmark and popular-game checks (this round):

- Benchmark build: 446 CPUs and 183 GPUs from the Blender Open Data snapshot (1.9 GB JSONL, CC0).
- Requirement match: 142 of 602 games (23.6%) have both a resolvable minimum CPU and GPU. The rest are mostly older hardware (Pentium 4, Core 2 Duo, GTX 460, HD 3000) that rendering users rarely submit. Those components show Unknown, not Fail.
- Browser: the `#/benchmarks` chart and the result-page "Compare nearby" chart render as 3D bars, highlight the matched part, draw the required score as a dashed line, and do not scroll the page sideways at 768 px.

Manual checks in the in-app browser against the running server:

- Autocomplete: typing "cyb" lists Cyberpunk 2077. Arrow keys and Enter open the game page.
- Game page with a stored scan: the verdict and component table render. Upgrade suggestions target the tier that failed.
- Quick browser check: the GPU name from WebGL is cleaned up. Verdict is correct for an 8 GB browser report.
- Manual entry: macOS gives a fail with "This game requires Windows".
- A–Z, lists, FAQ, score (with and without a scan): render correctly.
- Mobile width (375 px): no horizontal page scroll.
- Scanner preview: the page sends the demo payload, the server returns a token, and the page shows it. This found and fixed a double-slash bug in the preview page.

Bugs fixed during testing:

1. Upgrade suggestions used the minimum spec for recommended-only failures (for example, it suggested a CPU below what the PC already had).
2. The scanner preview page built `//send` URLs, so the send returned 404.
3. The WebGL GPU name was not cleaned up (raw ANGLE string).
4. The A–Z page said "1 games".

Not tested: a real signed exe on a clean Windows install; the scanner's browser-opening step (suppressed in tests); real hardware beyond one laptop.

---

## 9. Deployment notes

- Put the Node process behind HTTPS (for example nginx or Caddy). Set `HOST=127.0.0.1` and proxy to it.
- Results live in memory. Run one process, or move `ReportStore` to Redis if you scale out.
- `data/stats.json` keeps aggregate counts only. Back it up if you want history.
- Before launch, review `#/privacy` and `#/terms` with counsel, and check the scanner's data handling against the store's policies (for example Microsoft Store rules if you list it there).
- The name "Can I Run It" is used by other sites. Choose your own brand name before launch.
