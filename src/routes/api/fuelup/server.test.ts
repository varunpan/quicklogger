// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { POST, _resetForTests } from './+server';

const upstream = setupServer();
beforeAll(() => upstream.listen({ onUnhandledRequest: 'error' }));
afterEach(() => { upstream.resetHandlers(); _resetForTests(); });
afterAll(() => upstream.close());

beforeAll(() => {
  process.env.LUBELOGGER_URL = 'http://lubelog:8080';
  process.env.LUBELOGGER_API_KEY = 'k';
  process.env.LUBELOGGER_VOLUME_UNIT = 'gallons_us';
  process.env.LUBELOGGER_CURRENCY = 'USD';
});

const noopLogger = {
  debug: () => {}, info: () => {}, warn: () => {}, error: () => {},
  child() { return this; }
} as unknown as import('$lib/server/logger').Logger;

function event(body: unknown) {
  const request = new Request('http://app/api/fuelup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { request, locals: { logger: noopLogger, requestId: 't' } } as unknown as Parameters<typeof POST>[0];
}

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 1, 2, 3, 4]);

function multipartEvent(
  fields: Record<string, string>,
  images: { pumpImage?: Uint8Array; odometerImage?: Uint8Array } = {}
) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  if (images.pumpImage) fd.set('pumpImage', new Blob([new Uint8Array(images.pumpImage)], { type: 'image/jpeg' }), 'p.jpg');
  if (images.odometerImage) fd.set('odometerImage', new Blob([new Uint8Array(images.odometerImage)], { type: 'image/jpeg' }), 'o.jpg');
  const request = new Request('http://app/api/fuelup', { method: 'POST', body: fd });
  return { request, locals: { logger: noopLogger, requestId: 't' } } as unknown as Parameters<typeof POST>[0];
}

const baseFields = {
  vehicleId: '1',
  date: '2026-05-29',
  odometer: '87432',
  volume: '11.2',
  volumeUnit: 'gal',
  cost: '42.18',
  currency: 'USD',
  isFillToFull: 'true',
  missedFuelup: 'false'
};

describe('POST /api/fuelup — culture-invariant write', () => {
  it('sends date as ISO YYYY-MM-DD in the upstream form-data', async () => {
    let observedDate = '';
    let observedCulture = '';
    upstream.use(
      http.post('http://lubelog:8080/api/vehicle/gasrecords/add', async ({ request }) => {
        observedCulture = request.headers.get('culture-invariant') ?? '';
        const fd = await request.formData();
        observedDate = String(fd.get('date') ?? '');
        return HttpResponse.json({ success: true });
      })
    );
    const res = await POST(event({
      vehicleId: 1, date: '2026-05-28', odometer: 87500, volume: 0.001,
      volumeUnit: 'gal', cost: 0.01, currency: 'USD',
      isFillToFull: false, missedFuelup: false,
      clientSubmissionId: '11111111-1111-1111-1111-111111111111'
    }));
    expect(res.status).toBe(200);
    expect(observedDate).toBe('2026-05-28');
    expect(observedCulture).toBe('true');
  });

  it('multipart with pumpImage uploads it and adds the record via the JSON files variant', async () => {
    let uploadName = '';
    let addCt = '';
    let addBody: Record<string, unknown> = {};
    upstream.use(
      http.post('http://lubelog:8080/api/documents/upload', async ({ request }) => {
        const fd = await request.formData();
        const f = fd.get('documents');
        uploadName = f instanceof File ? f.name : '';
        return HttpResponse.json([{ name: uploadName, location: '/documents/u.jpg', isPending: false }]);
      }),
      http.post('http://lubelog:8080/api/vehicle/gasrecords/add', async ({ request }) => {
        addCt = request.headers.get('content-type') ?? '';
        addBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ success: true, message: 'Gas Record Added' });
      })
    );
    const res = await POST(multipartEvent({ ...baseFields, clientSubmissionId: 'm1' }, { pumpImage: JPEG }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.photoWarning).toBeUndefined();
    expect(uploadName).toBe('pump-87432mi.jpg');
    expect(addCt).toContain('application/json');
    expect(addBody.files).toHaveLength(1);
  });

  it('record-first: upload failure still creates the record and sets photoWarning', async () => {
    let addCalled = false;
    upstream.use(
      http.post('http://lubelog:8080/api/documents/upload', () => new HttpResponse('boom', { status: 503 })),
      http.post('http://lubelog:8080/api/vehicle/gasrecords/add', async ({ request }) => {
        addCalled = true;
        expect(request.headers.get('content-type')).toContain('multipart/form-data');
        await request.formData();
        return HttpResponse.text('OK');
      })
    );
    const res = await POST(multipartEvent({ ...baseFields, clientSubmissionId: 'm2' }, { pumpImage: JPEG }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.photoWarning).toBe('string');
    expect(addCalled).toBe(true);
  });

  it('part-gate: a non-image part is skipped with photoWarning, record still created', async () => {
    let uploadCalled = false;
    upstream.use(
      http.post('http://lubelog:8080/api/documents/upload', () => { uploadCalled = true; return HttpResponse.json([]); }),
      http.post('http://lubelog:8080/api/vehicle/gasrecords/add', async ({ request }) => {
        await request.formData();
        return HttpResponse.text('OK');
      })
    );
    const notImage = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
    const res = await POST(multipartEvent({ ...baseFields, clientSubmissionId: 'm3' }, { pumpImage: notImage }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.photoWarning).toBeTruthy();
    expect(uploadCalled).toBe(false);
  });

  it('multipart with no image parts uses the flat path (no upload)', async () => {
    let uploadCalled = false;
    upstream.use(
      http.post('http://lubelog:8080/api/documents/upload', () => { uploadCalled = true; return HttpResponse.json([]); }),
      http.post('http://lubelog:8080/api/vehicle/gasrecords/add', async ({ request }) => {
        expect(request.headers.get('content-type')).toContain('multipart/form-data');
        await request.formData();
        return HttpResponse.text('OK');
      })
    );
    const res = await POST(multipartEvent({ ...baseFields, clientSubmissionId: 'm4' }));
    expect(res.status).toBe(200);
    expect(uploadCalled).toBe(false);
  });
});

describe('POST /api/fuelup — manualFxRate validation', () => {
  it('rejects a non-positive manualFxRate with 400 (no upstream write)', async () => {
    const res = await POST(event({
      vehicleId: 1, date: '2026-05-28', odometer: 87500, volume: 11.2,
      volumeUnit: 'gal', cost: 42.18, currency: 'CAD',
      isFillToFull: false, missedFuelup: false, manualFxRate: -1,
      clientSubmissionId: 'fx-neg'
    }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('manualFxRate');
  });

  it('rejects a non-finite manualFxRate (NaN from form coercion) with 400', async () => {
    const res = await POST(multipartEvent(
      { ...baseFields, currency: 'CAD', manualFxRate: 'abc', clientSubmissionId: 'fx-nan' }
    ));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('manualFxRate');
  });
});
