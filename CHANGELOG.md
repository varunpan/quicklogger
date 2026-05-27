# Changelog

All notable changes to this project are documented here. Format roughly follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project follows [SemVer](https://semver.org/) (pre-1.0 minor bumps may include breaking changes — read the entry).

## [0.2.3] — Unreleased

### Added

- **Vehicle images from LubeLogger.** Every vehicle-row surface
  (Log Fuel, History, Maintenance, vehicle picker) now shows the
  actual vehicle photo stored in LubeLogger (when set), proxied
  through the new `/api/vehicle/image` endpoint. Unblocked by
  LubeLogger v1.6.5, which added API-key auth on `/images/*`. The
  generic car icon stays as the fallback for vehicles without a
  photo or when the image isn't reachable.
- **Structured server logger** with JSON stdout, optional rotating
  logfile, per-request `request_id` (also exposed as `X-Request-ID`),
  and secret redaction. Env vars: `LOG_LEVEL`, `LOG_PRETTY`,
  `LOG_FILE_PATH`, `LOG_FILE_MAX_SIZE_MB`, `LOG_FILE_MAX_FILES`.
  Defaults preserve current behaviour (stdout only, info level).
- **Client + service-worker error forwarding** via the new
  `POST /api/log` endpoint. `window.error` and `unhandledrejection`
  from the browser, plus install / runtime errors from the service
  worker, now land in the server log stream tagged `source: client` or
  `source: service-worker`.

### Changed

- **Service worker preserves a new `quicklogger-vehicle-images-v1`
  cache across shell upgrades.** Image bytes survive new releases via
  a fixed-name cache that the `activate` handler whitelists alongside
  the per-version shell cache. Stale-while-revalidate semantics —
  served from cache instantly, refreshed in the background.
- **LubeLogger upstream errors return structured JSON** instead of a
  passthrough of the upstream message. Bodies now include `upstream`
  (which call), `upstream_status`, and `upstream_body_preview` so
  client-side error UI can say *which* upstream call failed.

### Fixed

- **OCR misclassifications now log the raw LLM response** alongside
  the validation error, so an odometer photo sent to the fuel-pump
  slot can be diagnosed from logs without re-running the request.
- **Crop handles stay grabbable at the image edge** — when the crop
  rectangle is dragged flush against an image boundary, the corner
  and edge handles now clamp inside the image instead of spilling
  into the modal padding where the host's `overflow-hidden` made
  them unreachable.

### Tests

- **`LubeLoggerClient.fetchImage` coverage** — happy path with
  `x-api-key` header round-trip, `LubeLoggerError` on 4xx + 5xx.
- **`/api/vehicle/image` route coverage** — 400 on missing/invalid
  `vehicleId`, 404 on vehicle not found / empty `imageLocation` /
  path-guard rejection, 200 with copied `content-type` +
  `cache-control: no-store` on happy path, 502 on `LubeLoggerError`,
  5-minute vehicles-cache deduplication.
- **Logger module coverage** — JSON shape, child contexts, secret
  redaction (depth + cycle), pretty mode, Error unpacking.
- **Hooks coverage** — `request_id` generation, `X-Request-ID` header
  round-trip, silenced-path carve-outs.
- **`/api/log` coverage** — happy path, size + batch limits, rate
  limit, level validation.
- **Client logger coverage** — buffer overflow drop-oldest, size +
  time flush triggers, client-side redaction.
- **Branch-point logger assertions** on OCR pipeline + LubeLogger
  client + currency / budget / audit modules.

## [0.2.2] — 2026-05-17

### Added

- **Pluggable OCR provider chain.** Two new provider slots:
  `ollama-cloud` (Ollama Cloud free tier) and `openai-compatible`
  (any OpenAI-compatible vision endpoint — Groq, Cerebras, OpenAI
  direct, LiteLLM proxies, etc.). Chain order is configurable via
  the `OCR_PROVIDER_CHAIN` env var (CSV; same pattern as
  `FX_PROVIDERS`). Default chain when unset preserves existing
  behaviour (`ollama-local, openrouter` ahead of the new slots) —
  new slots are opt-in. Cloud default model is `gemma4:31b` based
  on design-time probes (~1 s perfect read vs. ~75 s local on
  consumer hardware); override via `OLLAMA_CLOUD_MODEL`. Eight new
  env vars across the two new slots, all optional with defaults.
  See [`docs/user/photo-ocr.md`](docs/user/photo-ocr.md) for setup
  and model selection.

### Changed

- **OCR audit log shape.** The `provider` field union widens from
  `'ollama' | 'openrouter'` to
  `'ollama-local' | 'ollama-cloud' | 'openrouter' | 'openai-compatible'`.
  Field `fellbackTo` renamed to `fellbackFrom` (more honest name;
  same semantics — `chain[0].name` when fall-through occurred).
  Old jsonl lines remain readable; new lines use the new names.
- **Client OCR timeout now self-adjusting.** `GET /api/ocr` probe
  response gains a `chainTimeoutMs` field (sum of effective chain's
  per-slot timeouts). Client uses `chainTimeoutMs + 10 s` for its
  request timeout — no more hardcoded 90 s. Server's
  "fails-first" invariant is preserved by construction regardless
  of chain length.

### Tests

- ~37 new tests: `parseLenientJson` markdown-fence stripping, cloud
  auth header, OAI-compatible URL override, chain-build defaults,
  missing-config WARN+drop, CSV parsing edge cases, cloud-only +
  OAI-compat-only GET probe.

## [0.2.1] — 2026-05-15

### Fixed

- **Cap OpenRouter OCR output at 256 tokens.** Bounds per-call cost
  when the model produces an unexpectedly long response. The daily
  budget gate (`OCR_DAILY_BUDGET_USD`) is unchanged — this is a
  tighter inner ring at the per-request boundary. Real responses are
  ~30 tokens (pump) or ~10 (odometer), so legitimate output is
  untouched. Ollama path is unaffected (local + structured-output
  already constrain it).

## [0.2.0] — 2026-05-15

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
  `{ enabled, modes? }`. See
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
- **Crop before OCR send.** New `[Crop]` button in the photo preview
  modal alongside `[Retake]` / `[Rotate]`. Drag handles to box in the
  pump display or odometer digits; after `[Done]`, the preview
  renders ONLY the cropped+rotated region directly to a `<canvas>`
  (scaled to fit) so what you see is byte-shape-equivalent to what
  gets sent on the wire. A small `Cropped` chip in the header is the
  redundant text cue. Crop is applied inside the same canvas pass as
  the existing resize + rotation on send — one pixel encoding per
  send. Wire-additive: `/api/ocr` POST grows four optional
  decimal-string fields `cropX/Y/W/H`; the audit log gains
  `cropApplied: boolean` and `cropRect: { x, y, w, h } | null` on
  every row. Cuts OCR cost (fewer tiles on cloud providers) and
  improves quality on photos where station background or dashboard
  glare was confusing the model. See
  [`docs/user/photo-ocr.md`](docs/user/photo-ocr.md) and
  [`docs/technical/photo-ocr.md`](docs/technical/photo-ocr.md).
- **Date prefill from older pump photos.** Pick a pump photo from your
  library and the Date field auto-fills from the photo's embedded date.
  A compact chip under the Date input shows either `set from photo` (blue)
  or `no date in photo` (amber, for screenshots or photos with stripped
  EXIF). Fresh-camera captures are a no-op — only older library photos
  trigger the prefill. Pump-only (odometer photos untouched). See
  [`docs/user/photo-ocr.md`](docs/user/photo-ocr.md#date-prefill-from-photo-v020)
  and
  [`docs/technical/photo-ocr.md`](docs/technical/photo-ocr.md).

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

- **Odometer OCR accuracy.** The odometer prompt now instructs the
  vision model to read every digit left-to-right (no assumed digit
  count) and to ignore any trip-meter display. When a previous fillup
  exists for the vehicle, its odometer value is passed to the model
  as a sanity-check hint — anchors small open-source models like
  `qwen2.5vl:7b` so they don't truncate the leading digit on 6+ digit
  readings. The hint is informational, not a constraint; legitimate
  cases (replaced cluster, rollover) flow through unchanged. See
  [`docs/technical/photo-ocr.md`](docs/technical/photo-ocr.md).
- **Pump OCR accuracy.** The pump prompt got the same rigor pass as
  the odometer prompt. It now disambiguates the three close-magnitude
  numbers on a pump display (total cost vs volume vs price-per-unit),
  preserves fractional-cent prices (e.g. `3.699`, not `3.70`), and
  accepts the prior fillup's derived price-per-unit as a soft
  sanity-check hint — parallel to the existing odometer hint. Reduces
  silent cost/volume/price swaps that previously slipped through the
  5% cross-field check. Verbatim prompt text is in
  [`docs/technical/photo-ocr.md`](docs/technical/photo-ocr.md).

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
- New e2e spec [`tests/e2e/ocr-preview-crop.spec.ts`](tests/e2e/ocr-preview-crop.spec.ts):
  drag → Done → Send sends `cropX/Y/W/H` form fields with decimals in
  `[0, 1]`; skip-crop send omits all four (wire-compat regression
  guard); Cancel-crop preserves prior state and omits crop fields.
- New unit specs: `src/lib/client/cropCoords.test.ts` (display↔source
  conversion round-trip across all four rotations) and
  `src/lib/client/CropOverlay.test.ts` (handles render, corner /
  interior drag, 200 source-px floor, Reset, Cancel).
- Extended `src/lib/client/image.test.ts` with crop branch + combined
  rotation×crop + defensive-parse cases (single-canvas-pass invariant
  asserted via drawImage call count).
- Extended `src/lib/server/ocrAudit.test.ts` to round-trip
  `cropApplied` + `cropRect`.
- Extended `src/routes/api/ocr/server.test.ts` with four crop cases
  (all-four-valid, three-of-four, out-of-range, old-shape).
- Extended `src/lib/client/OcrPreview.test.ts` with six new cases for
  the crop sub-mode state machine.
- Extended `src/lib/server/ocrModes.test.ts` with a dedicated suite for
  the dynamic odometer prompt: digit-counting + trip-meter directives,
  hint inclusion only when `lastOdometerMi` is finite positive,
  rounding behavior on non-integer hints, and absence of the hint when
  context is missing / NaN / non-positive.
- Extended `src/lib/server/ocr.test.ts` with three pipeline cases that
  capture the prompt string handed to the provider and assert that
  `lastOdometerMi` is forwarded only when finite positive.
- Extended `src/routes/api/ocr/server.test.ts` with three cases for the
  new wire field: valid value audit-logged, garbage values dropped
  from the audit row, old-shape (no field) request omits the field
  entirely.

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
