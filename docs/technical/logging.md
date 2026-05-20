# Structured logger — internals

## Overview

JSON-per-line server logger with per-request `request_id`, secret redaction, optional rotating-file sink, and a forwarding endpoint that funnels browser + service-worker errors into the same stream. User view: [`docs/user/configuration.md#logging-v023`](../user/configuration.md#logging-v023). Architecture context: [`docs/architecture.md`](../architecture.md).

## Files touched

- [`src/lib/server/logger.ts`](../../src/lib/server/logger.ts) — core logger module (`createLogger`, `bootLogger`, `getLogger`), redaction, lazy rotating-file-stream sink via `createRequire`, process crash handlers.
- [`src/lib/server/env.ts`](../../src/lib/server/env.ts) — `LOG_*` env field validation with fall-back-on-invalid + `envWarnings` accumulator flushed at boot.
- [`src/hooks.server.ts`](../../src/hooks.server.ts) — per-request `request_id`, `locals.logger.child`, `X-Request-ID` response header, access-log record at level computed from final status.
- [`src/app.d.ts`](../../src/app.d.ts) — `App.Locals` augmentation: `logger`, `requestId`.
- [`src/lib/server/lubelogger.ts`](../../src/lib/server/lubelogger.ts) — `LubeLoggerClient` emits debug at request start, warn on non-OK, error on timeout / network-error.
- [`src/lib/server/ocr.ts`](../../src/lib/server/ocr.ts) — `runOcrPipeline` emits records at every branch point with `ocr_raw_full` on schema / range / cross-field failures.
- [`src/lib/server/currency.ts`](../../src/lib/server/currency.ts), [`src/lib/server/ocrBudget.ts`](../../src/lib/server/ocrBudget.ts), [`src/lib/server/ocrAudit.ts`](../../src/lib/server/ocrAudit.ts), [`src/lib/server/ocrRateLimit.ts`](../../src/lib/server/ocrRateLimit.ts) — optional `logger?: Logger`, structured records on I/O failure.
- [`src/routes/api/*/+server.ts`](../../src/routes/api/) — every route picks up `locals.logger` + passes it into the consumer module; `LubeLoggerError` catch returns structured `{ error, upstream, upstream_status }`.
- [`src/routes/api/log/+server.ts`](../../src/routes/api/log/+server.ts) — forwarding endpoint for client / sw records; rate limit 60/min/IP, size caps 100kb/batch, 8kb/record, 20 records/batch.
- [`src/lib/client/logger.ts`](../../src/lib/client/logger.ts) — buffered client logger, `fetch` wrapper for X-Request-ID capture, `sendBeacon` on `beforeunload`, secret redaction.
- [`src/service-worker.ts`](../../src/service-worker.ts) — `error` + `unhandledrejection` listeners, sw install-failure beacon.

## Data model

```ts
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(msg: string, ctx?: Record<string, unknown>): void;
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, ctx?: Record<string, unknown>): void;
  child(ctx: Record<string, unknown>): Logger;
}
```

Log record shape (one JSON object per line):

| Field | Type | Source |
|---|---|---|
| `ts` | ISO 8601 string | Logger, set at emit time |
| `level` | `LogLevel` | Method that fired |
| `msg` | string | First arg to the method |
| `request_id` | string | `hooks.server.ts` child binding |
| `route` | `string \| null` | `hooks.server.ts` child binding (`event.route?.id`) |
| `method`, `path`, `status`, `duration_ms` | — | Access-log record at request end |
| `err.message`, `err.stack`, `err.name` | — | Set when `ctx.err` is an `Error` (unpacked by the redactor) |
| arbitrary | unknown | Per-call `ctx` keys merged in; sensitive keys (`api_key`, `token`, `secret`, `password`, `authorization`) replaced with `***` |

Env fields on `Env` (`src/lib/server/env.ts`):

| Field | Default | Notes |
|---|---|---|
| `logLevel` | `'info'` | Invalid values fall back + emit one `envWarnings` line |
| `logPretty` | `NODE_ENV !== 'production'` | `LOG_PRETTY=1` / `=0` override |
| `logFilePath` | `undefined` | Opt-in rotating file |
| `logFileMaxSizeMb` | `5` | Bounded `1..100`; invalid → fallback + warn |
| `logFileMaxFiles` | `5` | Bounded `1..20`; invalid → fallback + warn |
| `envWarnings` | `[]` | Accumulator; `bootLogger` flushes each entry as one `warn` record |

## Lifecycle / control flow

**Server boot:**

1. `loadEnv()` parses `LOG_*` vars. Invalid values are coerced to defaults and a string is pushed onto `envWarnings`. Required vars throwing here happens *before* the logger exists — that's intentional and unchanged.
2. First request triggers `ensureBoot()` in `src/hooks.server.ts`. `bootLogger(env)` opens the optional file sink (lazy `createRequire('rotating-file-stream')`), emits one `logger ready` info record, flushes `envWarnings`, registers `uncaughtException` / `unhandledRejection` handlers, and stashes the singleton.
3. The next line emits `server start` with version, host, configured OCR / FX providers, and `log_file_enabled`.
4. Every request gets `requestId = _newRequestId()`, `locals.requestId = requestId`, `locals.logger = getLogger().child({ request_id, route })`.
5. Routes pull `locals.logger` and either log directly or pass it as `logger?: Logger` into the consumer module (`CurrencyService`, `OcrBudget`, `OcrAudit`, `OcrRateLimit`, `runOcrPipeline`, `LubeLoggerClient`).
6. After `resolve(event)`, the hook checks the response; if it didn't already carry an `X-Request-ID`, the hook clones the response and sets one. Then one access-log record fires: `level = error` for 5xx, `warn` for 4xx (except 404 → `info`), `info` otherwise. Silenced paths (`/healthz`, `/service-worker.js`, `/favicon.ico`, `/_app/*`) skip the access-log line.

**Client:**

1. `installClientLogger()` runs once at module init in `src/routes/+layout.svelte`'s `onMount`. Guards against double-install and no-window environments.
2. It wraps `window.fetch` — every response checks for an `X-Request-ID` header and stashes the most recent value in `lastRequestId`.
3. `window.addEventListener('error', …)` and `window.addEventListener('unhandledrejection', …)` push records onto an in-memory buffer (cap 20; oldest dropped on overflow). Each push schedules a flush.
4. Flush triggers: 10-record threshold (`queueMicrotask`-deferred), 10s timer (backoff doubles to 60s max on 5xx / network failure), or `beforeunload` (uses `navigator.sendBeacon` for fire-and-forget).
5. `POST /api/log` rate-limits 60/min/IP, validates each record's level + msg, then re-emits via `locals.logger[r.level]` with `source: 'client'`, `user_agent`, `referer_route`, and the original `ts` as `client_ts`. The server log stream is now the single place to look for both phone-side and server-side trouble.

## Edge cases & invariants

| Scenario | Behaviour | Why |
|---|---|---|
| 404 on a missing static asset | Access-log fires at `info`, not `warn` | Carved out in `levelFromStatus` — 404s on `/foo.png` aren't actionable |
| Module imported before `bootLogger` runs (tests, top-level imports) | `getLogger()` returns a no-op-style stdout fallback (`level: info`, `pretty: false`) | Keeps tests that import server modules in arbitrary order working without enforcing boot order |
| Deeply-nested `ctx` payload | Redactor stops at depth 5 and emits `'[truncated]'` | Bounds work per record so a pathological prefs blob can't stall a request |
| `rotating-file-stream` not installed in some bundle path | `defaultOpenFileSink` lazy-requires via `createRequire` — only crashes when `LOG_FILE_PATH` is set | Bare ESM `import` would pull the dep into the client bundle |
| Downstream handler already set `X-Request-ID` on the response | Hook leaves the existing header alone | Lets a future SSE / proxy handler own the header without the hook stomping it |
| Client buffer exceeds 20 records | Oldest record dropped on each push | `error` listeners can fire faster than the server drains; bound memory before bounding behaviour |
| 10-record size flush | Deferred via `queueMicrotask` | Avoids a sync flush from the inside of a handler (would re-enter the wrapped `fetch`) |
| `OcrAudit.append` write fails | Logger emits `warn`; promise no longer rejects | Append is best-effort; the audit log going stale must not fail a real OCR request |
| `OcrAudit` rotation truncation throws | Same — `warn`, swallow | Same reasoning as the append branch |
| Cyclic / function / symbol / bigint in `ctx` | Redactor handles each: cycle → `'[cycle]'`, function / symbol → dropped, bigint → stringified | `JSON.stringify` would throw otherwise |
| Two requests in flight on the same Node process | Each has its own `request_id`; child loggers are independent | `child({ … })` returns a fresh closure over `baseCtx`; no shared mutable state |

## Non-obvious decisions

**Client owns the upstream log line, not the route.** When `fetch('/api/foo')` fails, the client logs `error` once via `clientLogger.error` and the server's access-log on the failed `/api/foo` request also fires. Two records for one failure is fine — they carry the same `request_id` and the symmetry helps debugging. The rejected alternative (route handlers logging the inbound client error a second time) doubled the records-per-failure count for no extra signal.

**Client logger reads `X-Request-ID` via a fetch wrapper installed on `window`, not a meta tag.** The very first response from `page.goto('/')` carries the header — there's no meta-tag emission path that fires before the first SPA navigation. Wrapping `window.fetch` catches both the page-load response and every subsequent SPA fetch, with no template work.

**Secret redaction operates on keys (regex), not values.** Matching on key name (`api_key`, `token`, `secret`, `password`, `authorization`) reliably catches the cases we care about. Matching on value shape (looking for `sk-…` / Bearer token patterns) creates false positives the first time a user types `sk-something` into the notes field. Keys are stable; values aren't.

**`bootLogger` is lazy + cached, not module-init eager.** Calling `bootLogger` from `loadEnv()` would force every test that imports `env.ts` to either mock the logger or write to stdout. `ensureBoot()` in the hook fires once on first request — by then the test harness has had its chance to call `_resetLoggerForTests()`.

**`X-Request-ID` is set by cloning the response, not mutating `response.headers`.** SvelteKit's response object exposes a `Headers` instance that, depending on the underlying source (cached static, streamed body, etc.), may or may not be mutable in place. The clone-and-set path is uniform across response types.

**Access-log level mapping.** 5xx → `error`, 404 → `info`, other 4xx → `warn`, 2xx/3xx → `info`. The 404 carve-out matters because `/_app/immutable/foo.css` 404s during a deploy mismatch shouldn't page anyone — they're transient and self-resolving on the next reload.

**Rotation by `rotating-file-stream`, not by the logger itself.** The npm package handles the size watcher, atomic rename, and `maxFiles` eviction. Reimplementing that for the sake of one less dep would be a long tail of edge cases (mid-write rotation, fs race) the package already solves.

## Future considerations

- **Sampling for `info` records on hot paths.** No need yet — sub-100 req/min on the homelab. Add if any deployment outgrows it.
- **OTLP export sink.** The `Logger` interface is narrow enough to back with an OTel exporter; the JSON record shape already mirrors OTLP's log record fields. Deferred until there's a backend to ship to.
- **Per-route log level overrides.** Currently global. A `route → level` map on the env could let `/api/ocr` log at debug while everything else stays at info — useful but premature.
