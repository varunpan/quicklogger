// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse, delay } from 'msw';
import { POST, _resetForTests, _initialOdometerFor, _findReplayMatch } from './+server';
import type { OdometerRecord } from '$lib/server/lubelogger';

const upstream = setupServer();
beforeAll(() => upstream.listen({ onUnhandledRequest: 'error' }));
afterEach(() => upstream.resetHandlers());
afterAll(() => upstream.close());
beforeEach(() => _resetForTests());

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

function postEvent(body: unknown, headers: Record<string, string> = {}) {
  const request = new Request('http://localhost/api/odometer', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });
  return { request, locals: { logger: noopLogger, requestId: 't' } } as unknown as Parameters<
    typeof POST
  >[0];
}

let seq = 0;
const valid = (over: Record<string, unknown> = {}) => ({
  vehicleId: 3,
  date: '2026-11-12',
  odometer: 45320,
  equipmentIds: [7],
  clientSubmissionId: `c-${++seq}`,
  ...over
});

const RECORDS = 'http://lubelog:8080/api/vehicle/odometerrecords';
const ADD = 'http://lubelog:8080/api/vehicle/odometerrecords/add';
const EQUIPMENT = 'http://lubelog:8080/api/vehicle/equipmentrecords';

const rec = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 1,
  vehicleId: 3,
  date: '2026-11-11',
  initialOdometer: 45000,
  odometer: 45100,
  equipmentRecordId: '',
  notes: '',
  ...over
});

/** Stub the records GET and capture what the add POST receives. */
function stubUpstream(records: unknown[] = [rec()]) {
  const posted: Record<string, string>[] = [];
  upstream.use(
    http.get(RECORDS, () => HttpResponse.json(records)),
    http.post(ADD, async ({ request }) => {
      posted.push((await request.json()) as Record<string, string>);
      return HttpResponse.json({ success: true, additionalData: { recordId: 99 } });
    })
  );
  return posted;
}

describe('POST /api/odometer', () => {
  it('writes the reading with the trip start, equipment ids and trimmed notes', async () => {
    const posted = stubUpstream();
    const res = await POST(postEvent(valid({ equipmentIds: [7, 8, 7], notes: ' trail ' })));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, recordId: 99 });
    expect(posted[0]).toMatchObject({
      date: '2026-11-12',
      initialOdometer: '45100',
      odometer: '45320',
      notes: 'trail',
      equipmentRecordId: '7 8'
    });
  });

  it.each([
    [{ vehicleId: 0 }, 'invalid vehicleId'],
    [{ date: '11/12/2026' }, 'invalid date'],
    [{ odometer: 12.5 }, 'odometer must be a whole number'],
    [{ odometer: -1 }, 'odometer must be a whole number'],
    [{ equipmentIds: ['7'] }, 'invalid equipmentIds'],
    [{ clientSubmissionId: '' }, 'invalid clientSubmissionId'],
    [{ clientSubmissionId: 5 }, 'invalid clientSubmissionId']
  ])('rejects bad input %#', async (over, error) => {
    const res = await POST(postEvent(valid(over)));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error });
  });

  it('rejects a non-JSON body', async () => {
    expect((await POST(postEvent('nope'))).status).toBe(400);
  });

  it('rejects an oversized advertised Content-Length with 413 before parsing (shared helper, review #14)', async () => {
    const res = await POST(postEvent(valid(), { 'content-length': String(1024 * 1024) }));
    expect(res.status).toBe(413);
  });

  it('returns 503 and writes nothing when the records pre-check fails', async () => {
    let posted = false;
    upstream.use(
      http.get(RECORDS, () => new HttpResponse('down', { status: 500 })),
      http.post(ADD, () => {
        posted = true;
        return HttpResponse.json({ success: true });
      })
    );
    expect((await POST(postEvent(valid()))).status).toBe(503);
    expect(posted).toBe(false);
  });

  it('passes a 4xx from the records pre-check straight through, not 503 (N2)', async () => {
    let posted = false;
    upstream.use(
      http.get(RECORDS, () => HttpResponse.json({ success: false }, { status: 401 })),
      http.post(ADD, () => {
        posted = true;
        return HttpResponse.json({ success: true });
      })
    );
    const res = await POST(postEvent(valid()));
    expect(res.status).toBe(401);
    expect(posted).toBe(false);
  });

  it('passes an upstream 4xx through and maps a 5xx to 502', async () => {
    upstream.use(
      http.get(RECORDS, () => HttpResponse.json([])),
      http.post(ADD, () => HttpResponse.json({ success: false }, { status: 400 }))
    );
    expect((await POST(postEvent(valid()))).status).toBe(400);
    upstream.use(http.post(ADD, () => new HttpResponse('boom', { status: 500 })));
    expect((await POST(postEvent(valid()))).status).toBe(502);
  });

  describe('trip start (review #5)', () => {
    it('uses the previous record by date, not the highest one', async () => {
      // A later-dated, higher record (the noon fill-up's auto-insert) already
      // exists; LubeLogger's blank-initial default would credit 45320−45400.
      const posted = stubUpstream([
        rec({ id: 1, date: '2026-11-11', odometer: 45100 }),
        rec({ id: 2, date: '2026-11-13', odometer: 45400 })
      ]);
      await POST(postEvent(valid()));
      expect(posted[0].initialOdometer).toBe('45100');
    });

    it('a same-reading record that already carries the trailer → zero-length record (N1)', async () => {
      // Trailer marked equipped + auto-insert: the fill-up at 45,320 already
      // credited 45,100 → 45,320 to the trailer.
      const posted = stubUpstream([
        rec({ id: 1, date: '2026-11-11', odometer: 45100 }),
        rec({ id: 2, date: '2026-11-12', odometer: 45320, equipmentRecordId: '7' })
      ]);
      await POST(postEvent(valid()));
      expect(posted[0]).toMatchObject({ initialOdometer: '45320', equipmentRecordId: '7' });
    });

    it('re-logging the same reading with the trailer ticked credits it nothing (live UAT)', async () => {
      // Logged 45,300 without the trailer, then again with it ticked: the
      // trailer must not get the truck's solo miles before 45,300.
      const posted = stubUpstream([
        rec({ id: 1, date: '2026-11-10', odometer: 45000 }),
        rec({ id: 2, date: '2026-11-15', odometer: 45300 })
      ]);
      await POST(postEvent(valid({ date: '2026-11-15', odometer: 45300 })));
      expect(posted[0]).toMatchObject({ initialOdometer: '45300', equipmentRecordId: '7' });
    });

    it('uses the reading itself when nothing precedes it', async () => {
      const posted = stubUpstream([]);
      await POST(postEvent(valid()));
      expect(posted[0].initialOdometer).toBe('45320');
    });
  });

  describe('includeEquipped (review #9)', () => {
    it("adds LubeLogger's equipped items to the written ids", async () => {
      const posted = stubUpstream();
      upstream.use(
        http.get(EQUIPMENT, () =>
          HttpResponse.json([
            { id: '7', description: 'Trailer', isEquipped: 'True', distanceTraveled: '0' },
            { id: '9', description: 'Tent', isEquipped: 'False', distanceTraveled: '0' }
          ])
        )
      );
      await POST(postEvent(valid({ equipmentIds: [], includeEquipped: true })));
      expect(posted[0].equipmentRecordId).toBe('7');
    });

    it('ignores a non-boolean includeEquipped (no equipment GET)', async () => {
      stubUpstream();
      // onUnhandledRequest: 'error' fails the test if the equipment GET happens.
      const res = await POST(postEvent(valid({ includeEquipped: 'yes' })));
      expect(res.status).toBe(200);
    });
  });

  describe('duplicate guard (review #3)', () => {
    it('a replay arriving while the original write is in flight shares its result', async () => {
      let adds = 0;
      upstream.use(
        http.get(RECORDS, () => HttpResponse.json([])),
        http.post(ADD, async () => {
          adds++;
          await delay(50); // LubeLogger slow to answer
          return HttpResponse.json({ success: true, additionalData: { recordId: 7 } });
        })
      );
      const body = valid();
      const [a, b] = await Promise.all([
        POST(postEvent(body)),
        POST(postEvent({ ...body, queueReplay: true }))
      ]);
      expect(adds).toBe(1);
      expect(await a.json()).toEqual({ ok: true, recordId: 7 });
      expect(await b.json()).toEqual({ ok: true, recordId: 7 });
    });

    it('a failed write is not cached, so a retry reaches upstream', async () => {
      upstream.use(
        http.get(RECORDS, () => HttpResponse.json([])),
        http.post(ADD, () => new HttpResponse('boom', { status: 500 }))
      );
      const body = valid();
      expect((await POST(postEvent(body))).status).toBe(502);
      const posted = stubUpstream([]);
      expect((await POST(postEvent(body))).status).toBe(200);
      expect(posted).toHaveLength(1);
    });
  });

  describe('queueReplay dedupe', () => {
    it('skips the write when the identical reading is upstream', async () => {
      const posted = stubUpstream([
        rec({ id: 41, date: '2026-11-12', odometer: 45320, equipmentRecordId: '7' })
      ]);
      const res = await POST(postEvent(valid({ queueReplay: true })));
      expect(await res.json()).toEqual({ ok: true, recordId: 41, deduped: true });
      expect(posted).toHaveLength(0);
    });

    it('writes when a same-date same-odometer record has different equipment (review #2)', async () => {
      // LubeLogger auto-inserted this for a fill-up, without the trailer: not
      // a match, so the reading is written (not dropped as a duplicate). It's
      // a zero-length trip — that leg is the fill-up record's.
      const posted = stubUpstream([
        rec({ id: 1, date: '2026-11-11', odometer: 45100 }),
        rec({ id: 41, date: '2026-11-12', odometer: 45320, equipmentRecordId: '' })
      ]);
      const res = await POST(postEvent(valid({ queueReplay: true })));
      expect(await res.json()).toEqual({ ok: true, recordId: 99 });
      expect(posted[0]).toMatchObject({ initialOdometer: '45320', equipmentRecordId: '7' });
    });

    it('includeEquipped: matches a landed original even if the equipped set changed since (N6)', async () => {
      // The original landed with trailer 7 (equipped then); 7 was unequipped
      // and 9 equipped before the replay ran.
      const posted = stubUpstream([
        rec({ id: 41, date: '2026-11-12', odometer: 45320, equipmentRecordId: '7' })
      ]);
      upstream.use(
        http.get(EQUIPMENT, () =>
          HttpResponse.json([
            { id: '7', description: 'Trailer', isEquipped: 'False', distanceTraveled: '0' },
            { id: '9', description: 'Rack', isEquipped: 'True', distanceTraveled: '0' }
          ])
        )
      );
      const res = await POST(
        postEvent(valid({ equipmentIds: [], includeEquipped: true, queueReplay: true }))
      );
      expect(await res.json()).toEqual({ ok: true, recordId: 41, deduped: true });
      expect(posted).toHaveLength(0);
    });

    it('writes when only the notes differ', async () => {
      const posted = stubUpstream([
        rec({ id: 41, date: '2026-11-12', odometer: 45320, equipmentRecordId: '7', notes: 'x' })
      ]);
      await POST(postEvent(valid({ queueReplay: true })));
      expect(posted).toHaveLength(1);
    });
  });
});

describe('POST /api/odometer — Equip / Unequip (setEquipped)', () => {
  const EQUIP_RAW = {
    id: 7,
    vehicleId: 3,
    description: 'Trailer',
    isEquipped: false,
    distanceTraveled: 0,
    notes: 'keep me',
    tags: 'x',
    extraFields: [],
    files: []
  };

  function stubEquip(opts: { putStatus?: number } = {}) {
    const order: string[] = [];
    const puts: Record<string, unknown>[] = [];
    upstream.use(
      http.get(RECORDS, () => HttpResponse.json([rec()])),
      http.post(ADD, () => {
        order.push('add');
        return HttpResponse.json({ success: true, additionalData: { recordId: 50 } });
      }),
      http.get(EQUIPMENT, () => HttpResponse.json([EQUIP_RAW])),
      http.put('http://lubelog:8080/api/vehicle/equipmentrecords/update', async ({ request }) => {
        order.push('put');
        puts.push((await request.json()) as Record<string, unknown>);
        return opts.putStatus
          ? new HttpResponse('boom', { status: opts.putStatus })
          : HttpResponse.json({ success: true });
      })
    );
    return { order, puts };
  }

  it('writes the reading, then sets Equipped (keeping the rest of the record)', async () => {
    const { order, puts } = stubEquip();
    const res = await POST(
      postEvent(valid({ equipmentIds: [], setEquipped: { equipmentId: 7, equipped: true } }))
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      recordId: 50,
      equipment: { id: 7, description: 'Trailer', isEquipped: true, distanceTraveled: 0 }
    });
    expect(order).toEqual(['add', 'put']);
    expect(puts[0]).toMatchObject({ id: '7', isEquipped: 'True', notes: 'keep me', tags: 'x' });
  });

  it('if the flag fails after the reading landed, returns 502 so the queue retries', async () => {
    stubEquip({ putStatus: 500 });
    const res = await POST(
      postEvent(valid({ equipmentIds: [], setEquipped: { equipmentId: 7, equipped: true } }))
    );
    expect(res.status).toBe(502);
  });

  it('a replay whose reading already landed skips the write and just sets the flag', async () => {
    const order: string[] = [];
    upstream.use(
      http.get(RECORDS, () =>
        HttpResponse.json([
          rec({
            id: 41,
            date: '2026-11-12',
            odometer: 45320,
            equipmentRecordId: '',
            notes: 'Equipped Trailer'
          })
        ])
      ),
      http.post(ADD, () => {
        order.push('add');
        return HttpResponse.json({ success: true });
      }),
      http.get(EQUIPMENT, () => HttpResponse.json([EQUIP_RAW])),
      http.put('http://lubelog:8080/api/vehicle/equipmentrecords/update', () => {
        order.push('put');
        return HttpResponse.json({ success: true });
      })
    );
    const res = await POST(
      postEvent(
        valid({
          equipmentIds: [],
          notes: 'Equipped Trailer',
          setEquipped: { equipmentId: 7, equipped: true },
          queueReplay: true
        })
      )
    );
    expect(await res.json()).toMatchObject({ ok: true, recordId: 41, deduped: true });
    expect(order).toEqual(['put']);
  });

  it.each([[{ equipmentId: 0, equipped: true }], [{ equipmentId: 7, equipped: 'yes' }], [null]])(
    'rejects an invalid setEquipped %#',
    async (setEquipped) => {
      const res = await POST(postEvent(valid({ setEquipped })));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'invalid setEquipped' });
    }
  );
});

describe('_initialOdometerFor', () => {
  const r = (date: string, odometer: number): OdometerRecord => ({
    id: odometer,
    date,
    initialOdometer: 0,
    odometer,
    equipmentIds: [],
    notes: ''
  });

  it('a record at the same date + odometer counts as before (zero-length trip)', () => {
    expect(_initialOdometerFor([r('2026-11-12', 45320)], '2026-11-12', 45320)).toBe(45320);
  });

  it('orders by date, then odometer, like LubeLogger recalculate', () => {
    const records = [r('2026-11-10', 45000), r('2026-11-12', 45200), r('2026-11-12', 45400)];
    expect(_initialOdometerFor(records, '2026-11-12', 45320)).toBe(45200);
  });

  it('never returns more than the reading (no negative distance)', () => {
    expect(_initialOdometerFor([r('2026-11-01', 50000)], '2026-11-12', 45320)).toBe(45320);
  });
});

describe('_findReplayMatch', () => {
  const rec2 = (ids: number[], notes = ''): OdometerRecord => ({
    id: 1,
    date: '2026-11-12',
    initialOdometer: 0,
    odometer: 45320,
    equipmentIds: ids,
    notes
  });
  const want = { date: '2026-11-12', odometer: 45320, requiredIds: [7, 8], notes: 'trail' };

  it('matches regardless of equipment order or trailing whitespace', () => {
    expect(_findReplayMatch([rec2([8, 7], 'trail ')], want)?.id).toBe(1);
  });

  it('does not match when a required item is missing at that reading', () => {
    expect(_findReplayMatch([rec2([7], 'trail')], want)).toBeUndefined();
  });

  it('does not match a record with different notes', () => {
    expect(_findReplayMatch([rec2([7, 8], 'other')], want)).toBeUndefined();
  });
});
