# FX provider chain — internals

## Overview

Submissions in a non-target currency are converted server-side at submit
time, not on the client. The conversion is driven by a multi-provider
FX chain with a persistent on-disk cache. The page's live FX preview
(`GET /api/fx`) is backed by the same chain.

Source: `src/lib/server/currency.ts`, wired in
`src/routes/api/fuelup/+server.ts` and `src/routes/api/fx/+server.ts`.
Config: `src/lib/server/env.ts`.

User-facing view: [`docs/user/currency-fx.md`](../user/currency-fx.md).
Big-picture map: [`docs/architecture.md`](../architecture.md).

## Provider chain order

Defaults (from `loadEnv()` in `src/lib/server/env.ts`):

```
frankfurter,erapi,fawazahmed
```

Overridable via the `FX_PROVIDERS` env var (CSV, trimmed). Unknown
provider names throw `EnvError` at startup, which fast-fails the
container so misconfiguration is visible immediately.

The chain is walked in order on every `getRate(from, to)` call where
the cache is cold or stale. First success wins; the cache is updated
and the result is returned. Subsequent failures (in the same call) of
later providers never happen — the loop short-circuits on first
success.

## Per-provider table

Source: the `switch` in `realFetcher` (`src/lib/server/currency.ts`).
All three are free (no API key required) and use
`AbortSignal.timeout(3000)` for a 3-second per-request budget.

| Provider | URL | Notes |
|---|---|---|
| `frankfurter` | `https://api.frankfurter.dev/v1/latest?base=${from}&symbols=${to}` | ECB-backed, daily rates. Response shape: `{ rates: { [code]: number } }`. |
| `erapi` | `https://open.er-api.com/v6/latest/${from}` | Free, no key required. Returns rates for all currencies; we pick `[to]`. |
| `fawazahmed` | `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${from-lowercased}.json` | jsDelivr-hosted; both currency codes are lowercased on the request. |

The page's currency dropdown is limited to USD/CAD/EUR/GBP/MXN (see
`src/routes/+page.svelte`). The chain itself supports any code the
upstream provider supports, but the UI doesn't expose them.

## Resolution flow

`CurrencyService.getRate(from, to)` in `currency.ts`:

1. **Identity short-circuit.** If `from === to`, return
   `{ rate: 1, source: 'identity', stale: false, ageHours: 0 }`
   without touching the cache or the network.
2. **Disk cache hit.** Load the cache JSON via the injected `FxStore`.
   If there's an entry for the `${from}:${to}` key and its `fetchedAt`
   is within the **24-hour fresh window** (`FRESH_MAX_MS = 24 * 60 * 60
   * 1000`), return it with `stale: false`.
3. **Provider chain.** Walk `opts.providers` in order. For each
   provider, call `opts.fetcher(provider, from, to)` (production:
   `realFetcher` above). On success, persist the new entry to the
   store and return with `stale: false`. On failure, log a warning
   (`[fx] provider <name> failed: <message>`) and continue.
4. **Stale-cache fallback.** If every provider failed but a cache
   entry exists and is within the **7-day stale window**
   (`STALE_MAX_MS = 7 * 24 * 60 * 60 * 1000`), return it with
   `stale: true`. The page renders an amber "FX rate is stale"
   warning in this case.
5. **All-fail.** If no fresh provider succeeded and no cache entry
   is within 7 days, throw `FxUnavailableError`. The `/api/fuelup`
   handler surfaces this as a 500 (the catch-all branch in `+server.ts`);
   the `/api/fx` handler maps it specifically to a 503 with
   `{ available: false }` so the form knows to show the manual-FX
   override field.

### Result shape

```ts
{
  rate: number;
  source: 'frankfurter' | 'erapi' | 'fawazahmed' | 'identity' | 'manual';
  fetchedAt: number;     // ms epoch
  stale: boolean;        // true only on the 7-day fallback branch
  ageHours: number;      // (Date.now() - fetchedAt) / 3.6e6
}
```

`'manual'` is set by the conversion orchestrator (`src/lib/server/convert.ts`)
when `manualFxRate` is set on the input — the currency service is not
consulted in that case.

## Cache shape

Stored as a single JSON file. Default path: `/data/fx-cache.json`
(overridable via `FX_CACHE_PATH`). The `JsonFileStore` implementation
in `currency.ts`:

- `load()` — `readFile(path, 'utf-8')` → `JSON.parse`. On `ENOENT`
  returns `{}` (cold start); any other error propagates (the freshness
  check in `getRate` catches it and falls back to a cold cache).
- `update(mutator)` — the only write path. Under a per-path async lock
  (`withPathLock` in
  [`atomicFile.ts`](../../src/lib/server/atomicFile.ts)) it re-reads the
  cache fresh, applies `mutator` (which merges the one new pair), and
  writes via temp file + `rename` (`atomicWriteFile`). The lock spans the
  whole read-modify-write, so a concurrent lookup for a *different* pair
  can't clobber this write, and the atomic rename means a crash mid-write
  can't leave a torn `fx-cache.json`. A corrupt/unparseable file
  self-heals — the locked read falls back to `{}` and the fresh fetch
  rebuilds it.

  Scope: an **in-process** lock. The FX service is a module-level singleton
  and the app runs single-replica, so one lock per process covers every
  writer. (The previous "serialize via the module-level singleton" claim was
  wrong — the singleton is the *service object*, not a lock, and `await
  load()` yields the event loop.) A multi-replica deployment sharing `/data`
  would need an OS-level file lock.

On-disk shape:

```json
{
  "USD:CAD": {
    "rate": 1.36,
    "fetchedAt": 1746792000000,
    "source": "frankfurter"
  },
  "EUR:CAD": {
    "rate": 1.49,
    "fetchedAt": 1746792001234,
    "source": "erapi"
  }
}
```

Keys are `${from}:${to}` (case-sensitive — both sides are uppercased
and validated as `/^[A-Z]{3}$/` at both route boundaries: `/api/fx`
and the fuelup `validate()` gate, so a `:` or path characters can't
reach the key format or the provider URLs). One entry per direction.

The cache is **capped at 50 entries** (`MAX_CACHE_ENTRIES` in
`currency.ts`): the merge mutator evicts oldest-by-`fetchedAt` past the
cap. Route validation is the first gate against client-influenced key
growth; the cap is the backstop. Provider URLs are additionally built
with `URLSearchParams`/`encodeURIComponent` (defense in depth — the
fetcher never trusts its inputs even though both callers validate).

## Per-provider quirks

### Timeouts

All three providers wrap the fetch in `AbortSignal.timeout(TIMEOUT_MS)`
where `TIMEOUT_MS = 3_000` — a 3-second per-request budget. On timeout the
abort rejects into the chain walk, which logs a warning and moves to the
next provider.

### Failure logging

Every provider failure is logged via `console.warn` with the format:

```
[fx] provider <name> failed: <error message>
```

Failures never throw out of the chain — only the final "all providers
failed AND no usable cache" branch throws `FxUnavailableError`.

### Response-shape variance

- `frankfurter` returns `{ rates: { [code]: number } }`. We pick
  `rates[to]`.
- `erapi` returns `{ rates: { [code]: number } }`. Same shape.
- `fawazahmed` returns `{ [from-lowercased]: { [code-lowercased]: number } }`.
  We pick `json[from.toLowerCase()][to.toLowerCase()]`.

If the expected field is missing, not a number, or not a finite value
greater than zero (`NaN`, `0`, or negative — which would otherwise be
cached and zero out or corrupt the converted cost), the provider throws
its own error message (`"<name> no rate"`) and the chain moves on.

## Operational notes

- The cache file lives at `/data/fx-cache.json` by default. In a
  Docker deployment, mount `/data` as a volume so the cache survives
  container restarts.
- A cold cache + offline first-resolve = `FxUnavailableError`. After
  the first successful online resolve, the cache covers the 7-day
  stale window even if every provider goes down afterwards.
- The `getRate` call is the only path that writes to the cache;
  there's no manual seeding or refresh endpoint.

## Cross-references

- [`docs/user/currency-fx.md`](../user/currency-fx.md) — user-facing
  view of the chain, manual override, stale warnings.
- [`docs/architecture.md`](../architecture.md) —
  high-level map; this doc owns the details.
- `src/lib/server/convert.ts` — conversion orchestrator that combines
  units + currency for the submit path.
