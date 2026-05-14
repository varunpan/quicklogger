# Configuration

Full env-var reference for self-hosted deploys. The source of truth is
`src/lib/server/env.ts` — anything documented here matches what that
file reads at startup.

quicklogger's runtime is configured entirely through environment
variables. There is no settings file on disk for server-side
configuration. Per-user form preferences (default unit, default
currency, odometer prefill behaviour) live in browser `localStorage`
on each device — see [`app-pages.md`](app-pages.md#settings-settings).

## Supported env vars

All env vars in one table, ordered by area. Photo OCR is feature-gated
— see the activation note under the table.

| Var | Type | Required | Default | Purpose |
| --- | --- | --- | --- | --- |
| `LUBELOGGER_URL` | URL | **yes** | — | Base URL of your LubeLogger instance (no trailing slash). All upstream API calls are made against this host. |
| `LUBELOGGER_API_KEY` | string | **yes** | — | API key used for the `x-api-key` header on every LubeLogger request. |
| `LUBELOGGER_VOLUME_UNIT` | string | no | `gallons_us` | The volume unit LubeLogger expects on inserts. quicklogger converts every submission to this unit before posting. |
| `LUBELOGGER_CURRENCY` | ISO 4217 code | no | `USD` | The currency LubeLogger expects for cost. quicklogger converts every submission to this currency at submit time via the FX chain. |
| `FX_PROVIDERS` | comma-separated list | no | `frankfurter,erapi,fawazahmed` | Ordered list of FX providers tried in sequence when the cache is cold or stale. First success wins. |
| `FX_CACHE_PATH` | filesystem path | no | `/data/fx-cache.json` | On-disk path the server reads/writes for the persistent FX cache. The directory is created if it doesn't exist. |
| `PORT` | int | no | `3000` | HTTP listen port for the Node server. |
| `ORIGIN` | URL | no | — | The public origin SvelteKit's CSRF check should accept on POSTs. Set this when you run behind a reverse proxy that terminates a different hostname than the one Node sees. |
| `OLLAMA_VISION_URL` | URL | no | — | URL of an ollama instance with a vision-capable model loaded. Setting this (or `OPENROUTER_API_KEY`) activates the Photo OCR feature. |
| `OLLAMA_VISION_MODEL` | string | no | `qwen2.5vl:7b` | Ollama model tag for OCR. `qwen2.5vl:7b` (~6 GB) is the tested default. |
| `OLLAMA_VISION_TIMEOUT_MS` | int (ms) | no | `60000` | Per-call timeout for the ollama provider. CPU inference takes 15–30 s. |
| `OLLAMA_KEEP_ALIVE` | duration | no | `30m` | How long ollama holds the model in memory between calls. |
| `OPENROUTER_API_KEY` | string | no | — | If set, adds OpenRouter as a cloud fallback (or sole provider). Activates Photo OCR. |
| `OPENROUTER_VISION_MODEL` | string | no | `google/gemini-2.5-flash-lite` | OpenRouter model id. |
| `OPENROUTER_VISION_TIMEOUT_MS` | int (ms) | no | `30000` | Per-call timeout for the OpenRouter provider. Cloud is reliably <5 s. |
| `OCR_DAILY_BUDGET_USD` | number (USD) | no | `1.00` | Runaway cap. Server returns 402 once exceeded. |
| `OCR_RATE_LIMIT_PER_HOUR` | int | no | `20` | Per-IP sliding-window rate limit. Abuse signal, not a usage limit. |
| `OCR_BUDGET_PATH` | filesystem path | no | `/data/ocr-budget.json` | Daily-tally persistence path. |
| `OCR_AUDIT_PATH` | filesystem path | no | `/data/ocr-audit.jsonl` | Append-only audit log. Rotates at 10 MiB by truncation. |
| `OCR_AUDIT_KEY_PATH` | filesystem path | no | `/data/ocr-audit-key.txt` | HMAC key file; auto-generated if absent. `0600` perms. |
| `OCR_AUDIT_HMAC_KEY` | hex string | no | — | Optional explicit override. When unset, key is generated and persisted to `OCR_AUDIT_KEY_PATH`. |
| `OCR_PUMP_VOLUME_MAX` | number | no | `200` | Range bound on detected pump volume (raw value in gal or L). |
| `OCR_PUMP_COST_MAX` | number | no | `500` | Range bound on detected pump cost (raw pump-display number). |
| `OCR_PUMP_PRICE_PER_UNIT_MAX` | number | no | `20` | Range bound on detected price per unit. |
| `OCR_ODOMETER_MAX_MI` | int | no | `1000000` | Absolute upper bound on odometer reading, miles. |

The startup loader fails fast (`EnvError`) if a required var is missing
or if `FX_PROVIDERS` contains an unknown provider name.

**Photo OCR activation.** The Photo OCR feature (v0.2.0+) is hidden
unless at least one of `OLLAMA_VISION_URL` or `OPENROUTER_API_KEY` is
set. With neither, the camera affordances stay hidden and the rest of
the `OCR_*` and `OLLAMA_*` / `OPENROUTER_*` vars are inert defaults.

## Variable details

### LubeLogger upstream

#### `LUBELOGGER_URL`

Required. The base URL where your LubeLogger instance is reachable
from the quicklogger server (no trailing slash). All upstream API
calls — vehicle list, fillup submit, odometer history — are made
against this host. Example:

        LUBELOGGER_URL=https://lubelogger.example.com

#### `LUBELOGGER_API_KEY`

Required. The API key LubeLogger issues for programmatic access. Sent
on every upstream request as the `x-api-key` header. Generate one in
LubeLogger under Settings → API.

#### `LUBELOGGER_VOLUME_UNIT`

LubeLogger supports `gallons_us`, `gallons_uk`, and `liters`. Set this
to match your LubeLogger instance's configured unit so the server
sends consistent values. The form's own `Gal`/`L` toggle is for input
convenience only; the server always converts.

#### `LUBELOGGER_CURRENCY`

Set this when your LubeLogger tracks costs in a currency other than
USD (e.g. `CAD`, `EUR`). The form will continue to accept cost in any
of its supported entry currencies; the server converts to your target
before insert. Example:

        LUBELOGGER_CURRENCY=CAD

A submission entered as `42.18 USD` will be FX-converted to CAD before
landing in LubeLogger.

### FX conversion

#### `FX_PROVIDERS`

Override the default chain when:

- A provider is consistently rate-limiting you and you want to drop it.
- You want a different fallback order.
- You're testing one specific provider in isolation.

Supported provider names: `frankfurter`, `erapi`, `fawazahmed`. Any
unsupported name causes startup to fail with `Unknown FX provider`. Example:

        FX_PROVIDERS=frankfurter,fawazahmed

See [`currency-fx.md`](currency-fx.md) for what each provider does.

#### `FX_CACHE_PATH`

Default is `/data/fx-cache.json`, which assumes a Docker volume mounted
at `/data`. Change it if you're running outside of Docker or your
volume is mounted elsewhere. The file is small (one JSON object,
typically a few hundred bytes); make sure the directory is writable by
the process user.

Example for local dev outside Docker:

        FX_CACHE_PATH=./fx-cache.json

### Server runtime

#### `PORT`

Change when port 3000 conflicts with something else on the host, or
when you're running multiple quicklogger instances on the same host
behind a reverse proxy.

#### `ORIGIN`

SvelteKit validates the `Origin` header on POST requests as a CSRF
defense. When the server runs inside a container behind a reverse
proxy, Node sees the proxy's request and may reject the POST because
the `Origin` doesn't match what it expects. Set `ORIGIN` to your
**public** URL — what the browser actually sees in its address bar:

        ORIGIN=https://quicklogger.example.com

If you're running quicklogger directly on a host with no proxy, you
can leave this unset and SvelteKit will accept POSTs from any origin
that matches its own listening address.

### Photo OCR (v0.2.0+)

All vars in this section are optional. The feature is hidden unless
`OLLAMA_VISION_URL` or `OPENROUTER_API_KEY` is set. When both are set,
ollama is tried first and OpenRouter is the bounded cloud fallback —
see [`photo-ocr.md`](photo-ocr.md) for the full provider chain
behaviour.

#### `OLLAMA_VISION_URL`

URL of an ollama instance with a vision-capable model loaded. Setting
this activates the Photo OCR feature with ollama as the primary
provider. Example:

        OLLAMA_VISION_URL=http://ollama:11434

The server expects the standard ollama HTTP API at this address.

#### `OLLAMA_VISION_MODEL`

The ollama model tag used for OCR requests. The default
`qwen2.5vl:7b` (~6 GB) is tested against pump displays and dashboard
odometers. Smaller models trade accuracy for memory; larger ones
trade memory for marginal accuracy. Override only if you've validated
a different model end-to-end.

#### `OLLAMA_VISION_TIMEOUT_MS`

Per-call timeout for ollama OCR requests, in milliseconds. CPU
inference on `qwen2.5vl:7b` is typically 15–30 s; the 60 s default
gives headroom for cold starts. Lower it if you're running on a GPU
and want faster failover to OpenRouter.

#### `OLLAMA_KEEP_ALIVE`

How long ollama holds the loaded model resident in memory between
calls. The default `30m` keeps the model hot through normal fillup
cadence. Set to `0` to unload immediately after each call (saves RAM,
adds cold-start latency).

#### `OPENROUTER_API_KEY`

OpenRouter API key. If set, OpenRouter becomes either the cloud
fallback (when `OLLAMA_VISION_URL` is also set) or the sole provider
(when ollama isn't configured). Either way, setting this activates
the Photo OCR feature.

#### `OPENROUTER_VISION_MODEL`

OpenRouter model identifier. The default
`google/gemini-2.5-flash-lite` is the cheapest model that reliably
reads gas-pump displays in our testing. See OpenRouter's catalog for
alternatives.

#### `OPENROUTER_VISION_TIMEOUT_MS`

Per-call timeout for OpenRouter OCR requests, in milliseconds. Cloud
inference is reliably under 5 s; the 30 s default covers tail
latency.

#### `OCR_DAILY_BUDGET_USD`

Hard daily cap on OCR spend, in USD. Tracked per-day (UTC). Once
exceeded, the server returns 402 on `/api/ocr` until the next UTC
rollover. Default `1.00` is a runaway guard, not a usage budget —
raise it if you're a heavy user, lower it if you want a tighter cap.

#### `OCR_RATE_LIMIT_PER_HOUR`

Per-IP sliding-window rate limit on `/api/ocr`. Treats the request
source as an abuse signal, not as a usage limit — the 20/hr default
is far above the cadence a single user fueling a few cars produces.

#### `OCR_BUDGET_PATH`

Filesystem path the server reads/writes for the daily $-spent tally.
Same Docker volume assumption as `FX_CACHE_PATH`. For local dev, see
the OCR persistence paths note below.

#### `OCR_AUDIT_PATH`

Filesystem path for the append-only OCR audit log (JSONL format).
Records HMAC-hashed client IP, image SHA-256, parsed numeric fields,
provider used, latency, fallback flag, and applied rotation. Rotates
destructively at 10 MiB.

#### `OCR_AUDIT_KEY_PATH`

Filesystem path for the HMAC key that hashes client IPs in the audit
log. Auto-generated on first run with `0600` perms if missing.
Persisting this file across restarts is what keeps audit-log IP
hashes stable across the rotation boundary.

#### `OCR_AUDIT_HMAC_KEY`

Optional explicit HMAC key (hex string). When set, overrides the
file-based key. Use this if you want to inject the key from a secrets
manager instead of letting the server persist it to disk.

#### `OCR_PUMP_VOLUME_MAX`

Upper-bound sanity check on pump-display volume readings. The OCR
result is rejected if the detected volume exceeds this (raw value, in
whichever unit the pump displays). Default `200` covers any
consumer-vehicle fillup with margin.

#### `OCR_PUMP_COST_MAX`

Upper-bound sanity check on pump-display cost readings. The OCR
result is rejected if the detected cost exceeds this (raw display
number, no currency conversion). Default `500` covers extreme fuel
prices and large fillups.

#### `OCR_PUMP_PRICE_PER_UNIT_MAX`

Upper-bound sanity check on the per-unit price detected on the pump
display. Cross-checked against `volume × price ≈ cost` (within 5%) to
catch OCR misreads of the three numbers. Default `20` covers
high-octane / diesel pricing with margin.

#### `OCR_ODOMETER_MAX_MI`

Absolute upper bound on a detected odometer reading, in miles.
Server-side hard reject (separate from the client-side advisory range
check against the last fillup). Default `1000000` is a safety stop,
not a typical-usage check.

#### OCR persistence paths

The three `OCR_*_PATH` defaults assume the same `/data` Docker volume as
`FX_CACHE_PATH`. The server `mkdir -p`s the parent directory on first
write, so a missing nested dir is fine — but `/data/` itself is not
writable without root on macOS. For local dev outside Docker, override
them to a writable location, e.g.:

        OCR_BUDGET_PATH=./data/ocr-budget.json
        OCR_AUDIT_PATH=./data/ocr-audit.jsonl
        OCR_AUDIT_KEY_PATH=./data/ocr-audit-key.txt

## Cross-reference

The repo's [`README.md`](../../README.md) §Configuration shows a
minimal 5-row version of this table for first-run setup. The
[`.env.example`](../../.env.example) file at the repo root mirrors
this reference as a copy-paste template.

For the FX provider chain details and the cache file format, see
[`currency-fx.md`](currency-fx.md) (user perspective) and
[`../technical/fx-chain.md`](../technical/fx-chain.md) (internals).
