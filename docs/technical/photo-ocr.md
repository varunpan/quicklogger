# Photo OCR — internals

## Overview

Pump-display and odometer reading via vision LLM. User taps a camera
chip on the main form, photographs the pump or odometer, and the
relevant fields are pre-filled via a confirm chip with `[Use]` /
`[Discard]` actions. Opt-in: at least one provider (`OLLAMA_VISION_URL`
or `OPENROUTER_API_KEY`) must be configured; otherwise the chips stay
hidden. User guide:
[`docs/user/photo-ocr.md`](../user/photo-ocr.md). Where it sits in the
bigger picture: see the `/` page section in
[`docs/architecture.md`](../architecture.md#---main-form).

## Files

### Server

- [`src/lib/server/env.ts`](../../src/lib/server/env.ts) — adds 17 OCR
  env vars, all optional with defaults. Feature activates iff
  `OLLAMA_VISION_URL` or `OPENROUTER_API_KEY` is non-empty.
- [`src/lib/server/ocr.ts`](../../src/lib/server/ocr.ts) —
  `sniffImageType` (magic-byte JPEG/PNG/WebP/HEIC),
  `selectProvider(env)`, and `runOcrPipeline(input)`. The dispatcher
  switches on mode by `MODES[mode]` lookup; no `if/else` chains.
- [`src/lib/server/ocrModes.ts`](../../src/lib/server/ocrModes.ts) —
  the `MODES` map. Each entry exposes `prompt`, `schema`,
  `validateSchema`, `validateRanges`, and (pump only)
  `validateCrossField`. Adding a mode = one map entry.
- [`src/lib/server/ocrProviders.ts`](../../src/lib/server/ocrProviders.ts)
  — `OllamaOcrProvider`, `OpenRouterOcrProvider`, `ChainOcrProvider`,
  `OcrProviderError`. Provider interface is
  `extract(bytes, prompt, schema) → unknown` — providers don't know
  about modes.
- [`src/lib/server/ocrRateLimit.ts`](../../src/lib/server/ocrRateLimit.ts)
  — in-memory sliding 1-hour window, keyed per IP. Single-replica only.
- [`src/lib/server/ocrBudget.ts`](../../src/lib/server/ocrBudget.ts) —
  daily $ cap, persisted at `/data/ocr-budget.json`. UTC rollover.
- [`src/lib/server/ocrAudit.ts`](../../src/lib/server/ocrAudit.ts) —
  append-only JSONL at `/data/ocr-audit.jsonl`, 10 MiB truncate-rotate.
  `resolveAuditHmacKey` resolves the HMAC key (env override →
  `/data/ocr-audit-key.txt` → auto-generate-and-persist with 0600
  perms).
- [`src/routes/api/ocr/+server.ts`](../../src/routes/api/ocr/+server.ts)
  — POST + GET handlers. Module-level singletons for rate limiter,
  budget, audit, hmac key — bootstrapped lazily on first request.

### Client

- [`src/lib/client/api.ts`](../../src/lib/client/api.ts) —
  `getOcrStatus()` (probe; treats any non-2xx as disabled) and
  `postOcr(image, mode)` (multipart POST with 90 s
  `AbortSignal.timeout`).
- [`src/lib/client/image.ts`](../../src/lib/client/image.ts) —
  `resizeForOcr(file, opts?)`. Long edge clamped to 1024 px, JPEG
  q=0.8, EXIF stripped by Canvas re-encode. Prefers
  `createImageBitmap({ imageOrientation: 'from-image' })` +
  `OffscreenCanvas`; falls back to `HTMLImageElement` +
  `HTMLCanvasElement` on older Safari (where EXIF orientation may not
  be honored — ~2% of iOS users, accepted). Optional
  `opts.rotation: 0 | 90 | 180 | 270` is applied as a single
  translate+rotate transform inside the same canvas pass (no double
  re-encode). Used by the preview screen.
- [`src/routes/+page.ts`](../../src/routes/+page.ts) — probes
  `GET /api/ocr` and surfaces `ocrEnabled` + `ocrModes` to the page.
  Failure to probe = `enabled: false`; page load never blocks on OCR.
- [`src/routes/+page.svelte`](../../src/routes/+page.svelte) — top
  capture row (Pump display photo / Odometer photo pills), OCR feedback
  zone (pump chip, odometer chip, odometer warning chip — all stacked
  full-form-width below the capture row), and the relative-range check
  (`checkOdometerRelative` against `data.lastFuelup`). Inline photo
  triggers from the original v0.2.0 layout were removed — the trigger
  no longer needs to sit next to the field it fills, since the labels
  ("Pump display photo", "Odometer photo") are self-describing.

## Data model

### Discriminated `OcrResult` (`src/lib/shared/types.ts`)

```ts
type OcrMode = 'pump' | 'odometer';

interface OcrPumpResult {
  mode: 'pump';
  volume: number;
  volumeUnit: 'gal' | 'L';
  cost: number;
  pricePerUnit: number;
}

interface OcrOdometerResult {
  mode: 'odometer';
  odometer: number;
}

type OcrResult = OcrPumpResult | OcrOdometerResult;
```

Client narrowing is clean: `if (result.mode === 'pump') { ... }`. The
audit log persists the same shape under `parsed`, plus a top-level
`mode` field for fast filtering with `jq`.

### Persistence under `/data`

| File | Shape | Notes |
|---|---|---|
| `ocr-budget.json` | `{ date: 'YYYY-MM-DD', calls, costCents }` | UTC date; replaced (not appended) on each `add()`. |
| `ocr-audit.jsonl` | one JSON object per line | Append-only. Truncated to 0 bytes when next append would cross 10 MiB. Old entries discarded, not archived. |
| `ocr-audit-key.txt` | 32 random bytes, 0600 | Auto-generated if `OCR_AUDIT_HMAC_KEY` is unset and the file is absent. Persists across container restarts. |

## Lifecycle

### Request path (success)

1. Browser opens the OS chooser via `<input type="file" accept="image/*">`
   (no `capture` attribute — iOS users get the native sheet with both
   *Take Photo* and *Photo Library* options).
2. `resizeForOcr(file)` runs in a hidden Canvas — 1024 px long edge,
   JPEG q=0.8, EXIF stripped. Output is ~150–300 KB.
3. `postOcr(blob, mode)` POSTs `multipart/form-data` with 90 s client
   `AbortSignal.timeout`.
4. Server: rate-limit check (in-memory sliding window, per-IP) →
   budget check (`/data/ocr-budget.json`) → multipart parse → mode
   whitelist → image size + magic-byte sniff.
5. `runOcrPipeline` looks up `MODES[mode]` → calls `provider.extract`
   with the contract's prompt + schema → validates schema → range
   check → cross-field check (pump only) → returns
   `{ ok: true, result, ... }`.
6. Route handler increments budget, appends audit row, returns the
   discriminated `OcrResult`.
7. Client: chip renders in the OCR feedback zone immediately under the
   capture row (full form width, not next to the field). Pump goes
   straight to the blue confirm chip. Odometer runs
   `checkOdometerRelative` against `data.lastFuelup` first; ok → blue
   confirm chip, warning → amber chip with `[Use anyway]` + `[Dismiss]`
   (warnings are advisory in v0.2.0+ — see Edge cases below).
8. User taps `[Use]` → form fields populate; chip dismisses.

### Provider selection (per-request)

```text
ollamaUrl set, openrouterKey set   → ChainOcrProvider([ollama, openrouter])
ollamaUrl set, openrouterKey unset → OllamaOcrProvider
ollamaUrl unset, openrouterKey set → OpenRouterOcrProvider
both unset                          → null → /api/ocr returns 503
```

Selection runs **per request**, not cached at startup. A transient
ollama outage doesn't permanently disable the feature; the next
request re-selects.

### Audit row shape

```ts
{
  ts: string,                                 // ISO 8601
  mode: 'pump' | 'odometer',
  ipHash: 'sha256:<16-hex>',                  // HMAC-SHA-256 (key, ip), 64 bits
  imgHash: 'sha256:<64-hex>',                 // SHA-256 of post-resize bytes
  imgBytes: number,                           // post-resize size
  imageType: 'jpeg' | 'png' | 'webp' | 'heic',
  provider: 'ollama' | 'openrouter',
  model: string,                              // resolved tag
  fellbackTo: 'ollama' | 'openrouter' | null,
  latencyMs: number,                          // receipt → response sent
  costCents: number,                          // 0 for ollama
  ok: boolean,
  parsed: OcrResult | null,                   // discriminated by mode
  error?: { code: string, message: string }
}
```

Privacy properties:

- No raw IPs on disk — only the HMAC hash.
- No raw image bytes on disk — only the SHA-256.
- `parsed` contains only numeric fields the model was prompted to
  extract.
- Truncation is destructive — when the next append would cross 10 MiB,
  the file is truncated to 0 bytes. Old entries are not archived.

## Edge cases & invariants

| Scenario | Behaviour | Why |
|---|---|---|
| No providers configured | `GET /api/ocr` → `{ enabled: false }`; UI hides chips | Feature opt-in; nothing rendered when nothing configured |
| Ollama transient outage with both configured | Chain falls through to OpenRouter; `lastFellbackTo='ollama'` audited | Bounded single-fallback — not a retry loop |
| `mode=receipt` POST in v0.2.0 | 501 Not Implemented; `modes` array does NOT advertise it | Wire-accepted (forward-compat), but listing would imply usability |
| Pump cross-field drift > 5% | 422 + range-style toast; chip never shown | Adversarial-image / OCR-confusion guard |
| Odometer detected < last fillup | Amber advisory chip, `[Use anyway]` writes field | Odometers don't run backwards, but legitimate cases exist (replaced cluster, odometer rollover at high mileage); user owns the call |
| Odometer jumped > 2000 mi | Amber advisory chip, `[Use anyway]` writes field | Hardcoded `ODOMETER_MAX_DELTA_MI`; long road trips are real; user owns the call. Promotable to Settings if real travel routinely hits this |
| First fillup for vehicle (no `data.lastFuelup`) | Relative check skipped — value flows to confirm chip | Nothing to compare against |
| Network drops mid-OCR | After 90 s client timeout: "OCR took too long" toast | `AbortSignal.timeout` fires; no IDB queue (intentional — see SW doc) |
| Cold page load while offline | Loader probe fails → `enabled: false` → chips hidden | Loader catches all GET errors; failure-as-disabled is intentional |
| `OCR_AUDIT_HMAC_KEY` unset, no key file | Generate 32 random bytes, write `0600`, persist | Stable across restarts via the `/data` bind mount |
| Rollback to v0.1.x with v0.2.0 data files present | `/data/ocr-*` files become orphans; harmless | Not referenced by anything in v0.1.x |

## Non-obvious decisions

**Provider interface takes `(bytes, prompt, schema)`, not `(bytes, mode)`.**
Providers know nothing about modes. The mode-specific logic — prompt,
schema, validators — lives entirely in `ocrModes.ts`. Adding `receipt`
in v0.2.1 is a single `MODES` map entry; provider code doesn't change.

**`MODES` is a discriminated map, not a class hierarchy.** Each entry
returns a `ValidationResult<T>` with the discriminator (`mode: 'pump'`
or `mode: 'odometer'`) attached. The dispatcher narrows on the
discriminator via TypeScript's exhaustiveness machinery — adding a
mode without updating call sites becomes a type error.

**Cross-field check on pump only.** `cost ≈ volume × pricePerUnit`
within 5%. Currency- and unit-agnostic — the relationship holds
whether the pump reads in gal+USD or L+EUR. Real-world pump rounding
sits well inside 5%; values that fail this check are almost always
genuine OCR confusion (e.g., `volume=11.2`, `pricePerUnit=3.78`,
`cost=100` → ~58% drift).

**Odometer *relative* range lives client-side; *absolute* range lives
server-side.** The server has no access to per-vehicle fillup history.
Relative-range hits are **advisory** (amber chip with `[Use anyway]`):
the user owns the override gesture, since legitimate cases exist
(replaced cluster, long road trip, odometer rollover). The absolute
bound (`OCR_ODOMETER_MAX_MI=1,000,000`) catches adversarial-image /
OCR confusion outright at the server boundary — that one stays
blocking (422), since no legitimate fillup reads a million-mile delta.

**`ODOMETER_MAX_DELTA_MI = 2000` is hardcoded in client code, not env.**
The bound is a UX safety net, not a security gate, and the value is
meaningful to the user (visible in the warning copy). Promotable to a
Settings preference (alongside `odometerIncrementMi`) in a future v0.2.x
if real-world travel routinely hits 2000+ mi between fillups.

**90 s client `AbortSignal.timeout` — generous, not stingy.** Ollama
CPU inference on `qwen2.5vl:7b` can take 15–30 s on a Mac mini; an over-
loaded host pushes that higher. 90 s gives a working setup plenty of
headroom while still failing-fast on a wedged connection. Pairs with
the 60 s server-side ollama timeout — server fails first under normal
load, client takes over only on broken network.

**No image queue-for-replay in the service worker.** Images are
~300 KB → IDB bloats fast. By the time network returns, the user has
typically typed values manually; an OCR result arriving minutes later
out-of-context is worse UX than no OCR at all. Existing `/api/fuelup`
queueing is unaffected — image POSTs go straight to the network with no
SW involvement (POST is already excluded by the SW's `req.method !==
'GET'` guard).

**HMAC key auto-generated to `/data/ocr-audit-key.txt`, not derived from
`LUBELOGGER_API_KEY`.** Original plan derived it; new plan generates and
persists a dedicated 32-byte secret. Reason: rotating `LUBELOGGER_API_KEY`
would silently break audit hash continuity. Dedicated key is rotated only
when the operator explicitly removes the file.

**Audit rotation is destructive, not archival.** When the next append
would cross 10 MiB, the file is truncated to 0 bytes — old entries are
discarded, not shipped elsewhere. Acceptable for a homelab single-user
tool. If the volume of OCR calls ever justified retention, this is the
extension point.

**`receipt` is wire-accepted (parser doesn't reject) but returns 501
in v0.2.0.** Lets v0.2.1 ship by adding a `MODES.receipt` entry without
a wire-format change — clients written against the v0.2.0 contract that
happen to send `mode=receipt` get a clear 501, not a 400.

**No `OcrError` type in `$lib/shared/types`.** The client `postOcr` adds
an `OcrError` interface only on the client side (it carries DOM-only
data like `retryAfter` from a header). Keeps `shared/types.ts` free of
client-only ergonomics.

**Rotation lives in the same canvas pass as resize, not a second pass.**
The preview screen rotates visually via CSS `transform: rotate(deg)` on
an `<img>` while the user is fiddling — cheap, instant, no re-encode.
On `[Send for OCR]`, the cumulative rotation is handed to
`resizeForOcr({ rotation })` so EXIF-orient → rotate → resize → JPEG
encode all happen in one canvas pass. One pixel-encoding event total,
not two — keeps the existing performance profile.

## Future considerations

- **Receipt mode (v0.2.1).** Required: `volume`, `cost`. Nice-to-have:
  `date`, `station`, `fuelGrade`. Local ollama accuracy on receipts is
  lower than cloud — README disclosure planned; operator can opt out of
  ollama for receipt mode via a config switch (TBD design in v0.2.1).
- **Per-vehicle odometer delta.** `ODOMETER_MAX_DELTA_MI=2000` is one
  size fits all. Long-trip commuters may want 5000; daily-commuter
  vehicles may want 500. Promotable alongside existing per-vehicle
  preferences.
- **Per-user OCR settings on Settings page.** Currently env-only.
- **Multi-replica / forward-auth.** The in-memory rate limiter is
  single-replica only. If quicklogger ever scales to >1 replica or
  moves behind Authentik forward-auth, swap the IP key for an
  authenticated-user key and move the bucket to `/data`.
- **Image queue-for-replay.** Rejected for v0.2.0 (see above) but
  re-evaluatable if real-world UAT shows the offline window meaningfully
  hurts.
