# LubeLogger server info — internals

## Overview

Read-only LubeLogger server status surfaced on `/settings`: connection health
(reachable + key valid), the running LubeLogger version, and an
update-available hint. quicklogger can't act on any of it — it just reports it.
Backed by `GET /api/server-info`, a **health probe** that merges LubeLogger's
`/api/info` and `/api/version`. User guide:
[`docs/user/app-pages.md`](../user/app-pages.md#lubelogger-server). HTTP-API
inventory: [`docs/technical/idb-and-api.md`](./idb-and-api.md).

This is **branch 1 of a two-branch effort**. The `locale` / `currencySymbol` /
`decimalSeparator` / `dateFormat` fields are fetched and cached now but
**unused this branch** — the follow-up branch consumes them for locale-driven
display formatting (see § *Deferred to the follow-up*).

## Files touched

- [`src/lib/server/lubelogger.ts`](../../src/lib/server/lubelogger.ts) — adds
  `LubeLoggerInfo` / `LubeLoggerVersion` types and `getInfo()` / `getVersion()`,
  thin wrappers over the existing `request()` helper (gets `x-api-key`, the 5 s
  timeout, structured logging, and `LubeLoggerError`-on-non-2xx for free).
- [`src/routes/api/server-info/+server.ts`](../../src/routes/api/server-info/+server.ts)
  — the route. Runs both upstream calls with `Promise.allSettled`, merges via the
  pure `_buildServerInfo`, computes `updateAvailable` via the pure
  `_isUpdateAvailable`, and always returns HTTP 200.
- [`src/lib/shared/types.ts`](../../src/lib/shared/types.ts) — `ServerInfo` /
  `ServerInfoStatus` (the route's response and the cache's stored shape).
- [`src/lib/client/server-info.ts`](../../src/lib/client/server-info.ts) —
  localStorage cache (`quicklogger-server-info`), separate from `prefs`.
- [`src/routes/settings/+page.svelte`](../../src/routes/settings/+page.svelte)
  — the consumer: paints the cached value, fetches `/api/server-info` on mount.

## Data model

`ServerInfo` (`src/lib/shared/types.ts`) — the route response and the cached shape:

```ts
type ServerInfoStatus = 'ok' | 'unauthorized' | 'unreachable';

interface ServerInfo {
  reachable: boolean;                 // ≥1 of the two upstream calls resolved
  status: ServerInfoStatus;
  currentVersion: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
  locale: string | null;              // cached, unused this branch
  currencySymbol: string | null;      // cached, unused this branch
  decimalSeparator: string | null;    // cached, unused this branch
  dateFormat: string | null;          // cached, unused this branch
}
```

Upstream wire shapes (`src/lib/server/lubelogger.ts`), both flat and all-string,
verified by curling the live v1.6.5 instance during design:

```text
GET /api/info    → {"currentVersion":"1.6.5","locale":"en-US","currencySymbol":"$","decimalSeparator":".","dateFormat":"M/d/yyyy"}
GET /api/version → {"currentVersion":"1.6.5","latestVersion":"1.6.5"}
```

Stored client-side under localStorage key `quicklogger-server-info` — the **full**
payload, including the cached-but-unused locale fields, so the follow-up branch
just reads the cache.

## Lifecycle / control flow

1. **Settings mount.** The page reads the cache (`loadServerInfo()`) and paints
   it instantly (SWR). If the cache is empty it shows a "Checking…" state.
2. **Live fetch.** `onMount` fires `GET /api/server-info`. On resolve the page
   updates state and writes the cache (`saveServerInfo`).
3. **Route.** Builds a `LubeLoggerClient` from `LUBELOGGER_URL` +
   `LUBELOGGER_API_KEY` (no new env), runs `Promise.allSettled([getInfo,
   getVersion])`, and merges.

Merge rules (`_buildServerInfo`):

- `reachable` = **at least one** call fulfilled. (In practice both hit the same
  server with the same auth, so they succeed/fail together; the split case is an
  accepted rare edge. The health indicator means "reachable + key valid," which
  any successful call answers.)
- `status` = `ok` when reachable; else `unauthorized` if **every** rejection is a
  `LubeLoggerError` with `status === 401`; else `unreachable` (404, 5xx, network,
  timeout, mixed).
- `currentVersion` prefers `/api/version`, falls back to `/api/info`;
  `latestVersion` only comes from `/api/version`.
- `updateAvailable` = `_isUpdateAvailable(currentVersion, latestVersion)`.

## Edge cases & invariants

- **Always HTTP 200.** "I checked and it's down" is a successful probe result —
  the route returns 200 with `reachable: false` + the right `status` + null data
  on upstream failure. Deliberately different from the data-serving routes, which
  re-emit upstream errors as 502/4xx. The Settings block can therefore always
  parse the body.
- **`_isUpdateAvailable` never throws.** Returns `false` on a missing version, any
  non-integer version part (e.g. `1.7.0-beta` → `Number('0-beta')` is `NaN`), or
  `latest <= current`. Missing trailing parts compare as 0 (`1.6` === `1.6.0`).
- **Older-version safety.** An instance missing an endpoint returns 404 → flows to
  `reachable: false` at HTTP 200; the block degrades to "Can't reach LubeLogger"
  and nothing errors. No new minimum-version requirement (the de-facto floor is
  already v1.6.5 via the vehicle-images feature).
- **Cache is separate from `prefs`.** Distinct writer (network refresh vs Settings
  UI) and lifecycle. A garbage or absent value parses to `null`; SSR (no
  `localStorage`) returns `null`. New key, no IDB version bump, no SW cache change.

## Non-obvious decisions

- **`Promise.allSettled`, not `Promise.all`.** A flaky `/api/version` must not
  blank out the `/api/info` fields and vice versa. `all` would reject the whole
  probe on either failure.
- **Both endpoints, not one.** `/api/version` is the only one carrying
  `latestVersion` (update check); `/api/info` carries the locale/format fields
  (cached for the follow-up). `/api/info` repeats `currentVersion` as a fallback.
- **Fetch on Settings mount, not a root-layout boot fetch.** The only consumer of
  the cache this branch is the Settings page; a boot fetch would be a network call
  on every page load with no consumer. The boot refresh moves to the follow-up,
  where locale-driven formatting needs `locale` fresh app-wide.
- **No new env var.** Same `LubeLoggerClient` from the existing
  `LUBELOGGER_URL` + `LUBELOGGER_API_KEY` as every other upstream route.

## Deferred to the follow-up

The cached `locale` / `currencySymbol` / `decimalSeparator` / `dateFormat` fields
exist for branch 2: adopting the `culture-invariant` header on read/write,
refactoring `GasRecord` / `Reminder` parsing to the invariant shape, locale-driven
`Intl` display formatting, and moving the `/api/server-info` fetch to a
root-layout boot refresh.
