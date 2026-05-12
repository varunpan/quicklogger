# Architecture

quicklogger is a mobile-first PWA that submits fillups to a self-hosted LubeLogger over HTTP. SvelteKit (adapter-node) runs on the server, Svelte 5 with runes runs on the client, and nothing is fetched at runtime that wasn't bundled at build time — there are zero runtime dependencies beyond Node and the LubeLogger API.

## Overview

The system has three surfaces:

- **Browser / installed PWA** on the user's phone — Safari or any modern Chromium. The service worker precaches the app shell, so the form opens instantly even on a flaky connection. A per-vehicle `localStorage` snapshot plus an IndexedDB queue keep the form (including the last-fillup prefill) usable while LubeLogger is unreachable.
- **SvelteKit server** running in a Node 22 container. Stateless except for an on-disk FX cache (`/data/fx-cache.json`) and an in-process 60s idempotency map. All upstream calls go through `src/lib/server/lubelogger.ts`.
- **LubeLogger container** on the operator's network. quicklogger never talks to LubeLogger from the browser — the SvelteKit server is the only client.

**Deployment topology note.** When quicklogger and LubeLogger run in the same Docker compose stack, the SvelteKit server reaches LubeLogger via container DNS (e.g. `http://lubelogger:8080`) — traffic stays on the internal Docker network and LubeLogger never needs to be exposed to the public internet just for the backend's API calls. `LUBELOGGER_URL` is the only switch; point it at an internal hostname for the co-located case, or at a public URL for split deployments. Either way, the browser only ever talks to the SvelteKit origin.

```
    iPhone (Safari/PWA)
            │
            │ HTTPS (your reverse proxy / Tailscale / LAN)
            ▼
    SvelteKit server (Node container)
    ├── /api/vehicles
    ├── /api/vehicle/last-fuelup
    ├── /api/vehicle/reminders
    ├── /api/fuelup       ←──── form submits land here
    ├── /api/fx
    └── /healthz
            │
            │ HTTP (Docker internal network when co-located)
            ▼
    LubeLogger container
    └── /api/vehicle/gasrecords/add  ←──── fillups stored here
```

## Server modules

Every server module is pure and unit-testable; I/O is centralized in `env.ts` and `lubelogger.ts`.

### Units conversion (`src/lib/server/units.ts`)

Pure helpers between US gallons and liters. The constant `GAL_TO_L = 3.785411784` is the exact definitional ratio (US gallon, NIST). `toGallons(value, unit)` / `toLiters(value, unit)` accept `'gal' | 'L'`. Negative inputs throw `RangeError`; unknown units throw `TypeError`. No external dependencies.

### Environment configuration (`src/lib/server/env.ts`)

Single source of truth for env-var access — other server modules call `loadEnv()` rather than reading `process.env` directly. Required vars `LUBELOGGER_URL` and `LUBELOGGER_API_KEY` throw `EnvError` if missing; `FX_PROVIDERS` (CSV) is validated against a known-providers set, with unknown names also throwing `EnvError`. Full reference: [`docs/user/configuration.md`](./user/configuration.md).

**Photo OCR (optional, v0.2.0+):**
`OLLAMA_VISION_URL`, `OLLAMA_VISION_MODEL` (`qwen2.5vl:3b`),
`OLLAMA_VISION_TIMEOUT_MS` (`60000`), `OLLAMA_KEEP_ALIVE` (`30m`),
`OPENROUTER_API_KEY`, `OPENROUTER_VISION_MODEL`
(`google/gemini-2.5-flash-lite`), `OPENROUTER_VISION_TIMEOUT_MS` (`30000`),
`OCR_DAILY_BUDGET_USD` (`1.00`), `OCR_RATE_LIMIT_PER_HOUR` (`20`),
`OCR_BUDGET_PATH` (`/data/ocr-budget.json`), `OCR_AUDIT_PATH`
(`/data/ocr-audit.jsonl`), `OCR_AUDIT_KEY_PATH`
(`/data/ocr-audit-key.txt`), `OCR_AUDIT_HMAC_KEY`,
`OCR_PUMP_VOLUME_MAX` (`200`), `OCR_PUMP_COST_MAX` (`500`),
`OCR_PUMP_PRICE_PER_UNIT_MAX` (`20`), `OCR_ODOMETER_MAX_MI` (`1000000`).

The feature is enabled iff at least one of `OLLAMA_VISION_URL` or
`OPENROUTER_API_KEY` is set. Provider selection is resolved per-request,
not cached at startup — a transient ollama outage doesn't permanently
disable the camera button. Full user-facing reference lives in
[`docs/user/configuration.md`](user/configuration.md#photo-ocr-v020).

### FX provider chain (`src/lib/server/currency.ts`)

Multi-provider FX resolver with a 24-hour fresh cache, a 7-day stale fallback, and a 3-second per-provider timeout. Defaults to a three-provider chain (`frankfurter`, `erapi`, `fawazahmed`). Details: [`docs/technical/fx-chain.md`](./technical/fx-chain.md).

### LubeLogger client (`src/lib/server/lubelogger.ts`)

Single integration point with LubeLogger — every upstream call flows through `LubeLoggerClient`. The client is reachable via container DNS on the same Docker network (preferred for security) or over a public URL; `LUBELOGGER_URL` is the switch. Auth is `x-api-key` from `LUBELOGGER_API_KEY` (Editor scope on the LubeLogger side). Default request timeout is 5s via `AbortSignal.timeout()`; `/healthz` constructs its own client with a 2s override so the probe fails fast. Non-2xx responses throw `LubeLoggerError` (status + body); `/api/fuelup` maps 5xx to 502 and passes 4xx through unchanged. Per-method/per-field reference: [`docs/technical/idb-and-api.md`](./technical/idb-and-api.md) § *LubeLogger upstream calls*.

### Conversion orchestrator (`src/lib/server/convert.ts`)

Combines `units.ts` and `currency.ts` into a single `convertSubmission()` call used by `POST /api/fuelup`. Behavior: if `manualFxRate` is set on the input the rate is used verbatim and `fxSource` is recorded as `'manual'` — the currency service is not consulted. Otherwise the currency service resolves the rate per its provider chain; stale rates pass through with `fxStale: true`. Volume always goes through `toGallons`; any target volume unit other than `gallons_us` throws (v0.1.x only supports US-gallon LubeLogger configurations). Pure module — all I/O is delegated to the injected `CurrencyService`, so the whole thing is trivially testable with a fake.

### OCR rate limiter (`src/lib/server/ocrRateLimit.ts`)

In-memory sliding-window rate limiter, keyed per IP. Default
`OCR_RATE_LIMIT_PER_HOUR=20` — a real fillup takes >5 minutes, so 20/hr
is an abuse signal, not a usage limit. Single-replica only; if quicklogger
ever scales to >1 replica or moves behind Authentik forward-auth, swap the
key to the authenticated user (or move the bucket to `/data`). Returns
`{ allowed: true }` or `{ allowed: false, retryAfterSec }`; the `/api/ocr`
handler maps the false case to a 429 with `Retry-After` header.

### OCR daily budget (`src/lib/server/ocrBudget.ts`)

Daily $ cap for cloud OCR calls. Persisted at `/data/ocr-budget.json` as a
single object `{ date: 'YYYY-MM-DD' (UTC), calls, costCents }`. Tally rolls
over at `00:00 UTC`. `check()` returns `{ ok: false }` once
`costCents > OCR_DAILY_BUDGET_USD * 100` — the route handler maps that to
`402 Payment Required`. `add(costCents)` records each successful call;
ollama records 0 (local inference), OpenRouter records the per-call
estimate (~0.006 cents for Gemini Flash Lite). At the $1/day default,
that's ~16,000 OpenRouter calls/day before the budget closes.

### OCR audit log (`src/lib/server/ocrAudit.ts`)

Append-only JSONL at `/data/ocr-audit.jsonl`. One row per OCR call,
including failures. Row shape: `{ ts, mode, ipHash, imgHash, imgBytes,
imageType, provider, model, fellbackTo, latencyMs, costCents, parsed, ok,
error? }`. `parsed` is the discriminated `OcrResult` (`OcrPumpResult` or
`OcrOdometerResult`) on success, `null` on failure.

`ipHash` is HMAC-SHA-256 keyed by a 32-byte secret. Resolution order:
`OCR_AUDIT_HMAC_KEY` env override → existing file at `OCR_AUDIT_KEY_PATH`
→ generate and persist (0600 perms). The persistence ensures hash
stability across container restarts; the file lives on the same `/data`
bind mount as the rest of the OCR state.

`imgHash` is SHA-256 of the post-receive bytes — useful for spotting
re-tries of the same image without storing pixels. Rotation: when the
next append would cross 10 MiB, the file is truncated to 0 bytes
(destructive — old entries are discarded, not archived).

### OCR validators + dispatcher (`src/lib/server/ocr.ts`)

`sniffImageType(bytes)` — magic-byte sniff. Recognises JPEG, PNG, WebP,
HEIC. Returns `null` for anything else; the `/api/ocr` handler maps null
to `415 Unsupported Media Type`. Per-mode JSON-schema and range
validators live in [`ocrModes.ts`](#ocr-mode-contracts-srclibserverocrmodests).
The dispatcher (`runOcrPipeline`, `selectProvider`) is documented further
down once all upstream pieces are in place.

### OCR mode contracts (`src/lib/server/ocrModes.ts`)

The `MODES` map (keyed by `OcrMode`) is the single source of truth for
mode-specific prompt, JSON schema, schema validator (hand-written, no
zod), range validator (env-bound), and optional cross-field validator.
The dispatcher switches on mode by `MODES[mode]` lookup — no `if/else`
chains; adding `receipt` in v0.2.1 is a single map-entry addition.

**Pump contract** — schema-validates `{ volume, volumeUnit ∈ ['gal','L'],
cost, pricePerUnit }`. Range-validates each numeric against
`OCR_PUMP_VOLUME_MAX` / `OCR_PUMP_COST_MAX` /
`OCR_PUMP_PRICE_PER_UNIT_MAX`. Cross-field-validates that
`cost ≈ volume × pricePerUnit` within 5% drift (real-world pump rounding
sits well inside that band).

**Odometer contract** — schema-validates `{ odometer }`. Range-validates
against `OCR_ODOMETER_MAX_MI`. No cross-field check (single field). The
*relative-range* check vs the previous fillup happens client-side
([`+page.svelte`](#---main-form)) — the server has no access to prior
fillup history, and the failure mode is user-recoverable.

### OCR providers (`src/lib/server/ocrProviders.ts`)

Provider interface: `extract(bytes, prompt, schema) → unknown`. Providers
don't know about modes — the dispatcher pulls `prompt` + `schema` from
`MODES[mode]` (B7) and passes them. This keeps adding a mode to a single
map entry.

**Ollama** — POSTs to `${OLLAMA_VISION_URL}/api/chat` with
`format: <schema>`, `temperature: 0`, `keep_alive: 30m` (default),
`stream: false`, and the base64-encoded image bytes. Cost-cents = 0
(local). Wrapped in `AbortSignal.timeout(OLLAMA_VISION_TIMEOUT_MS)` —
60 s default to accommodate CPU inference.

**OpenRouter** — POSTs to `https://openrouter.ai/api/v1/chat/completions`
with `Authorization: Bearer ${OPENROUTER_API_KEY}`, the OpenAI-compatible
chat-completions shape, and `response_format: { type: 'json_schema',
json_schema: { strict: true, schema } }`. Default model
`google/gemini-2.5-flash-lite`. Cost-cents = 0.006 (≈ $0.00006/call,
rounded up). Wrapped in `AbortSignal.timeout(30 000)` by default — cloud
is reliably <5 s.

**ChainOcrProvider** — wraps an ordered list, tries them in order. Bounded
at one fallback (`ChainOcrProvider([ollama, openrouter])` — 2-provider
chain) — not a retry loop. On total failure, the last error propagates and
the route handler maps it to `502 Bad Gateway`. `activeProvider` and
`lastFellbackTo` getters drive audit attribution.

### OCR dispatcher (`src/lib/server/ocr.ts` — pipeline)

`selectProvider(env)` returns an `OcrProvider | null` based on env:

| ollama | openrouter | Result |
|---|---|---|
| set | set | `ChainOcrProvider([ollama, openrouter])` |
| set | unset | `OllamaOcrProvider` |
| unset | set | `OpenRouterOcrProvider` |
| unset | unset | `null` → `/api/ocr` returns 503 |

`runOcrPipeline(input)` orchestrates one request: magic-byte sniff →
`MODES[mode]` lookup → provider call → `validateSchema` → `validateRanges`
→ `validateCrossField` (pump only) → return tagged outcome. Returns
discriminated `OcrResult` (`OcrPumpResult` or `OcrOdometerResult`) on
success. Selection runs per-request — a transient ollama outage doesn't
permanently disable the feature.

## Frontend

### State management

The frontend keeps state in three buckets, each with a clear purpose:

- **`localStorage`** (`src/lib/client/prefs.ts`) — user preferences: `lastVehicleId`, `defaultVolumeUnit`, `defaultCurrency`, `odometerPrefillEnabled`, `odometerIncrementMi`. Single storage key `quicklogger.prefs` holds a JSON blob. A second key per vehicle (`quicklogger.lastFuelup.<id>`) caches the most recent upstream `GasRecord` for the offline-prefill resolver.
- **`IndexedDB`** (`src/lib/client/idb.ts`) — submission queue (`pendingSubmissions`, db version `1`) holding `'queued'`, `'failed'`, and `'synced'` rows. Schema and state machine: [`docs/technical/offline-queue.md`](./technical/offline-queue.md). Combined IDB + HTTP API reference: [`docs/technical/idb-and-api.md`](./technical/idb-and-api.md).
- **Service worker `Cache Storage`** — app-shell precache for instant launch. Details: [`docs/technical/service-worker.md`](./technical/service-worker.md).

These are intentionally separated: prefs are sync + tiny, the queue is async + structured, the SW cache is opaque + binary. No state lives in shared in-memory stores — every page load reads from the authoritative source.

## Frontend pages

Five pages live behind the slide-in drawer in `+layout.svelte`: **Log Fuel** (`/`), **Vehicles** (`/vehicles`), **Settings** (`/settings`), **History** (`/history`), and **Maintenance** (`/maintenance`). User-facing tour: [`docs/user/app-pages.md`](./user/app-pages.md); internals for the maintenance route in [`docs/technical/maintenance-page.md`](./technical/maintenance-page.md).

### `/` — main form

The single most-used page. `+page.ts` loads the vehicle list and last-fuelup snapshot (with the offline resolver as fallback when upstream is unreachable). URL query params on the route drive Apple Shortcuts deep-link pre-fill (Path 1 of the Shortcuts integration). A `$effect` block fetches the FX rate from `/api/fx` whenever the currency selector changes; if the chain is exhausted, `needsManualFx` reveals a manual-rate field. Submit is gated client-side by a `canSubmit` derived (all four required fields present; the three numerics — odometer/volume/cost — are > 0 and the date is set); the same contract is enforced server-side in `/api/fuelup`'s `validate()`, so non-form callers (Shortcuts, direct curl) get a 400 with the failing field names.

Cross-links for the detail this section deliberately doesn't repeat:

- User view of the form + per-page tour: [`docs/user/app-pages.md`](./user/app-pages.md) § *Log Fuel*.
- Prefill / `+N mi` chip / per-tank delta UX: [`docs/user/odometer-prefill.md`](./user/odometer-prefill.md).
- Offline submit behavior + queue mechanics: [`docs/technical/offline-queue.md`](./technical/offline-queue.md).
- Offline last-fillup resolver (cache + queue): [`docs/technical/offline-odometer-prefill.md`](./technical/offline-odometer-prefill.md).

### Service worker (`src/service-worker.ts`)

App-shell precache + network-first routing for `/api/*` + message-driven queue replay (no BackgroundSync). Details: [`docs/technical/service-worker.md`](./technical/service-worker.md).

## Data flow

End-to-end walkthrough of a fillup submission — the most useful "data flow" lens for someone new to the system.

1. **User opens the app.** The service worker serves the cached shell instantly. `+page.ts` runs in the browser and fetches the vehicle list from `/api/vehicles` and the last-fuelup snapshot from `/api/vehicle/last-fuelup`. On a successful fetch, the loader writes the raw `GasRecord` to `localStorage` keyed by vehicle id; on failure, it consults `resolveOfflineLastFillup` (cache + IDB queue) and reports `lastFuelupSource: 'offline'`.
2. **User selects vehicle, enters odometer / volume / cost.** The client-side `canSubmit` derived gates the submit button until all four required fields are satisfied (the three numerics — odometer/volume/cost — are > 0 and the date is set). The odometer opens pre-filled when `prefs.odometerPrefillEnabled` is true and a last-fuelup is available.
3. **FX preview.** A `$effect` in the page calls `/api/fx?from=<currency>&to=USD` whenever the currency selector changes; the server consults the FX chain (cache → providers → stale fallback) and returns a rate. If the chain is fully exhausted, the page reveals the manual-rate field.
4. **User taps "Log fillup".** The page POSTs `FuelSubmissionInput` (with a fresh client-side UUID) to `/api/fuelup`.
5. **Server-side processing.** `/api/fuelup` validates required fields, calls `convertSubmission()` (units + FX), then `LubeLoggerClient.addGasRecord()` which POSTs form-data to LubeLogger's `POST /api/vehicle/gasrecords/add`. The 60s in-process idempotency map drops duplicate `clientSubmissionId` POSTs. When both containers are co-located in one compose stack, this hop stays on the internal Docker network.
6. **Response.** 200 with `{ ok: true, submitted: { gallons, cost, fxRate, fxSource, fxStale } }`. The page shows a success toast and appends a `'synced'` row to the IndexedDB queue — a permanent local trail used by the offline resolver on future loads.
7. **If `/api/fuelup` fails.** A 4xx is a terminal rejection (the page shows a rejection toast and does *not* queue — won't fix itself). Any other failure (network, 5xx) enqueues the submission to IndexedDB with status `'queued'` and shows "Saved locally — will sync". The service worker drains the queue on next app focus, visibility change, or `onMount`, marking each entry `'synced'` on success or `'failed'` on a 4xx replay response.

Cross-cutting details — per-endpoint shapes in [`docs/technical/idb-and-api.md`](./technical/idb-and-api.md); offline queue mechanics in [`docs/technical/offline-queue.md`](./technical/offline-queue.md).
