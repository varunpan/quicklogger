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
});
