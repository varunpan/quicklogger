# Currency & FX conversion

quicklogger lets you enter cost in any of the major currencies it knows
about. Conversion to your LubeLogger target currency happens server-side
the moment you tap **Log fillup**, so the value stored upstream is always
in the configured target currency.

## Entering cost

The **Cost** field sits below **Volume** on the main form. It has two
inputs side-by-side:

- A numeric cost input (`type="number"`, decimal step).
- A currency selector with these five options:

  | Code | |
  | --- | --- |
  | `USD` | US dollar |
  | `CAD` | Canadian dollar |
  | `EUR` | Euro |
  | `GBP` | Pound sterling |
  | `MXN` | Mexican peso |

The currency defaults to whatever you set in
[Settings → Default currency](app-pages.md#settings-settings). On the
first form open with no preferences saved, it defaults to `USD`.

## Live conversion preview

Once you've entered a valid volume **and** cost, a blue summary line
appears above the **Log fillup** button:

        Will log: 11.20 Gal · $42.18 USD  ·  28.4 MPG since last fill

The line always shows the converted gallons and USD-equivalent cost the
server will receive. It optionally adds:

- **MPG since last fill** — only if there is a previous fillup to
  compare against and the form has a valid odometer reading.
- **`FX rate is stale`** in amber — only if the cached FX rate is older
  than 24 hours (see "FX freshness" below).

If you've entered cost in `USD`, the preview is just an echo (1:1). The
conversion line is most useful when entering in `CAD`/`EUR`/etc. so you
can sanity-check the rate before submitting.

## When conversion happens

The browser fetches the live FX rate via `GET /api/fx?from=…&to=…` for
preview purposes only. The **authoritative** conversion happens
server-side inside `POST /api/fuelup`, using the same FX provider chain.
The number stored in LubeLogger is the server's result — even if the
preview was using a slightly stale cached rate, the server re-runs the
same FX chain at submit time and uses its result (which may be a cached
rate younger than 24h, or a freshly fetched one if the cache is stale).

## FX freshness

The server caches FX rates on disk (path configurable via
`FX_CACHE_PATH`, default `/data/fx-cache.json`). Two windows apply (plus
an expiry boundary):

- **Fresh (≤ 24h)** — the cached rate is used directly. No upstream
  provider call is made.
- **Stale fallback (≤ 7 days)** — if **all** upstream providers fail
  (network down, all providers rate-limited, etc.) and the cache has a
  rate younger than 7 days, the server falls back to the cached rate and
  flags `stale: true` on the response. The UI surfaces this as
  *"FX rate is stale"* in amber on the preview line.
- **Older than 7 days** — the rate is no longer used. The endpoint
  returns `503 { "available": false }` and the form prompts you for a
  manual rate (see below).

### Provider chain

When the cache is cold or stale, the server tries providers in order:

1. `frankfurter` — ECB-derived, no key required.
2. `erapi` (open.er-api.com) — community feed, no key required.
3. `fawazahmed` (jsDelivr CDN) — daily mirror, no key required.

The first provider to return a usable rate wins; the result is cached.
You can change the order or drop providers via the `FX_PROVIDERS` env
var (see [`configuration.md`](configuration.md)).

## Override the target currency

By default the server converts to USD before posting to LubeLogger. Set
the `LUBELOGGER_CURRENCY` env var to override — for example
`LUBELOGGER_CURRENCY=CAD` if your LubeLogger instance tracks costs in
Canadian dollars. The form's hint text always says `USD` (it's a static
label), but the actual conversion uses whatever target you configured.

See [`configuration.md`](configuration.md) for the full env-var reference.

## What if everything fails?

If the live FX endpoint returns `{ available: false }` (all providers
failed **and** the cache is older than 7 days), the form shows an extra
manual-rate input above the buttons:

        FX rate (1 CAD = ? USD) — entered manually because rate sources
        are unreachable

Type a sensible rate (e.g. `0.73` for CAD→USD) and submit. The server
trusts your number and uses it verbatim for that one submission. Nothing
is written back to the FX cache — your manual rate is for that submit
only, the next submit re-attempts the provider chain.

This path is rare. With three independent providers in the default
chain it would normally require a multi-day outage of all three plus a
cold cache.

## Cross-reference

For the internals — provider implementations, the cache file format,
the timeout/abort semantics, and the test fakes — see
[`../technical/fx-chain.md`](../technical/fx-chain.md).
