# Photo OCR — read your pump and odometer

quicklogger v0.2.0 can read your **gas-pump display** or your **car's
odometer** from a photo and auto-fill the form. The feature is opt-in
and disabled by default — the camera chips only appear when at least
one OCR provider is configured.

| | Pump mode | Odometer mode |
| --- | --- | --- |
| **What it reads** | Volume + Cost (+ price/unit) from the pump display | Mileage from your odometer or a phone app showing it |
| **Where the chip lives** | Top of the form, in the capture row under the vehicle picker | Same — the capture row holds both photo pills |
| **What `[Use]` fills** | Volume, Volume unit (Gal/L), Cost | Odometer |
| **Safety check** | Cross-field consistency (cost ≈ volume × price/unit within 5%) | Relative-range vs your last fillup (must be ≥ last and ≤ last + 2000 mi) |

## Setup

You need at least one provider configured. quicklogger chains them in
order; the first one that returns a clean reading wins, and on
failure (timeout, HTTP error, quota exhaustion) the next slot in the
chain is tried automatically.

| Slot identifier      | Speed         | Privacy        | Cost (per call)    | Setup difficulty |
|----------------------|---------------|----------------|---------------------|------------------|
| `ollama-local`       | ~15–30 s CPU  | fully local    | free                | medium (run ollama) |
| `ollama-cloud`       | ~1 s          | request leaves the box | free (weekly GPU-time budget) | easy (one API key) |
| `openrouter`         | ~2–5 s        | request leaves the box | ~$0.00006           | easy (one API key) |
| `openai-compatible`  | varies        | varies         | varies              | medium (URL+key+model) |

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

### Option B — Ollama Cloud (recommended for speed)

```sh
OLLAMA_CLOUD_API_KEY: sk-...   # from https://ollama.com
```

That's it — `OLLAMA_CLOUD_URL` and `OLLAMA_CLOUD_MODEL` default to
sensible values (`https://ollama.com`, `gemma4:31b`). See
[Ollama Cloud model selection](#ollama-cloud-model-selection) below
for tested alternatives.

Cloud inference takes ~1 s on the default model. Free tier comes
with a weekly GPU-time budget that easily covers a daily-driver
fillup cadence; once exhausted you get HTTP 429 and the chain falls
through to the next configured slot.

### Option C — OpenRouter (Gemini Flash Lite)

1. Sign up at [openrouter.ai/keys](https://openrouter.ai/keys) and
   generate an API key.
2. Add to your stack:
   ```yaml
   OPENROUTER_API_KEY: sk-or-...
   ```
3. Default model is `google/gemini-2.5-flash-lite` (~$0.00006/call).
   The default `OCR_DAILY_BUDGET_USD=1.00` gives you ~16,000 calls/day
   before the cap kicks in.

### Option D — Any OpenAI-compatible vision endpoint

Routes through the same code path as OpenRouter, but lets you point
at any chat-completions-compatible service: Groq, Cerebras, OpenAI
direct, a LiteLLM proxy, etc. All three vars must be set:

```yaml
OPENAI_COMPATIBLE_URL: https://api.groq.com/openai/v1/chat/completions
OPENAI_COMPATIBLE_API_KEY: gsk_...
OPENAI_COMPATIBLE_MODEL: llama-3.2-90b-vision-preview
```

Cost is reported to the daily budget as a placeholder `0.006¢` per
call (same as OpenRouter). If you route to an expensive endpoint
(e.g. OpenAI gpt-4o direct), tighten `OCR_DAILY_BUDGET_USD` to suit
— per-slot cost overrides are out of scope as of v0.2.2.

### Chaining providers

If you configure more than one slot, set `OCR_PROVIDER_CHAIN` to
control fallback order. Format is comma-separated slot identifiers:

```yaml
# Fastest free-tier first; local as backup; OpenRouter as last resort:
OCR_PROVIDER_CHAIN: ollama-cloud,ollama-local,openrouter

# Privacy first; cloud burst only when local is down:
OCR_PROVIDER_CHAIN: ollama-local,ollama-cloud

# Paid-fallback only:
OCR_PROVIDER_CHAIN: ollama-local,openrouter
```

If you DON'T set `OCR_PROVIDER_CHAIN`, the chain auto-derives from
your configured slots in the default order
`[ollama-local, openrouter, ollama-cloud, openai-compatible]`. This
preserves back-compat — adding `OLLAMA_CLOUD_API_KEY` to an existing
deploy tacks cloud on at the END of the chain unless you override.

**Boot-time warnings.** If `OCR_PROVIDER_CHAIN` lists a slot whose
env vars aren't set, the server logs a startup WARN naming the
missing var and drops that slot from the effective chain. Booting
continues normally — fix the env, restart. (Default-chain slots that
aren't configured are silent-skipped.)

### Ollama Cloud model selection

Ollama Cloud serves many vision-capable models, but only a few are
actually useful for fuel-pump OCR. Speed and digit-precision matter
most. Numbers below are from real pump-display probes against a
free-tier account (truth: cost=46.84, volume=12.561 gal,
ppu=3.729 computed).

| Model                       | Latency | OCR result   | Notes                                                                                                       |
|-----------------------------|---------|--------------|-------------------------------------------------------------------------------------------------------------|
| `gemma4:31b` **(default)**  | ~1 s    | Perfect      | Reads all 3 decimals + computed price-per-unit. Best free-tier choice.                                       |
| `qwen3-vl:235b-instruct`    | ~4 s    | Perfect      | Largest free-tier model. Slower; consumes free-tier weekly budget faster, but returns cleaner JSON.         |
| `gemma3:27b`                | ~2 s    | Truncates    | Loses the 3rd decimal of volume (12.561 → 12.56). Don't use for pump OCR.                                   |
| `gemma3:12b` / `gemma3:4b`  | 1–2 s   | Bad PPU      | Smaller, faster, but hallucinates price-per-unit when not shown on display. Avoid.                          |
| `ministral-3:3b/8b/14b`     | 2–4 s   | Mixed        | 14b reads correctly but appends prose after the JSON; smaller variants misread digits. Avoid.               |
| `devstral-small-2:24b`      | —       | Disabled     | Vision capability shown but cloud-side disables image input. HTTP 400.                                      |
| `gemini-3-flash-preview`    | —       | Pro-only     | Requires a paid Ollama Cloud subscription (HTTP 403 on free tier).                                          |
| `qwen3.5:397b`, `kimi-k2.*` | —       | Pro-only     | Same — Pro subscription required.                                                                           |

**Avoid "thinking-mode" models for OCR.** `qwen3-vl:235b`
(non-instruct) burns 60+ s of internal reasoning before producing
JSON, defeating the cloud latency win. Use the `-instruct` variant.

**Override the default:** set `OLLAMA_CLOUD_MODEL=<model-name>` in
your `.env`. Default is `gemma4:31b`.

**Free-tier quotas.** Free tier has a weekly GPU-time budget. When
exhausted, calls return HTTP 429; the chain automatically falls
through to the next configured slot (e.g. OpenRouter or local
ollama). No proactive cooldown — the next OCR call retries cloud as
if nothing happened, which is correct behaviour the first time the
quota window resets.

Full env-var reference:
[`docs/user/configuration.md`](configuration.md#photo-ocr-v020).

## Using it

### Pump mode

1. Open the form (`/`).
2. Tap **Pump display photo** (the left pill in the capture row, just
   below the vehicle picker).
3. iPhone shows its chooser sheet. Pick **Take Photo or Video** to use
   the camera, or **Photo Library** to pick a photo you already took.
   On Android the standard picker covers both paths in one screen.
4. After you pick or shoot the photo, the **preview screen** takes
   over. You can:
   - **Rotate** the image (`[↺]` / `[↻]`) to fix orientation.
   - **Crop** the image — tap `[Crop]`, drag the corners or edges to
     box in the pump display (or just the digits), tap `[Done]`. A
     small **Cropped** chip appears in the header. Tap `[Crop]` again
     to refine; tap `[Reset]` then `[Done]` inside crop mode to
     remove the crop.
   - **Retake** to pick another photo, or **Cancel** to bail out
     without sending.

   When the framing looks right, tap **Send for OCR**.
5. ~2–15 s later a blue chip appears in the feedback zone showing
   the detected values: *Detected: 11.2 gal · $42.18 · $3.78/gal*
6. Tap **Use** → Volume + Cost (+ unit) populate. **Discard**
   dismisses without changing anything.

### Odometer mode

1. Tap **Odometer photo** (the right pill in the capture row).
2. Pick or shoot one of:
   - your dashboard odometer, **or**
   - a screenshot of a phone app showing the mileage (Carfax,
     FuelEconomy.gov, your car's companion app — anything that displays
     the number).
3. The **preview screen** opens. Rotate or retake if the image isn't
   right; tap **Send for OCR** when it is.
4. A blue chip appears in the feedback zone under the capture row:
   *Detected: 87,612 mi*. Tap **Use** to populate.
5. If the detected reading is **lower than your last fillup** or
   **more than 2,000 mi above it**, the chip turns amber and shows
   `[Use anyway]` and `[Dismiss]`. Both are valid: tap `Use anyway`
   if you know the reading is right (cluster swap, long road trip,
   rollover); tap `Dismiss` to type a corrected value yourself.

### Why crop?

Two reasons it's worth a tap:

1. **Faster, cheaper OCR.** Vision models charge by image tile.
   A tight crop around the pump display cuts the bill on cloud
   providers and runs faster on local ollama.
2. **Better OCR.** Glare, the neighbouring pump, dash lights — all
   are real OCR confusion fuel. Cropping focuses the model on the
   digits you care about.

You don't *need* to crop — the model handles a fair amount of
context. But a 2-second crop on a difficult photo turns 422
"Couldn't read clearly" into a clean confirm chip a lot of the time.

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

## Date prefill from photo (v0.2.0+)

When you pick an older pump photo from your library (the "I forgot to log
last week's fillup" case), quicklogger reads the photo's embedded date and
auto-fills the Date field for you.

You'll see one of two small chips just under the Date field:

- **blue `set from photo`** — the photo carried an embedded date and it
  wasn't today's date — the Date field updated to match. Tap the field to
  override if you want.
- **amber `no date in photo`** — the photo didn't carry a usable date
  (screenshots, edited exports, and some social-media downloads strip the
  EXIF block). The Date field stays on today. Type the correct date in.

**Fresh camera captures don't trigger a chip.** If you take a pump photo
right at the pump, the photo's date is today, the form's date is today, and
there's nothing useful to say. The chip only appears when the photo is
either older than today or has no date at all.

The prefill only runs for the **pump photo** input, not the odometer photo
— odometer captures are almost always taken at the pump anyway.

If you don't like the prefilled date, just edit the Date field. The chip
disappears the moment you change the value.

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
- **The preview is local — works offline.** You can pick the photo,
  rotate it, and decide whether to send even when offline. Tapping
  `Send for OCR` is the only thing that needs network. If the network
  is down at that moment, the same 90 s timeout fires and you fall
  back to typing.
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
| *Photo too large — try again* | 413 — file exceeds `OCR_MAX_IMAGE_MB` (default 5 MiB) | Should be rare; the in-browser resize keeps photos well under this. Re-take and try again |
