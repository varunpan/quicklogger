import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('clientLogger', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response(null, { status: 204, headers: { 'x-request-id': 'r-1' } }));
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers();
    vi.resetModules();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('flushes after 10 records', async () => {
    const { clientLogger, _resetClientLoggerForTests } = await import('./logger');
    _resetClientLoggerForTests();
    for (let i = 0; i < 10; i++) clientLogger.info(`m${i}`);
    await vi.runAllTimersAsync();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.records).toHaveLength(10);
  });

  it('flushes after 10s timer even with fewer than 10 records', async () => {
    const { clientLogger, _resetClientLoggerForTests } = await import('./logger');
    _resetClientLoggerForTests();
    clientLogger.info('one');
    await vi.advanceTimersByTimeAsync(10_001);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('redacts api_key in ctx before sending', async () => {
    const { clientLogger, _resetClientLoggerForTests } = await import('./logger');
    _resetClientLoggerForTests();
    clientLogger.error('boom', { api_key: 'sk-secret', visible: 'ok' });
    await vi.advanceTimersByTimeAsync(10_001);
    const call = fetchMock.mock.calls.find((c) => (c[0] as string).includes('/api/log'));
    const body = JSON.parse((call?.[1] as RequestInit).body as string);
    expect(body.records[0].ctx.api_key).toBe('***');
    expect(body.records[0].ctx.visible).toBe('ok');
  });

  it('drops oldest when buffer overflows past 20 records', async () => {
    const { clientLogger, _resetClientLoggerForTests, _bufferForTests } = await import('./logger');
    _resetClientLoggerForTests();
    for (let i = 0; i < 25; i++) clientLogger.info(`m${i}`);
    expect(_bufferForTests().length).toBe(20);
    expect(_bufferForTests()[0].msg).toBe('m5');
  });

  // T1 — a 5xx flush must not drop the records; it requeues them and lengthens
  // the retry interval. Without this, client-log loss is invisible during phone
  // UAT (the flush fails silently and the records vanish).
  it('requeues records and doubles the backoff on a 5xx flush, resending them on the next timer', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
    const { clientLogger, _resetClientLoggerForTests, _bufferForTests } = await import('./logger');
    _resetClientLoggerForTests();

    clientLogger.info('a');
    await vi.advanceTimersByTimeAsync(10_001); // first flush fires at the 10s base backoff
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // 503 → records go back onto the buffer instead of being dropped
    expect(_bufferForTests().map((r) => r.msg)).toEqual(['a']);

    // backoff doubled 10s→20s: a fresh record reschedules at the longer interval
    clientLogger.info('b');
    await vi.advanceTimersByTimeAsync(10_001); // only ~10s more elapsed — still under 20s
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_001); // now past the doubled interval
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const body = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string);
    expect(body.records.map((r: { msg: string }) => r.msg)).toEqual(['a', 'b']);
  });

  // T2a — a thrown flush (network error) hits the catch and must requeue too.
  it('requeues records when the flush throws (network error) and resends them later', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('network down'));
    const { clientLogger, _resetClientLoggerForTests, _bufferForTests } = await import('./logger');
    _resetClientLoggerForTests();

    clientLogger.warn('net');
    await vi.advanceTimersByTimeAsync(10_001); // flush throws → caught → requeued
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(_bufferForTests().map((r) => r.msg)).toEqual(['net']);

    // next scheduled flush (at the doubled backoff) succeeds and drains the buffer
    clientLogger.warn('net2');
    await vi.advanceTimersByTimeAsync(20_001);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(_bufferForTests()).toHaveLength(0);
  });

  // T2b — installClientLogger's beforeunload handler must hand the still-buffered
  // records to sendBeacon so an unload doesn't lose them.
  it('flushes the remaining buffer via sendBeacon on beforeunload', async () => {
    const sendBeacon = vi.fn((_url: string, _data: Blob) => true);
    vi.stubGlobal('navigator', { sendBeacon });
    const { clientLogger, installClientLogger, _resetClientLoggerForTests, _bufferForTests } =
      await import('./logger');
    _resetClientLoggerForTests();
    installClientLogger();

    clientLogger.info('keep1');
    clientLogger.info('keep2');
    expect(_bufferForTests()).toHaveLength(2);

    window.dispatchEvent(new Event('beforeunload'));

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(sendBeacon.mock.calls[0][0]).toBe('/api/log');
    const blob = sendBeacon.mock.calls[0][1];
    expect(blob).toBeInstanceOf(Blob);
    const parsed = JSON.parse(await blob.text());
    expect(parsed.records.map((r: { msg: string }) => r.msg)).toEqual(['keep1', 'keep2']);
    // the beacon drains the buffer
    expect(_bufferForTests()).toHaveLength(0);
  });

  // T2b (guard) — no beacon when there is nothing buffered (logger.ts:111 early return).
  it('sends no beacon on beforeunload when the buffer is empty', async () => {
    const sendBeacon = vi.fn((_url: string, _data: Blob) => true);
    vi.stubGlobal('navigator', { sendBeacon });
    const { installClientLogger, _resetClientLoggerForTests } = await import('./logger');
    _resetClientLoggerForTests();
    installClientLogger();

    window.dispatchEvent(new Event('beforeunload'));
    expect(sendBeacon).not.toHaveBeenCalled();
  });
});
