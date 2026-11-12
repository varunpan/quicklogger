import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { lubeloggerFromEnv } from '$lib/server/lubeloggerProxy';
import { LubeLoggerError } from '$lib/server/lubelogger';
import type { OdometerSubmissionInput } from '$lib/shared/types';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// A real submission is a few hundred bytes. The transport runs with
// BODY_SIZE_LIMIT=Infinity (see photo-ocr.md), so — like /api/fuelup and
// /api/ocr — reject an oversized advertised Content-Length before buffering.
const MAX_BODY_BYTES = 16 * 1024;

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
  return null;
}

export const POST: RequestHandler = async ({ request, locals }) => {
  const contentLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
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

  try {
    const { client } = lubeloggerFromEnv(locals.logger);
    const { recordId } = await client.addOdometerRecord(valid.vehicleId, {
      date: valid.date,
      odometer: valid.odometer,
      notes: valid.notes?.trim() || undefined,
      equipmentIds: valid.equipmentIds ? [...new Set(valid.equipmentIds)] : []
    });
    return json({ ok: true, recordId: recordId ?? null });
  } catch (err) {
    if (err instanceof LubeLoggerError) {
      return json(
        { error: 'Could not add odometer record to LubeLogger' },
        { status: err.status >= 500 ? 502 : err.status }
      );
    }
    locals.logger.error('odometer submit failed', { err });
    return json({ error: 'unexpected server error' }, { status: 500 });
  }
};
