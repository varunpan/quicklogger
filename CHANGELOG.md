# Changelog

All notable changes to this project are documented here. Format roughly follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project follows [SemVer](https://semver.org/) (pre-1.0 minor bumps may include breaking changes — read the entry).

## [0.1.3] — Unreleased

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

### Removed

- macOS Finder-duplicate artifacts that landed in the working tree via iCloud sync.

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
