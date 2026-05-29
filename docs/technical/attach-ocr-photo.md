# Attach OCR photo to the record — internals

## Overview

When a user sends a pump and/or odometer photo to OCR during a session, quicklogger retains the
exact resized JPEG bytes it sent to `/api/ocr` and, by default, attaches them to the LubeLogger gas
record created on submit. A single checkbox (default on) appears once ≥1 OCR send has happened this
session and offers a one-tap, per-submit opt-out. Attach is **online-only** — an offline submit
queues the text-only fuelup and drops the bytes, telling the user. Introduced in v0.2.6 as an
adjacent feature on the existing OCR capture trigger (see `docs/technical/photo-ocr.md`).

## Files touched

- `src/routes/+page.svelte` — retained-blob slots (`attachPumpBlob`, `attachOdometerBlob`), the
  `attachPhotos` toggle, the conditional checkbox, the submit branch, and the warning/offline toasts.
- `src/lib/client/api.ts` — `submitFuelupWithPhotos()` builds the multipart body (scalars + image parts).
- `src/routes/api/fuelup/+server.ts` — parses `pumpImage`/`odometerImage` parts, orchestrates
  upload→add, applies the record-first degradation, returns `photoWarning`.
- `src/lib/server/lubelogger.ts` — `uploadDocument()`, the `addGasRecord(files?)` JSON variant, and
  the `UploadedFile` type.
- `src/lib/shared/types.ts` — `photoWarning?` on `FuelSubmissionResult`.

## Data model

- **Client (memory only):** two `Blob | null` slots and one `boolean`. Nothing is persisted — no new
  IndexedDB store/index/version, no `localStorage` key, no service-worker cache entry. The slots hold
  the same `Blob` returned by `resizeForOcr` that was POSTed to `/api/ocr`.
- **Wire (client → `/api/fuelup`):** `multipart/form-data` — the existing scalar fields plus optional
  `pumpImage` / `odometerImage` file parts. JSON / urlencoded submits carry no images.
- **Upstream:** `POST /api/documents/upload` (multipart field `documents`) → `UploadedFile`
  (`{ name, location, isPending }`); `POST /api/vehicle/gasrecords/add` JSON variant with a nested
  `files: UploadedFile[]` array. `location` is a server-assigned GUID path; `name` is display-only.
- **Filenames:** `pump-<odometer>mi.jpg` / `odometer-<odometer>mi.jpg`, odometer taken from the
  validated form value (always finite `> 0`).

## Lifecycle / control flow

1. User taps a capture pill → `openPumpCamera` / `openOdoCamera` clears that mode's retained blob.
2. User picks a photo → `OcrPreview` → "Send for OCR" → `runOcr` resizes to a `Blob` and **retains it
   in the mode's slot before the OCR call** (so a misread still attaches).
3. The checkbox renders iff `attachPumpBlob || attachOdometerBlob`; label/sublabel reflect which
   photos are present. `attachPhotos` defaults to `true`.
4. On submit, `wantsAttach = attachPhotos && (≥1 blob)`:
   - `wantsAttach` → `submitFuelupWithPhotos` (multipart).
   - else → `submitFuelup` (JSON) — unchanged path.
5. Server (multipart, ≥1 image): for each present part, gate (size ≤ `OCR_MAX_IMAGE_MB`,
   `sniffImageType` ≠ null) → `uploadDocument` → collect `UploadedFile`. Then
   `addGasRecord(vehicleId, payload, files)` uses the JSON variant. A gate/upload failure skips that
   file and sets `photoWarning`; `addGasRecord` failing throws and surfaces as a normal 4xx/5xx.
6. Success: green toast, or amber "couldn't attach" toast when `photoWarning` is set.
7. Reset clears both blobs and sets `attachPhotos = true`; the checkbox hides until the next OCR send.
8. Offline (network/5xx in submit `catch`): the text-only `input` is enqueued (no bytes in IDB); the
   toast reads "Saved locally — photo not attached." when attach was requested.

## Edge cases & invariants

- **Set on send, not success** — a misread photo is still retained and attachable.
- **Latest send of a mode wins** — re-OCR/retake replaces that slot (cleared in `openPumpCamera` /
  `openOdoCamera`, re-set in `runOcr`).
- **Record-first** — no photo failure (gate, upload, partial) ever fails the fuelup; the record is
  created and `photoWarning` flags the shortfall. Both-fail → record with `files: []` + warning.
- **`addGasRecord` failure after a successful upload** — the record genuinely isn't created → normal
  error surfaced; the uploaded temp file orphans (harmless ~22 KB GUID temp; `/api/cleanup?deepClean=true`
  is the operator sweep). Accepted.
- **No image bytes in IDB** — preserves the deliberate rule in `docs/technical/photo-ocr.md`
  (§ *No image queue-for-replay*). Online-only by design.
- **Visibility is derived from blob presence** — toggling the checkbox on then clearing all blobs
  (retake→cancel) hides it and makes `attachPhotos` irrelevant (no blobs to send).
- **Wire-additive both directions** — an old JSON client hits the no-files branch (unchanged); a new
  multipart client hitting an old server has its image parts ignored (graceful degradation).
- **OCR disabled** — no capture affordance → no blobs → checkbox never shows → feature inert.

## Non-obvious decisions

- **Exact OCR bytes, not the original capture** — we attach the ~200 KB resized JPEG the server
  already saw, not the multi-MB original. Smaller, and it matches what OCR read.
- **JSON add variant only when files exist** — the proven flat-multipart `addGasRecord` path is left
  completely untouched for the common no-photo case; the JSON variant (which binds nested `files`) is
  used only when there's something to attach.
- **Single toggle, all-or-nothing** — one boolean attaches every retained blob; no per-photo control
  (YAGNI). Copy switches singular/plural from blob presence.
- **`photoWarning` is a string, not a code** — the page maps any truthy value to one fixed amber
  toast; the server string is for logs/diagnostics, not parsed by the client.
- **Part-level size/sniff gate on the server** — defensive only (these are OCR-resized JPEGs); guards
  against pushing garbage upstream while still honouring record-first by skipping rather than failing.
