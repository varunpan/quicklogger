import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { lubeloggerFromEnv } from '$lib/server/lubeloggerProxy';
import { LubeLoggerError, type OdometerRecord } from '$lib/server/lubelogger';
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
  // Same rule as /api/fuelup: an empty key would collide unrelated submits.
  if (typeof input.clientSubmissionId !== 'string' || input.clientSubmissionId.trim() === '')
    return 'invalid clientSubmissionId';
  return null;
}

/**
 * Start of the trip this reading closes: the odometer of the latest existing
 * record that sorts before it in LubeLogger's own order (date, then odometer —
 * the order its "recalculate" uses), or the reading itself when there is none
 * (LubeLogger's convention for a first record). Never above the reading, so a
 * bad earlier record can't credit equipment a negative distance.
 */
export function _initialOdometerFor(
  records: OdometerRecord[],
  date: string,
  odometer: number
): number {
  let prev: OdometerRecord | null = null;
  for (const r of records) {
    const before = r.date < date || (r.date === date && r.odometer < odometer);
    if (!before) continue;
    if (!prev || r.date > prev.date || (r.date === prev.date && r.odometer > prev.odometer))
      prev = r;
  }
  return prev ? Math.min(prev.odometer, odometer) : odometer;
}

/**
 * Replay dedupe match. Every field we write must agree — date, odometer,
 * equipment set and notes — so a different real reading at the same date and
 * odometer (e.g. the record LubeLogger auto-inserts for a fill-up, which
 * carries only "equipped" equipment) is never mistaken for this one.
 */
export function _findReplayMatch(
  records: OdometerRecord[],
  want: { date: string; odometer: number; equipmentIds: number[]; notes: string }
): OdometerRecord | undefined {
  const key = (ids: number[]) => [...new Set(ids)].sort((a, b) => a - b).join(' ');
  const wantIds = key(want.equipmentIds);
  return records.find(
    (r) =>
      r.date === want.date &&
      r.odometer === want.odometer &&
      key(r.equipmentIds) === wantIds &&
      r.notes.trim() === want.notes
  );
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
        equipmentIds,
        notes
      });
      if (match) {
        logger.info('odometer replay dedupe: record already upstream, skipping write', {
          vehicleId: input.vehicleId,
          recordId: match.id,
          clientSubmissionId: input.clientSubmissionId
        });
        return ok({ ok: true, recordId: match.id, deduped: true });
      }
    }

    const { recordId } = await client.addOdometerRecord(input.vehicleId, {
      date: input.date,
      initialOdometer: _initialOdometerFor(records, input.date, input.odometer),
      odometer: input.odometer,
      notes: notes || undefined,
      equipmentIds
    });
    return ok({ ok: true, recordId: recordId ?? null });
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
