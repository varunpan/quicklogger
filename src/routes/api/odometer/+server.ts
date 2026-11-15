import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { lubeloggerFromEnv } from '$lib/server/lubeloggerProxy';
import {
  LubeLoggerError,
  type LubeLoggerClient,
  type Equipment,
  type OdometerRecord
} from '$lib/server/lubelogger';
import { contentLengthExceeds } from '$lib/server/contentLength';
import { IdempotencyWindow, jsonResponse, type SubmitResult } from '$lib/server/idempotency';
import type { Logger } from '$lib/server/logger';
import type { OdometerSubmissionInput } from '$lib/shared/types';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// A real submission is a few hundred bytes; see $lib/server/contentLength.ts
// for why every POST route pre-checks the advertised length.
const MAX_BODY_BYTES = 16 * 1024;

// Same 60-second clientSubmissionId guard as /api/fuelup: a SW replay that
// arrives while the original POST is still writing upstream shares its result
// instead of passing the dedupe check (the record isn't there yet) and
// writing the reading twice.
const idempotency = new IdempotencyWindow(60_000);

export function _resetForTests() {
  idempotency.clear();
}

/** Validate an odometer-only submission. Returns an error message, or null. */
export function _validate(input: Partial<OdometerSubmissionInput>): string | null {
  if (!Number.isInteger(input.vehicleId) || (input.vehicleId as number) <= 0)
    return 'invalid vehicleId';
  if (typeof input.date !== 'string' || !ISO_DATE.test(input.date)) return 'invalid date';
  if (!Number.isInteger(input.odometer) || (input.odometer as number) < 0)
    return 'odometer must be a whole number';
  if (input.notes !== undefined && typeof input.notes !== 'string') return 'invalid notes';
  if (input.equipmentIds !== undefined) {
    if (!Array.isArray(input.equipmentIds)) return 'invalid equipmentIds';
    if (input.equipmentIds.some((id) => !Number.isInteger(id) || id <= 0))
      return 'invalid equipmentIds';
  }
  if (input.setEquipped !== undefined) {
    const se = input.setEquipped as { equipmentId?: unknown; equipped?: unknown } | null;
    if (
      !se ||
      typeof se !== 'object' ||
      !Number.isInteger(se.equipmentId) ||
      (se.equipmentId as number) <= 0 ||
      typeof se.equipped !== 'boolean'
    )
      return 'invalid setEquipped';
  }
  // Same rule as /api/fuelup: an empty key would collide unrelated submits.
  if (typeof input.clientSubmissionId !== 'string' || input.clientSubmissionId.trim() === '')
    return 'invalid clientSubmissionId';
  return null;
}

/**
 * Odometer of the latest existing record at or before this reading in
 * LubeLogger's own order (date, then odometer — the order its "recalculate"
 * uses), or the reading itself when there is none (LubeLogger's convention for
 * a first record). Never above the reading, so a bad earlier record can't
 * credit equipment a negative distance.
 *
 * A record with the SAME date and odometer counts as before, so the new one is
 * a zero-length trip — where recalculate's stable sort would put it. That
 * trip is already covered by the existing record: a reading logged twice
 * (e.g. once without the trailer, then again with it ticked) must not credit
 * the trailer the miles before it, and a fill-up's auto-inserted record that
 * carried the equipped trailer must not be credited twice. (Found in live
 * testing: an earlier per-item rule credited the trailer the truck's solo
 * miles on a re-logged reading.)
 */
export function _initialOdometerFor(
  records: OdometerRecord[],
  date: string,
  odometer: number
): number {
  let prev: OdometerRecord | null = null;
  for (const r of records) {
    const before = r.date < date || (r.date === date && r.odometer <= odometer);
    if (!before) continue;
    if (!prev || r.date > prev.date || (r.date === prev.date && r.odometer > prev.odometer))
      prev = r;
  }
  return prev ? Math.min(prev.odometer, odometer) : odometer;
}

/**
 * Replay dedupe: is everything this reading would add already upstream?
 * True when a record at the same date + odometer carries the same notes (the
 * reading itself, or a fill-up record LubeLogger auto-inserted with those
 * notes) AND the records at that reading together carry every required item.
 * Never mistakes a same-reading record without the trailer for this one.
 * `requiredIds` is the explicitly ticked set; for an `includeEquipped` reading
 * the equipped extras were resolved at write time and may have changed since.
 */
export function _findReplayMatch(
  records: OdometerRecord[],
  want: { date: string; odometer: number; requiredIds: number[]; notes: string }
): OdometerRecord | undefined {
  const ties = records.filter((r) => r.date === want.date && r.odometer === want.odometer);
  const covered = new Set(ties.flatMap((r) => r.equipmentIds));
  if (!want.requiredIds.every((id) => covered.has(id))) return undefined;
  return ties.find((r) => r.notes.trim() === want.notes);
}

/** Equip / Unequip's second half: set the item's Equipped flag. Returns the
 *  updated item for the response, or nothing for a plain reading. */
async function applyEquipped(
  input: OdometerSubmissionInput,
  client: LubeLoggerClient
): Promise<{ equipment?: Equipment }> {
  if (!input.setEquipped) return {};
  const equipment = await client.setEquipmentEquipped(
    input.vehicleId,
    input.setEquipped.equipmentId,
    input.setEquipped.equipped
  );
  return { equipment };
}

async function submitToLubeLogger(
  input: OdometerSubmissionInput,
  logger: Logger
): Promise<SubmitResult> {
  const ok = (body: unknown): SubmitResult => ({ status: 200, body: JSON.stringify(body) });
  const fail = (status: number, error: string): SubmitResult => ({
    status,
    body: JSON.stringify({ error })
  });

  try {
    const { client } = lubeloggerFromEnv(logger);

    // Read what's upstream before writing: the records give the trip start
    // (and the replay match); the equipment list resolves "include whatever
    // is equipped" for a reading queued before the page ever saw the list.
    // Never write on uncertainty — 503 keeps a queued entry 'queued'.
    let records: OdometerRecord[];
    let equipped: number[] = [];
    try {
      records = await client.listOdometerRecords(input.vehicleId);
      if (input.includeEquipped === true) {
        equipped = (await client.listEquipment(input.vehicleId))
          .filter((e) => e.isEquipped)
          .map((e) => e.id);
      }
    } catch (err) {
      // A 4xx (revoked key, no access to the vehicle) will never succeed on a
      // retry: pass it through so the page shows "Submission rejected" and a
      // queued entry fails at once instead of burning its 5 attempts. Only a
      // 5xx / network failure is uncertain enough for 503 ("retry later").
      if (err instanceof LubeLoggerError && err.status >= 400 && err.status < 500) {
        return fail(err.status, 'Could not add odometer record to LubeLogger');
      }
      logger.warn('odometer pre-check failed', { err });
      return fail(503, 'could not read odometer records from LubeLogger — retry later');
    }

    const equipmentIds = [...new Set([...(input.equipmentIds ?? []), ...equipped])];
    const notes = input.notes?.trim() ?? '';

    // Replay dedupe — same contract as /api/fuelup (offline-queue.md
    // § Replay dedupe): a replayed entry may re-send a POST that already
    // landed (SW killed before markSynced, or the foreground response lost).
    if (input.queueReplay === true) {
      const match = _findReplayMatch(records, {
        date: input.date,
        odometer: input.odometer,
        requiredIds: input.includeEquipped === true ? (input.equipmentIds ?? []) : equipmentIds,
        notes
      });
      if (match) {
        logger.info('odometer replay dedupe: record already upstream, skipping write', {
          vehicleId: input.vehicleId,
          recordId: match.id,
          clientSubmissionId: input.clientSubmissionId
        });
        // The reading landed earlier; an Equip / Unequip may still owe its
        // flag change (it failed after the write, or the SW died in between).
        const equipment = await applyEquipped(input, client);
        return ok({ ok: true, recordId: match.id, deduped: true, ...equipment });
      }
    }

    const { recordId } = await client.addOdometerRecord(input.vehicleId, {
      date: input.date,
      initialOdometer: _initialOdometerFor(records, input.date, input.odometer),
      odometer: input.odometer,
      notes: notes || undefined,
      equipmentIds
    });
    // Equip / Unequip: the reading is in; now the flag. A failure here maps
    // like any upstream error (5xx → 502 keeps a queued row queued), and the
    // replay's dedupe then skips the reading and retries just the flag.
    const equipment = await applyEquipped(input, client);
    return ok({ ok: true, recordId: recordId ?? null, ...equipment });
  } catch (err) {
    if (err instanceof LubeLoggerError) {
      // Detail is logged at the throw site; 4xx passthrough / 5xx → 502 is
      // what the SW replay keys its 'failed' vs 'queued' decision on.
      return fail(
        err.status >= 500 ? 502 : err.status,
        'Could not add odometer record to LubeLogger'
      );
    }
    logger.error('odometer submit failed', { err });
    return fail(500, 'unexpected server error');
  }
}

export const POST: RequestHandler = async ({ request, locals }) => {
  if (contentLengthExceeds(request.headers.get('content-length'), MAX_BODY_BYTES)) {
    return json({ error: `request body must be <= ${MAX_BODY_BYTES} bytes` }, { status: 413 });
  }

  let input: Partial<OdometerSubmissionInput>;
  try {
    input = (await request.json()) as Partial<OdometerSubmissionInput>;
  } catch {
    return json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const problem = _validate(input ?? {});
  if (problem) return json({ error: problem }, { status: 400 });
  const valid = input as OdometerSubmissionInput;

  return jsonResponse(
    await idempotency.run(valid.clientSubmissionId, () => submitToLubeLogger(valid, locals.logger))
  );
};
