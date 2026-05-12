# Photo OCR — read your pump and odometer

quicklogger v0.2.0 can read your **gas-pump display** or your **car's
odometer** from a photo and auto-fill the form. The feature is opt-in
and disabled by default — the camera chips only appear when at least
one OCR provider is configured.

| | Pump mode | Odometer mode |
| --- | --- | --- |
| **What it reads** | Volume + Cost (+ price/unit) from the pump display | Mileage from your odometer or a phone app showing it |
| **Where the chip lives** | Between Volume and Cost on the form | Inside the Odometer cell, beside the existing `+N mi` chip |
| **What `[Use]` fills** | Volume, Volume unit (Gal/L), Cost | Odometer |
| **Safety check** | Cross-field consistency (cost ≈ volume × price/unit within 5%) | Relative-range vs your last fillup (must be ≥ last and ≤ last + 2000 mi) |

## Setup

You need at least one provider configured. Both work; if you configure
both, **local ollama is tried first** and OpenRouter is the fallback.

### Option A — local ollama (recommended for privacy)

```sh
# on the host running ollama:
ollama pull qwen2.5vl:7b
```

```yaml
# in your stack's environment:
OLLAMA_VISION_URL: http://ollama:11434
OLLAMA_VISION_MODEL: qwen2.5vl:7b
```

CPU-only inference takes ~15–30 s per photo. A small GPU brings it
under 5 s.

### Option B — OpenRouter (Gemini Flash Lite)

1. Sign up at [openrouter.ai/keys](https://openrouter.ai/keys) and
   generate an API key.
2. Add to your stack:
   ```yaml
   OPENROUTER_API_KEY: sk-or-...
   ```
3. Default model is `google/gemini-2.5-flash-lite` (≈ $0.00006/call).
   The default `OCR_DAILY_BUDGET_USD=1.00` gives you ~16,000 calls/day
   before the cap kicks in.

Full env-var reference:
[`docs/user/configuration.md`](configuration.md#photo-ocr-v020).

## Using it

### Pump mode

1. Open the form (`/`).
2. Tap **Photo pump display** (the blue chip between Volume and Cost).
3. iPhone pops the camera; photograph the pump display.
4. ~2–15 s later a blue chip appears showing the detected values:
   *Detected: 11.2 gal · $42.18 · $3.78/gal*
5. Tap **Use** → Volume + Cost (+ unit) populate. **Discard** dismisses
   without changing anything.

### Odometer mode

1. Tap **Photo** (the smaller blue chip inside the Odometer cell).
2. Photograph either:
   - your dashboard odometer, **or**
   - a screenshot of a phone app showing the mileage (Carfax,
     FuelEconomy.gov, your car's companion app — anything that displays
     the number).
3. A blue chip appears: *Detected: 87,612 mi*. Tap **Use** to populate.
4. If the detected reading is **lower than your last fillup** or
   **more than 2000 mi above it**, you'll see an amber warning chip
   instead of `[Use]`. Tap **Dismiss** and type the value manually.

## What gets stored

- **Image bytes** — never persisted. The photo is resized in your
  browser (1024 px long edge, EXIF stripped) and forwarded to the
  provider, then discarded.
- **Audit log** at `/data/ocr-audit.jsonl` — one line per call,
  recording an HMAC-keyed IP hash, the SHA-256 of the resized image,
  the parsed numeric fields, latency, and which provider served the
  call. No raw IPs, no pixels.
- **Daily $ tally** at `/data/ocr-budget.json` — used by the runaway
  cap. UTC rollover.

## Tips & gotchas

- **Pump display tilt.** The model handles ~30° tilt fine. If you get
  a 422 "Couldn't read clearly" toast, shoot the display square-on and
  retry.
- **Odometer brightness.** Dashboards in direct sun blow out — angle
  the phone to throw a shadow on the cluster.
- **Phone-app odometer screenshots work.** Cropping helps but isn't
  required. The model is prompted explicitly to handle both real
  odometers and app screenshots.
- **First fillup for a vehicle.** No `lastFuelup` to compare against,
  so the odometer chip always shows `[Use]` — no relative check yet.
- **Going offline mid-OCR.** After 90 seconds the client times out and
  surfaces a toast — type the value manually. Image is **not** queued
  for replay (intentional — see internals doc).
- **Cross-currency.** The pump cross-field check is currency-agnostic;
  it relies on the relationship `cost ≈ volume × price/unit`, which
  holds in any currency. Just make sure the currency selector matches
  the pump display.
- **Hitting the rate limit.** Default 20/hr is generous for real use;
  hitting it usually means OCR is misfiring on a non-pump scene. Toast
  tells you when to retry.

## Troubleshooting

| Toast | Cause | What to do |
| --- | --- | --- |
| *Couldn't read clearly — try again or type manually* | 422 — values failed the range check or pump cross-field check (5% drift) | Re-shoot square-on, or type the values |
| *Couldn't read image — try a clearer photo* | 415 — file wasn't a recognized image type | Re-take the photo |
| *OCR service unreachable — please type values* | 502/503 — providers down, ollama crashed, or no provider configured | Type values; check provider health later |
| *OCR took too long — please type values* | 90 s client timeout | Type values; ollama may be loading the model — first call after a cold start is slow |
| *OCR rate limit reached, try again in Ns* | 429 — > 20 calls in the last hour | Wait `N` seconds; if hitting this routinely, raise `OCR_RATE_LIMIT_PER_HOUR` |
| *OCR budget for today reached* | 402 — daily $ cap exhausted | Wait until UTC rollover (00:00 UTC) or raise `OCR_DAILY_BUDGET_USD` |
| *Photo too large — try again* | 413 — file > 5 MiB after multipart parse | Should be rare; the in-browser resize keeps photos well under this. Re-take and try again |

## Receipt mode (planned for v0.2.1)

Photographing receipts is wire-accepted by the API now (it returns 501)
and ships fully in v0.2.1 with receipt-specific fields (date, station,
fuel grade). Local ollama accuracy on receipts is lower than on pump
displays — operators will be able to opt out of ollama for receipt mode
specifically (design TBD in v0.2.1).
