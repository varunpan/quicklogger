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

| Var | Type | Required | Default | Purpose |
| --- | --- | --- | --- | --- |
| `LUBELOGGER_URL` | URL | **yes** | — | Base URL of your LubeLogger instance (no trailing slash). All upstream API calls are made against this host. |
| `LUBELOGGER_API_KEY` | string | **yes** | — | API key used for the `x-api-key` header on every LubeLogger request. |
| `LUBELOGGER_VOLUME_UNIT` | string | no | `gallons_us` | The volume unit LubeLogger expects on inserts. quicklogger converts every submission to this unit before posting. |
| `LUBELOGGER_CURRENCY` | ISO 4217 code | no | `USD` | The currency LubeLogger expects for cost. quicklogger converts every submission to this currency at submit time via the FX chain. |
| `FX_PROVIDERS` | comma-separated list | no | `frankfurter,erapi,fawazahmed` | Ordered list of FX providers tried in sequence when the cache is cold or stale. First success wins. |
| `FX_CACHE_PATH` | filesystem path | no | `/data/fx-cache.json` | On-disk path the server reads/writes for the persistent FX cache. The directory is created if it doesn't exist. |
| `PORT` | int | no | `3000` | HTTP listen port for the Node server. |
| `ORIGIN` | URL | no | (unset) | The public origin SvelteKit's CSRF check should accept on POSTs. Set this when you run behind a reverse proxy that terminates a different hostname than the one Node sees. |

The startup loader fails fast (`EnvError`) if a required var is missing
or if `FX_PROVIDERS` contains an unknown provider name.

## When to override each

### `LUBELOGGER_VOLUME_UNIT`

LubeLogger supports `gallons_us`, `gallons_uk`, and `liters`. Set this
to match your LubeLogger instance's configured unit so the server
sends consistent values. The form's own `Gal`/`L` toggle is for input
convenience only; the server always converts.

### `LUBELOGGER_CURRENCY`

Set this when your LubeLogger tracks costs in a currency other than
USD (e.g. `CAD`, `EUR`). The form will continue to accept cost in any
of its supported entry currencies; the server converts to your target
before insert. Example:

        LUBELOGGER_CURRENCY=CAD

A submission entered as `42.18 USD` will be FX-converted to CAD before
landing in LubeLogger.

### `FX_PROVIDERS`

Override the default chain when:

- A provider is consistently rate-limiting you and you want to drop it.
- You want a different fallback order.
- You're testing one specific provider in isolation.

Supported provider names: `frankfurter`, `erapi`, `fawazahmed`. Any
other name causes startup to fail with `Unknown FX provider`. Example:

        FX_PROVIDERS=frankfurter,fawazahmed

See [`currency-fx.md`](currency-fx.md) for what each provider does.

### `FX_CACHE_PATH`

Default is `/data/fx-cache.json`, which assumes a Docker volume mounted
at `/data`. Change it if you're running outside of Docker or your
volume is mounted elsewhere. The file is small (one JSON object,
typically a few hundred bytes); make sure the directory is writable by
the process user.

Example for local dev outside Docker:

        FX_CACHE_PATH=./fx-cache.json

### `PORT`

Change when port 3000 conflicts with something else on the host, or
when you're running multiple quicklogger instances on the same host
behind a reverse proxy.

### `ORIGIN`

SvelteKit validates the `Origin` header on POST requests as a CSRF
defense. When the server runs inside a container behind a reverse
proxy, Node sees the proxy's request and may reject the POST because
the `Origin` doesn't match what it expects. Set `ORIGIN` to your
**public** URL — what the browser actually sees in its address bar:

        ORIGIN=https://quicklogger.example.com

If you're running quicklogger directly on a host with no proxy, you
can leave this unset and SvelteKit will accept POSTs from any origin
that matches its own listening address.

## Cross-reference

The repo's [`README.md`](../../README.md) §Configuration shows a
minimal 5-row version of this table for first-run setup. The
[`.env.example`](../../.env.example) file at the repo root mirrors
this reference as a copy-paste template.

For the FX provider chain details and the cache file format, see
[`currency-fx.md`](currency-fx.md) (user perspective) and
[`../technical/fx-chain.md`](../technical/fx-chain.md) (internals).
