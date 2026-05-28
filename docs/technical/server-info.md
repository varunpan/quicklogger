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
`decimalSeparator` / `dateFormat` fields are fetched and cached for branch 2
(this branch), which consumes them for locale-driven display formatting. The
`lubeloggerCurrency` field (added in branch 2) carries the server-side
`LUBELOGGER_CURRENCY` env value through the same cache so client-side cost
rendering knows the instance currency without re-reading env on every paint.

## Files touched

- [`src/lib/server/lubelogger.ts`](../../src/lib/server/lubelogger.ts) — adds
  `LubeLoggerInfo` / `LubeLoggerVersion` types and `getInfo()` / `getVersion()`,
  thin wrappers over the existing `request()` helper (gets `x-api-key`, the 5 s
  timeout, structured logging, and `LubeLoggerError`-on-non-2xx for free).
- [`src/lib/server/github-release.ts`](../../src/lib/server/github-release.ts) —
  owns the GitHub `releases/latest` call: a 3 s `AbortSignal.timeout`, a
  module-level 1 h TTL cache, v-prefix stripping, and never-throws error
  handling (timeout / network / non-200 / 404 / malformed → last-known-good or
  null, all logged via the request logger). Kept separate from
  `LubeLoggerClient` because GitHub is a different upstream.
- [`src/routes/api/server-info/+server.ts`](../../src/routes/api/server-info/+server.ts)
  — the route. Runs both upstream calls with `Promise.allSettled`, merges via the
  pure `_buildServerInfo`, computes `updateAvailable` via the pure
  `_isUpdateAvailable`, and always returns HTTP 200.
- [`src/lib/shared/types.ts`](../../src/lib/shared/types.ts) — `ServerInfo` /
  `ServerInfoStatus` (the route's response and the cache's stored shape).
- [`src/lib/client/server-info.ts`](../../src/lib/client/server-info.ts) —
  localStorage cache (`quicklogger-server-info`), separate from `prefs`.
- [`src/routes/+layout.svelte`](../../src/routes/+layout.svelte) — boot-refreshes
  the cache via `GET /api/server-info` from the root `onMount`, so locale /
  currency / dateFormat are fresh app-wide before any consumer renders.
- [`src/routes/settings/+page.svelte`](../../src/routes/settings/+page.svelte)
  — reads the cache only (`loadServerInfo()` at script-run time); does not
  fetch or write. Single-writer invariant for `quicklogger-server-info`.

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
  locale: string | null;              // cached from /api/info
  currencySymbol: string | null;      // cached from /api/info
  decimalSeparator: string | null;    // cached from /api/info
  dateFormat: string | null;          // cached from /api/info
  lubeloggerCurrency: string | null;  // LubeLogger instance currency (ISO); sourced from env.lubeloggerCurrency
  appCurrentVersion: string | null;   // __APP_VERSION__ at runtime; null only on the unreachable fallback
  appLatestVersion: string | null;    // latest GitHub release tag, v-stripped; null if unknown
  appUpdateAvailable: boolean;        // _isUpdateAvailable(appCurrentVersion, appLatestVersion)
  appReleaseUrl: string | null;       // GitHub release html_url; null if unknown
}
```

Upstream wire shapes (`src/lib/server/lubelogger.ts`), both flat and all-string,
verified by curling the live v1.6.5 instance during design:

```text
GET /api/info    → {"currentVersion":"1.6.5","locale":"en-US","currencySymbol":"$","decimalSeparator":".","dateFormat":"M/d/yyyy"}
GET /api/version → {"currentVersion":"1.6.5","latestVersion":"1.6.5"}
```

Stored client-side under localStorage key `quicklogger-server-info` — the **full**
payload, including the locale fields and the env-sourced `lubeloggerCurrency`,
so consumers can paint locale-driven displays from the cache without re-fetching.

## Lifecycle / control flow

1. **Root layout mount.** `+layout.svelte` `onMount` fires `GET /api/server-info`
   and writes the result via `saveServerInfo()`. Fire-and-forget; silent on
   failure (keeps whatever cache holds).
2. **Settings render.** Reads the cache via `loadServerInfo()` and paints it.
   No fetch on the Settings page itself.
3. **Refresh model.** To get fresh server-info, reload the app — the layout's
   onMount runs again. There is no explicit "Refresh" button; this is
   acceptable given how rarely server config changes.
4. **Route.** Builds a `LubeLoggerClient` from `LUBELOGGER_URL` +
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
- `lubeloggerCurrency` is **not** sourced from either upstream call — it's the
  server-side `env.lubeloggerCurrency` (`LUBELOGGER_CURRENCY`, default `'USD'`)
  passed into `_buildServerInfo` and surfaced verbatim. The `UNREACHABLE` path
  (outer `catch` around `loadEnv()`) emits `null` because env isn't available.

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
- **Boot refresh in +layout.svelte, not Settings.** Branch 2 needs locale
  and currency fresh app-wide (format.ts, last-fillup.ts read the cache on
  every page), not only when the user visits Settings. Moving the writer
  to the layout keeps the single-writer invariant intact.
- **No new env var.** Same `LubeLoggerClient` from the existing
  `LUBELOGGER_URL` + `LUBELOGGER_API_KEY` as every other upstream route.

## quicklogger self-update check (GitHub release)

A third upstream — the quicklogger GitHub repo — folds into the same probe so
the app can hint when it is itself out of date. Deploy stays manual (homelab
pins `:latest`, `docker compose pull && up -d`); the check never acts.

- **Module.** `src/lib/server/github-release.ts` calls
  `GET https://api.github.com/repos/varunpan/quicklogger/releases/latest` with
  `Accept: application/vnd.github+json` and a 3 s timeout. The owner/repo slug is
  **hardcoded** (`varunpan/quicklogger`) — personal tool, no fork support, matches
  the hardcoded footer link. It strips the leading `v` from `tag_name`.
- **TTL cache.** Module-level `{ checkedAt, release }`. Inside 1 h → cached value,
  no GitHub call. Past 1 h → one attempt; success updates the cache, any failure
  (timeout / network / non-200 / 404 / malformed) stamps `checkedAt = now` but
  **keeps last-known-good** (`release` stays null only on a cold start with GitHub
  unreachable). Bounds GitHub to <=1/hour, far under the 60/hour unauthenticated
  per-IP limit.
- **Logging.** Timeout / network / non-200 / malformed → `warn`. A 404 ("no
  releases yet") → `info` (expected-ish, not a fault). Success logs nothing. The
  TTL means a persistent outage logs ~once/hour, not once per request.
- **Route integration.** `getLatestRelease(locals.logger)` is a **third
  `Promise.allSettled` arm** alongside `getInfo()` / `getVersion()`. The module
  never throws, so the arm always fulfils with `GithubRelease | null`;
  `_buildServerInfo` reads it defensively (`releaseR.status === 'fulfilled' ?
  releaseR.value : null`). A GitHub failure therefore cannot disturb the
  LubeLogger fields, and the route keeps its always-200 contract.
- **App fields.** `appCurrentVersion` is `__APP_VERSION__` (a Vite compile-time
  define; guarded with `typeof` since it is undefined under vitest — same pattern
  as `hooks.server.ts`). `appLatestVersion` / `appReleaseUrl` come from the
  release (or null). `appUpdateAvailable` reuses the pure `_isUpdateAvailable`, so
  running *ahead* of latest, a non-integer version part, or a missing version all
  yield `false`.

## Follow-up consumption (branch 2)

The cached `locale` / `currencySymbol` / `decimalSeparator` / `dateFormat` fields
and the new env-sourced `lubeloggerCurrency` are consumed by branch 2: adopting
the `culture-invariant` header on read/write, refactoring `GasRecord` /
`Reminder` parsing to the invariant shape, locale-driven `Intl` display
formatting (numbers, dates, currency for upstream-cached entries), and moving
the `/api/server-info` fetch to a root-layout boot refresh.
