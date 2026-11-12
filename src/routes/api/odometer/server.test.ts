// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { POST } from './+server';

const upstream = setupServer();
beforeAll(() => upstream.listen({ onUnhandledRequest: 'error' }));
afterEach(() => upstream.resetHandlers());
afterAll(() => upstream.close());

beforeAll(() => {
  process.env.LUBELOGGER_URL = 'http://lubelog:8080';
  process.env.LUBELOGGER_API_KEY = 'k';
});

const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child() {
    return this;
  }
} as unknown as import('$lib/server/logger').Logger;

function postEvent(body: unknown) {
  const request = new Request('http://localhost/api/odometer', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });
  return { request, locals: { logger: noopLogger, requestId: 't' } } as unknown as Parameters<
    typeof POST
  >[0];
}

const VALID = { vehicleId: 3, date: '2026-11-12', odometer: 45210, equipmentIds: [7] };

describe('POST /api/odometer', () => {
  it('forwards an odometer-only record with equipment ids to LubeLogger', async () => {
    let seen: { url: URL; body: Record<string, string> } | null = null;
    upstream.use(
      http.post('http://lubelog:8080/api/vehicle/odometerrecords/add', async ({ request }) => {
        seen = {
          url: new URL(request.url),
          body: (await request.json()) as Record<string, string>
        };
        return HttpResponse.json({
          success: true,
          message: 'Odometer Record Added',
          additionalData: { recordId: 99 }
        });
      })
    );
    const res = await POST(postEvent({ ...VALID, equipmentIds: [7, 8, 7], notes: ' trail ' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, recordId: 99 });
    expect(seen!.url.searchParams.get('vehicleId')).toBe('3');
    expect(seen!.body).toMatchObject({
      date: '2026-11-12',
      odometer: '45210',
      notes: 'trail',
      equipmentRecordId: '7 8'
    });
  });

  it('sends an empty equipment list when none selected', async () => {
    let body: Record<string, string> = {};
    upstream.use(
      http.post('http://lubelog:8080/api/vehicle/odometerrecords/add', async ({ request }) => {
        body = (await request.json()) as Record<string, string>;
        return HttpResponse.json({ success: true, additionalData: { recordId: 1 } });
      })
    );
    const res = await POST(postEvent({ vehicleId: 3, date: '2026-11-12', odometer: 10 }));
    expect(res.status).toBe(200);
    expect(body.equipmentRecordId).toBe('');
  });

  it.each([
    [{ ...VALID, vehicleId: 0 }, 'invalid vehicleId'],
    [{ ...VALID, date: '11/12/2026' }, 'invalid date'],
    [{ ...VALID, odometer: 12.5 }, 'odometer must be a whole number'],
    [{ ...VALID, odometer: -1 }, 'odometer must be a whole number'],
    [{ ...VALID, equipmentIds: ['7'] }, 'invalid equipmentIds']
  ])('rejects bad input %#', async (body, error) => {
    const res = await POST(postEvent(body));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error });
  });

  it('rejects a non-JSON body', async () => {
    const res = await POST(postEvent('nope'));
    expect(res.status).toBe(400);
  });

  it('passes an upstream 400 (unknown equipment) through as 400', async () => {
    upstream.use(
      http.post('http://lubelog:8080/api/vehicle/odometerrecords/add', () =>
        HttpResponse.json({ success: false, message: 'equipment does not exist' }, { status: 400 })
      )
    );
    const res = await POST(postEvent(VALID));
    expect(res.status).toBe(400);
  });

  it('treats a 200 with success:false as a failure', async () => {
    upstream.use(
      http.post('http://lubelog:8080/api/vehicle/odometerrecords/add', () =>
        HttpResponse.json({ success: false, message: 'nope' })
      )
    );
    const res = await POST(postEvent(VALID));
    expect(res.status).toBe(400);
  });

  it('maps an upstream 5xx to 502', async () => {
    upstream.use(
      http.post(
        'http://lubelog:8080/api/vehicle/odometerrecords/add',
        () => new HttpResponse('boom', { status: 500 })
      )
    );
    const res = await POST(postEvent(VALID));
    expect(res.status).toBe(502);
  });

  it('rejects an oversized advertised Content-Length with 413 before parsing', async () => {
    const request = new Request('http://localhost/api/odometer', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': String(1024 * 1024) },
      body: JSON.stringify(VALID)
    });
    const res = await POST({
      request,
      locals: { logger: noopLogger, requestId: 't' }
    } as unknown as Parameters<typeof POST>[0]);
    expect(res.status).toBe(413);
  });

  describe('queueReplay dedupe', () => {
    it('skips the write and returns deduped when the same date + odometer is upstream', async () => {
      let posted = false;
      upstream.use(
        http.get('http://lubelog:8080/api/vehicle/odometerrecords', () =>
          HttpResponse.json([
            { id: 41, date: '2026-11-12', initialOdometer: 45100, odometer: 45210 }
          ])
        ),
        http.post('http://lubelog:8080/api/vehicle/odometerrecords/add', () => {
          posted = true;
          return HttpResponse.json({ success: true });
        })
      );
      const res = await POST(postEvent({ ...VALID, queueReplay: true }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, recordId: 41, deduped: true });
      expect(posted).toBe(false);
    });

    it('writes when no matching record exists', async () => {
      upstream.use(
        http.get('http://lubelog:8080/api/vehicle/odometerrecords', () =>
          HttpResponse.json([{ id: 41, date: '2026-11-11', initialOdometer: 0, odometer: 45210 }])
        ),
        http.post('http://lubelog:8080/api/vehicle/odometerrecords/add', () =>
          HttpResponse.json({ success: true, additionalData: { recordId: 42 } })
        )
      );
      const res = await POST(postEvent({ ...VALID, queueReplay: true }));
      expect(await res.json()).toEqual({ ok: true, recordId: 42 });
    });

    it('returns 503 (never writes) when the pre-check GET fails', async () => {
      let posted = false;
      upstream.use(
        http.get(
          'http://lubelog:8080/api/vehicle/odometerrecords',
          () => new HttpResponse('down', { status: 500 })
        ),
        http.post('http://lubelog:8080/api/vehicle/odometerrecords/add', () => {
          posted = true;
          return HttpResponse.json({ success: true });
        })
      );
      const res = await POST(postEvent({ ...VALID, queueReplay: true }));
      expect(res.status).toBe(503);
      expect(posted).toBe(false);
    });

    it('ignores a non-boolean queueReplay (no pre-check GET)', async () => {
      upstream.use(
        http.post('http://lubelog:8080/api/vehicle/odometerrecords/add', () =>
          HttpResponse.json({ success: true, additionalData: { recordId: 5 } })
        )
      );
      // onUnhandledRequest: 'error' fails the test if the GET is attempted.
      const res = await POST(postEvent({ ...VALID, queueReplay: 'yes' }));
      expect(res.status).toBe(200);
    });
  });
});
