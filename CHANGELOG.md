# Changelog

All notable changes to this project are documented here. Format roughly follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project follows [SemVer](https://semver.org/) (pre-1.0 minor bumps may include breaking changes — read the entry).

## [0.2.0] — Unreleased

### Added

- **Plate + VIN tap-to-copy on /maintenance.** New card between the
  vehicle picker and reminders shows the active vehicle's license
  plate and VIN. Tap either row → value copies to the clipboard,
  row flashes `Copied ✓` for ~1.5 s. Rows hide individually when
  the field is empty in LubeLogger; card hides entirely when both
  are empty. Server now hoists VIN out of `extraFields[]` into a
  top-level `vin?` field on `/api/vehicles`. See
  [`docs/user/app-pages.md`](docs/user/app-pages.md) and
  [`docs/technical/vehicle-identifiers.md`](docs/technical/vehicle-identifiers.md).
- **About menu — version + GitHub link.** Drawer footer now shows the
  running app version (e.g. `v0.2.0`) and a `GitHub ↗` link to the
  source repo. Version is injected at build time from
  `package.json#version` via a Vite `define`, so it stays in sync with
  whatever `release-ship` bumped to. See
  [`docs/user/app-pages.md`](docs/user/app-pages.md).
- **Photo OCR for gas-pump displays.** New camera chip between Volume
  and Cost on the main form. Tap → iOS camera → server-side OCR (local
  ollama, OpenRouter Gemini Flash Lite fallback) → confirm chip with
  `[Use]` / `[Discard]` that populates Volume, Volume unit, and Cost.
  Cross-field consistency (cost ≈ volume × price/unit within 5%) guards
  against OCR confusion.
- **Photo OCR for odometer readings.** Smaller camera chip inside the
  Odometer cell. Reads either a dashboard odometer or a phone-app
  screenshot showing mileage. Client-side relative-range check vs the
  last fillup (≥ last, ≤ last + 2000 mi) surfaces an amber warning
  chip when out-of-band.
- **`POST /api/ocr`** — multipart photo → discriminated `OcrResult` JSON
  (pump or odometer). **`GET /api/ocr`** — status probe returning
  `{ enabled, modes? }`. Receipt mode is wire-accepted but returns 501
  (reserved for v0.2.1). See
  [`docs/technical/idb-and-api.md`](docs/technical/idb-and-api.md).
- **Provider chain.** When both ollama and OpenRouter are configured,
  ollama is tried first; OpenRouter is the single bounded fallback.
  Audit log records which provider actually served the request and
  whether a fallback occurred.
- **Per-IP sliding-window rate limit** (default 20/hr) and
  **daily $ budget** (default $1.00 USD/day, UTC rollover) — both
  fail-closed, mapped to 429 / 402.
- **HMAC-keyed JSONL audit log** at `/data/ocr-audit.jsonl`. Records
  HMAC-hashed IP (HMAC key auto-generated to `/data/ocr-audit-key.txt`
  on first run with `0600` perms, or overridden via
  `OCR_AUDIT_HMAC_KEY`), SHA-256 image hash, parsed numeric fields,
  latency, provider, and fallback flag. No raw IPs, no pixels. Rotates
  destructively at 10 MiB.
- **17 new env vars** — all optional with defaults. Feature activates
  iff `OLLAMA_VISION_URL` or `OPENROUTER_API_KEY` is set. Full
  reference: [`docs/user/configuration.md`](docs/user/configuration.md#photo-ocr-v020).
- **Client image preprocess** (`resizeForOcr`) — 1024 px long edge,
  JPEG q=0.8, EXIF stripped via Canvas re-encode. Honors EXIF
  orientation via `createImageBitmap({ imageOrientation: 'from-image' })`
  where available. GPS coordinates never leave the device.
- **Client fetch timeout** — 90 s `AbortSignal.timeout` on `/api/ocr`
  POST; surfaces a "OCR took too long" toast on timeout.
- New user guide: [`docs/user/photo-ocr.md`](docs/user/photo-ocr.md).
  Internals doc:
  [`docs/technical/photo-ocr.md`](docs/technical/photo-ocr.md).
- **Photo preview screen.** Between picker and OCR submit, a
  full-screen preview lets you rotate the image (`[↺]` / `[↻]`),
  retake (re-opens the same picker), cancel (no OCR call), or
  `[Send for OCR]`. Rotation is CSS-only while previewing — no
  re-encode — and is applied as a single canvas transform on submit
  alongside the existing resize. Component:
  [`src/lib/client/OcrPreview.svelte`](src/lib/client/OcrPreview.svelte).
- **Smart checks at submit time.** New advisory chip catches
  logically-inconsistent or obviously-typo'd fillups before they POST —
  lower odometer than the last fillup, older date with higher odometer,
  same-day duplicate within 5 mi, future date, odometer jump > 2,000 mi,
  and volume under 0.5 gal / 2 L. Each issue renders as one line in a
  consolidated amber chip with a single `[Submit anyway]` override. Six
  checks ship in v0.2.0; a cost / volume ratio check is deferred to a
  future release. User guide:
  [`docs/user/smart-checks.md`](docs/user/smart-checks.md). Internals:
  [`docs/technical/smart-checks.md`](docs/technical/smart-checks.md).
- **Settings → Smart checks toggle.** New on/off card in `/settings`,
  default `On`. Persists in localStorage as
  `quicklogger.prefs.smartChecksEnabled`.

### Changed

- `.env.example` and `compose.example.yml` gain a commented Photo OCR
  block with placeholders.
- **Photo OCR capture row.** Both photo triggers (`Pump display photo`,
  `Odometer photo`) now live in a single row at the top of the form,
  directly under the vehicle picker. Inline triggers are gone; OCR
  result chips render full-width in a single feedback zone under the
  capture row instead of next to the field they fill. Renamed from the
  v0.2.0 dev labels (`Photo pump display`, `Photo`) to self-describing
  copy that no longer depends on inline placement. The `+N mi`
  increment chip stays in the odometer cell.
- **Gallery picker on iOS.** Dropped the `capture="environment"`
  attribute on both photo file inputs so iOS users get the native
  chooser sheet (Take Photo / Photo Library / Choose File) instead of
  jumping straight to the camera. Android picker behavior is
  unchanged. See [`docs/user/photo-ocr.md`](docs/user/photo-ocr.md).
- **Odometer relative-range warnings are now advisory.** The amber
  chip that fires when an OCR'd odometer is lower than the last
  fillup, or more than 2,000 mi above it, gains a `[Use anyway]`
  action that writes the detected value to the Odometer field.
  `[Dismiss]` still leaves the field untouched. Reason: legitimate
  cases (replaced cluster, long road trip, odometer rollover) deserve
  a one-tap path through, not a re-shoot loop. Server-side absolute
  bound (`OCR_ODOMETER_MAX_MI`) is unchanged and still blocking.
- `resizeForOcr` accepts an optional `{ rotation: 0 | 90 | 180 | 270 }`
  applied in the same canvas pass as the resize. `postOcr` accepts
  an optional `rotation` arg and adds a wire-additive `rotation`
  form field (omitted when 0, so old clients are byte-identical).
- `/api/ocr` POST now reads an optional `rotation` form field; the
  audit log records `rotationApplied: number` on every row (always
  present, defaults to 0). JSONL field-additive — old log readers
  ignore the field; rollback leaves rows without it.
- `prefs.ts` gains a sixth field, `smartChecksEnabled` (default `true`).
  Free migration via the existing spread-merge in `loadPrefs()`.
- `ODOMETER_MAX_DELTA_MI` (2,000) is now exported from
  `src/lib/client/smart-checks.ts`; the OCR-side relative-range warning
  in `src/routes/+page.svelte` imports from there instead of declaring
  its own copy, so the smart-check evaluator and the OCR warning share
  one source.

### Fixed

### Tests

- Unit suites: `ocrRateLimit`, `ocrBudget`, `ocrAudit` (incl. HMAC key
  resolution), `ocrProviders` (Ollama, OpenRouter, Chain — msw-backed),
  `ocrModes` (per-mode prompt/schema/validators incl. pump cross-field
  drift), `ocr` (sniff, `selectProvider`, `runOcrPipeline`),
  `routes/api/ocr` (POST + GET, status codes, rate-limit, mode
  whitelist).
- e2e spec [`tests/e2e/ocr-flow.spec.ts`](tests/e2e/ocr-flow.spec.ts):
  pump happy path, pump discard, odometer happy path, odometer warnings
  (lower / too-high), chips-hidden-when-disabled, 429/502/422 toasts.
- New unit specs: `src/lib/client/image.test.ts` (rotation cases for
  `resizeForOcr`), `src/lib/client/OcrPreview.test.ts` (preview state
  machine — rotation cycle, submit/cancel/retake events, ESC key,
  ObjectURL lifecycle).
- Extended `src/lib/server/ocrAudit.test.ts` to cover `rotationApplied`
  round-trip.
- New e2e spec [`tests/e2e/ocr-preview.spec.ts`](tests/e2e/ocr-preview.spec.ts):
  preview opens between picker and OCR, Cancel suppresses the OCR call,
  rotate-then-send POSTs the form field, no-rotate-send stays
  byte-compatible.
- Existing pump/odometer/error-path specs in
  [`tests/e2e/ocr-flow.spec.ts`](tests/e2e/ocr-flow.spec.ts) updated to
  click `[Send for OCR]` after picking the file.
- New unit suite [`src/lib/client/smart-checks.test.ts`](src/lib/client/smart-checks.test.ts):
  per-check boundary cases (A/B/C/D/E/G), aggregator ordering, the
  test-injectable `now` arg for check D, and the year-boundary lex
  comparison.
- Extended [`src/lib/client/prefs.test.ts`](src/lib/client/prefs.test.ts)
  for the new `smartChecksEnabled` field — default, round-trip,
  cross-key preservation, and legacy-JSON migration via spread-merge.
- New e2e spec [`tests/e2e/smart-checks.spec.ts`](tests/e2e/smart-checks.spec.ts):
  clean submit, single-issue chip with override, multi-issue chip,
  field-edit-clears-chip, master toggle off.

## [0.1.4] — 2026-05-13

### Added

- **Maintenance page** (`/maintenance`) — shows LubeLogger reminders flagged as `Urgent`, `VeryUrgent`, or `PastDue` for the active vehicle. New drawer entry between History and Vehicles. The Log Fuel page auto-navigates here after a successful fuel submit so you see what's coming up next without reaching for the menu. Read-only — managing reminders still happens in LubeLogger. Includes an inline vehicle picker card mirroring the one on Log Fuel; the `/vehicles` page is now return-aware via a `?from=` query, so picking from Maintenance lands you back on Maintenance instead of Log Fuel. See [`docs/user/app-pages.md`](docs/user/app-pages.md) and [`docs/technical/maintenance-page.md`](docs/technical/maintenance-page.md).

### Changed

- Last-fillup strip now shows the absolute date alongside the relative phrase: `Last fill: 45,123 mi · May 5, 2026 (7 days ago)` instead of `7 days ago` alone. Locale pinned to en-US for cross-device determinism. New `formatLastFillupDate` helper in `src/lib/client/format.ts` (unit-tested in `format.test.ts`).
- **History page redesign** — `/history` now lists every fillup logged through this PWA as roomy cards (one per entry, newest first), with a status badge for queued / failed entries and date, odometer, volume·cost, optional fill-to-full / missed-fillup / notes / tags lines. Replaces the JSON dump and the misnamed "Pending sync" section. New `formatIsoDate` helper in `src/lib/client/format.ts` (unit-tested in `format.test.ts`). Vehicle row mirrors `/maintenance` and round-trips through `/vehicles?from=history`. Reads the existing IDB `pendingSubmissions` store — no new server endpoint. See [`docs/user/app-pages.md`](docs/user/app-pages.md) and [`docs/technical/history-page.md`](docs/technical/history-page.md).

### Fixed

- Queue replay also triggers on `document` `visibilitychange` (in addition to `window` `focus`), covering desktop and Android multi-window scenarios where a tab can become visible without firing focus. SvelteKit layout `onMount` now wires both listeners and removes both on unmount. See [`docs/technical/service-worker.md`](docs/technical/service-worker.md#queue-replay).

### Removed

- `exchangerate-api` FX provider — never part of the supported default chain and required a paid API key. Dropped the `FxProviderName` union member, `KNOWN_FX_PROVIDERS` set entry, `realFetcher` switch case, `Env.exchangerateApiKey` field, and the related env tests. `EXCHANGERATE_API_KEY` is no longer recognized; leftover values in `.env` files are silently ignored.

## [0.1.3] — 2026-05-11

### Added

- **Last-fillup strip** above the vehicle picker on the main form: `Last fill: {odometer} mi · {days ago}` on line one, `{volume} Gal · ${cost} · {notes}` on line two. Renders whenever a previous fillup exists. Phase A from the v0.2.0 OCR plan, shipped early.
- **Odometer prefill** — form opens with the last reading already in the field, muted with a `prefilled` tag until first interaction. Settings toggle (default on).
- **`+N mi` chip** below the odometer field — one-tap increment that stacks across multiple taps. Configurable in Settings (default 300 mi). Set to 0 to hide the chip.
- New `formatOdometer` and `daysAgo` helpers in `src/lib/client/format.ts` (unit-tested in `format.test.ts`).
- New user guide [`docs/user/odometer-prefill.md`](docs/user/odometer-prefill.md) documenting the feature, configuration, and common patterns.
- **Offline odometer prefill** — the strip and field-prefill keep working
  when `/api/vehicle/last-fuelup` is unreachable. A per-vehicle
  `localStorage` snapshot of the latest upstream fetch and `'synced'`
  IndexedDB queue entries (created by both successful submits and the
  service-worker replay) are consulted by `resolveOfflineLastFillup` in
  `src/lib/client/last-fillup.ts`. Strip renders an amber `offline copy`
  chip when source is local; queue-derived rows render `<currency> <cost>`
  to avoid implying FX conversion happened. Internals doc:
  [`docs/technical/offline-odometer-prefill.md`](docs/technical/offline-odometer-prefill.md).
- `.env.example` at repo root — full template with placeholders for required vars and commented defaults for optional vars.
- User docs: `docs/user/offline-queue.md`, `docs/user/currency-fx.md`, `docs/user/app-pages.md` (Log Fuel + Vehicles + Settings + History tour), `docs/user/configuration.md` (full env-var reference).
- Technical docs: `docs/technical/offline-queue.md`, `docs/technical/fx-chain.md`, `docs/technical/service-worker.md`, `docs/technical/idb-and-api.md`.

### Changed

- `prefs.ts` adds two fields: `odometerPrefillEnabled` (default `true`), `odometerIncrementMi` (default `300`). Existing localStorage entries pick up the new defaults via the existing spread-merge load path — no migration code needed.
- Form submission now requires odometer, volume, cost, and date — all four must be present and the numeric fields must be `> 0`. Server enforces the same on `/api/fuelup` so external consumers (Apple Shortcuts, direct callers) get a 400 instead of silently accepting an incomplete record.
- `Queue` (`src/lib/client/idb.ts`) gains a third status `'synced'`
  alongside the existing `'queued'` and `'failed'`. `Queue.enqueue` accepts
  an optional explicit status (default `'queued'`) so the form's success
  path can record `'synced'` directly. New `Queue.markSynced(id)` method.
  Schema unchanged — IndexedDB version stays at `1`; existing
  `'queued'`/`'failed'` rows on upgraded devices persist.
- Service worker replay (`src/service-worker.ts`) now calls
  `q.markSynced(entry.id)` on a successful POST instead of
  `q.remove(entry.id)`. In-flight queued entries that previously
  disappeared on success now stay as `'synced'` rows.
- `.gitignore` now blocks ` 2.`-style Finder/iCloud duplicate artifacts.
- Repo hygiene pass: lint, type-check, tests, build verified green. `npm audit` and `npm outdated` snapshots captured in commit message for follow-up.
- Untracked `.vscode/extensions.json` to match `.gitignore` intent.
- `compose.example.yml` image tag → `:latest` for pull-and-restart workflows. Comment block explains the trade-off vs version-pinning.
- Dropped `EXCHANGERATE_API_KEY` from `.env.example` — the `exchangerate-api` provider isn't part of the supported default chain; code-side cleanup tracked separately.
- Consolidated `shortcuts/` recipes into `docs/user/shortcuts.md` as quick-reference appendix sections. Top-level `shortcuts/` directory removed; `.dockerignore` updated.
- `docs/architecture.md` trimmed to a high-level map; details moved to the four new focused technical docs.
- `README.md` restructured: Built-with-Claude-Code disclosure now at top, new Quick start section, Configuration table moved to `docs/user/configuration.md`, §Contributing now links `docs/uat.md`.
- `docs/technical/idb-and-api.md` now also documents the LubeLogger upstream call mapping (camelCase reads vs lowercase writes, `LubeLoggerError` semantics, per-request timeout); content consolidated from `docs/api-mapping.md`.
- `docs/architecture.md` rewritten as a clean high-level map: filled the empty Overview, Data flow, and LubeLogger client sections (previously stale `(populated in Task N)` placeholders); trimmed the over-detailed `/` main-form section that duplicated content now in user/technical docs; added an ASCII system diagram and a fillup-submission data-flow walkthrough.

### Removed

- macOS Finder-duplicate artifacts that landed in the working tree via iCloud sync.
- `docs/api-mapping.md` — content folded into `docs/technical/idb-and-api.md`. Single canonical place for HTTP API + LubeLogger upstream mapping.

### Tests

- New unit specs for `formatOdometer` and `daysAgo`.
- Extended `prefs.test.ts` to cover the two new fields' defaults and round-trip.
- New e2e specs `last-fillup.spec.ts` (strip rendering, presence/absence) and `odometer-prefill.spec.ts` (prefill state, chip increment, multi-tap, manual edit, hide-when-zero, hide-when-disabled).
- New manual UAT checklist section in `docs/uat.md`.
- Extended `idb.test.ts` to cover the `'synced'` status, `markSynced`, and
  the explicit-status `enqueue` path.
- New unit specs for `resolveOfflineLastFillup` in
  `last-fillup.test.ts` covering cache-only, queue-only, both-present
  freshest-pick, tied-date tiebreak, per-vehicle scoping, `'failed'`
  exclusion, normalization (L→gal, ISO→`M/D/YYYY`, cost currency carry).
- New e2e spec `offline-odometer-prefill.spec.ts` covering the cache and
  queue-derived offline paths plus the upstream-up regression check.
- New manual UAT block "Offline odometer prefill (v0.1.3)" in
  `docs/uat.md`.

## [0.1.2] — 2026-05-08

### Added

- **Compose hardening directives** baked into `compose.example.yml`: `read_only: true`, `tmpfs: /tmp`, `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`, `pids_limit: 100`, `mem_limit: 256m`. Documented in [`docs/deployment.md`](docs/deployment.md) § *Hardening the runtime*. Same set applied to the upstream homelab stack.
- README "Security posture" section linking to the hardening write-up.
- Screenshot grid expanded to 4 columns (Log Fuel | Vehicles | Settings | History) — `history.jpeg` added now that `/history` is reachable from the drawer.
- "Built with Claude Code" credit in README.

### Changed

- Drawer label "Log fillup" → **"Log Fuel"**.
- Volume toggle pill text "gal" → **"Gal"** (matches `L`'s capital convention). Internal state values stay lowercase.
- Notes field is now **always expanded** as a regular form field. Removed the dashed-outline expand/collapse affordance and the `extrasOpen` state.
- Volume + Cost right-side controls pinned to identical `w-20` (80px) for visual alignment.
- Toggle pill padding tightened (`px-2 py-1.5`) so both pills fit in the new 80px column.

### Fixed

- **Vehicle picker actually changes the vehicle.** `pick()` now navigates to `/?vehicleId=<id>` instead of `/`, so the form's loader picks up the selected vehicle (was always falling back to `vehicles[0]` regardless of which vehicle was tapped).
- **Submitting a fillup no longer overwrites Settings defaults.** A CAD/L submit was persisting `defaultCurrency` and `defaultVolumeUnit` to localStorage — now only `lastVehicleId` is persisted on submit, and the Settings page owns the unit/currency defaults.
- **Safari/iOS layout regressions** (visible only on real WebKit, not Chromium devtools mobile mode):
  - Hide native `<input type="number">` spinner buttons (they were eating ~24px and pushing the gal/L pill off-screen).
  - Clamp `input[type="date"]::-webkit-date-and-time-value` so Safari respects the grid cell width — Odometer and Date columns are now actually equal.
  - `field-input` gets explicit `box-sizing: border-box; min-width: 0; max-width: 100%`.
  - Cost row currency `<select>` uses `[text-align-last:center]` (Safari ignores plain `text-align: center` on selects).

### Tests

- e2e `happy-path` regex updated for the "Gal" capital change.

## [0.1.1] — 2026-05-08

### Added

- **Slide-in navigation drawer** anchored in `+layout.svelte` (Log fillup / History / Vehicles / Settings). `/history` is now reachable from the UI for the first time.
- `npm run dev:lan` and `npm run preview:lan` — LAN-exposed dev/preview servers for testing on a real phone over WiFi without going through the full release loop.
- README "Testing on a real phone before release" subsection covering LAN IP discovery, the HTTPS-only PWA caveat, the LubeLogger reachability note, and the "create a TEST vehicle" data-pollution guard.
- Initial iPhone screenshots (form/vehicles/settings) in `docs/screenshots/`.

### Fixed

- **Dockerfile healthcheck uses `127.0.0.1`** instead of `localhost`. Alpine's `/etc/hosts` lists `::1 localhost` first, and SvelteKit's adapter-node binds IPv4-only on `0.0.0.0`. BusyBox `wget` was trying IPv6, getting connection-refused, and the container reported `unhealthy` despite serving fine.
- `vite.config.ts` loads `.env` into `process.env` for `vite dev`/`preview` so server-side modules (`env.ts`, `lubelogger.ts`) can read `LUBELOGGER_URL`/`LUBELOGGER_API_KEY` without docker-compose injection.

### Changed

- README rewritten for two audiences (self-hoster on top, contributor on bottom). Markdownlint-clean.
- Image pin convention: homelab now uses `:latest` (every commit on main goes through PR + CI before merging, so main is always prod-ready). Fork users can still pin `:0.1` or exact tags — see deployment doc.

### Reverted

- **Vehicle photo proxy** added in this same release was removed before tagging. LubeLogger serves `/images/*` behind cookie auth (not the `x-api-key` header), so the proxy was returning the LubeLogger login HTML instead of image bytes. Generic car-icon fallback became the always-on UI. See upstream issue [hargata/lubelog#1360](https://github.com/hargata/lubelog/issues/1360) for the long-term fix.

### Removed

- Placeholder PWA icon files (`icon-192.png`, `icon-512.png`, `apple-touch-icon.png`) — they were SVG-with-PNG-extension stubs that browsers and PWA validators rejected. Manifest `icons` array dropped; the PWA still installs (browsers fall back to a generic icon).

## [0.1.0] — 2026-05-07

Initial public release.

### Added

- **Mobile-first form** for logging fuel fillups: vehicle picker, odometer, date, volume (gal/L), cost (USD/CAD/EUR/GBP/MXN), fill-to-full, missed-fillup, optional notes.
- Live MPG-since-last-fill preview as the user types.
- Live FX rate preview with manual-FX fallback when all upstream providers are unreachable.
- `/vehicles`, `/history`, `/settings` pages.
- **Offline queue** in IndexedDB — submissions made offline are queued and auto-flushed when the service worker detects a sync trigger (window focus + online event).
- **PWA**: manifest, service worker, "Add to Home Screen" support on iOS.
- **LubeLogger client** (`src/lib/server/lubelogger.ts`) with `x-api-key` auth, vehicle list, gas-record list, and gas-record add.
- **FX provider chain** (`src/lib/server/currency.ts`) with frankfurter / erapi / fawazahmed by default, optional exchangerate-api on top, persistent disk cache.
- **Multi-stage Dockerfile** (Node 22 alpine, runs as `node` user UID 1000, ~150 MB).
- **GitHub Actions**: `ci.yml` (lint + check + vitest + build + Playwright e2e), `build.yml` (multi-arch GHCR build on main pushes and semver tags).
- **Apple Shortcuts** recipes in [`docs/user/shortcuts.md`](docs/user/shortcuts.md): voice "Log fuel" with deep-link prefill, JSON POST direct-submit.
- Branch protection + CODEOWNERS + linear history on `main`.
- Architecture, API mapping, deployment, and UAT docs.

[0.1.2]: https://github.com/varunpan/quicklogger/releases/tag/v0.1.2
[0.1.1]: https://github.com/varunpan/quicklogger/releases/tag/v0.1.1
[0.1.0]: https://github.com/varunpan/quicklogger/releases/tag/v0.1.0
