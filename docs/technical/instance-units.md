# Instance units (volume + distance)

## Overview

LubeLogger stores fuel volume and distance as bare numbers; the _instance
settings_ give them meaning. quicklogger therefore carries two explicit config
vars — `LUBELOGGER_VOLUME_UNIT` (`gallons_us` | `liters`) and
`LUBELOGGER_DISTANCE_UNIT` (`miles` | `km`) — validated at startup, and
converts every submission into the instance volume unit before writing
upstream. Units cannot be auto-detected: LubeLogger `/api/info` (v1.7.0)
exposes no unit fields. Fixes #69 (fill-ups 500ing on metric instances).

## Files touched

- `src/lib/shared/units.ts` — `LubeLoggerVolumeUnit`, `LubeLoggerDistanceUnit`,
  `DistanceUnit` types (conversion math `toGallons`/`toLiters` pre-existing).
- `src/lib/server/env.ts` — `parseVolumeUnit()` / `parseDistanceUnit()`,
  `EnvError` on unknown values, empty string → default.
- `src/lib/server/convert.ts` — liters target; result is
  `{ volume, volumeUnit }` (renamed from `gallons` — the field now carries
  either unit; keeping the old name would lie to every reader).
- `src/routes/api/fuelup/+server.ts` — instance-unit payload, replay-dedupe
  match key, response `submitted.volume`/`submitted.volumeUnit`, photo
  filename suffix (`mi`/`km`).

## Data model

`ConvertResult.volume` is denominated in `ConvertResult.volumeUnit`
(`'gal' | 'L'`), which is derived from the env target. The fuelup response
mirrors this (`submitted.volume` + `submitted.volumeUnit`) — a breaking wire
rename from `submitted.gallons`, accepted because client and server ship
together; a stale open tab shows one odd toast until reload. The service
worker replay loop reads only `submitted.cost`/`submitted.currency`, so it is
unaffected.

## Lifecycle / control flow

Submit → `convertSubmission()` converts entered volume into the instance unit
and cost into the instance currency → payload `fuelconsumed` is the converted
number (3 dp) → response echoes the converted snapshot. Replay dedupe
(`queueReplay`) compares `date + odometer + fuelConsumed` where the
fuelConsumed side is the instance-unit conversion — upstream records are
already in instance units, so the comparison is unit-consistent by
construction.

## Edge cases & invariants

- Bad env value → `EnvError` at startup, not a per-submit 500 (the pre-fix
  failure mode). Downstream code trusts the validated union types; there are
  no scattered runtime unit checks.
- Pre-fix submissions on a liters instance never reached LubeLogger (they
  500'd), so no wrongly-converted upstream data exists; dead-lettered queue
  entries submit correctly after upgrade.
- Odometer values are never converted — they arrive in instance units; only
  labels (and the photo filename suffix) follow `LUBELOGGER_DISTANCE_UNIT`.

## Non-obvious decisions

- Units are explicit config, not auto-detected (verified against live
  `/api/info` — no unit fields).
- Two independent vars, not one "metric" flag: UK instances mix liters with
  miles.
- No settings-UI override: the server owns the conversion target; a client
  toggle would split-brain it.
