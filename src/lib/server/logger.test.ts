import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createLogger, bootLogger, getLogger, _resetLoggerForTests, type Logger } from './logger';
import { Writable } from 'node:stream';

function captureStream(): { stream: Writable; lines: string[] } {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer | string, _enc, cb) {
      lines.push(chunk.toString('utf-8'));
      cb();
    }
  });
  return { stream, lines };
}

function parse(line: string): Record<string, unknown> {
  return JSON.parse(line.trimEnd()) as Record<string, unknown>;
}

describe('createLogger', () => {
  it('emits one JSON record per line with ts/level/msg base fields', () => {
    const { stream, lines } = captureStream();
    const logger = createLogger({ level: 'info', pretty: false, stdout: stream });
    logger.info('hello', { foo: 1 });
    expect(lines).toHaveLength(1);
    const rec = parse(lines[0]);
    expect(rec.level).toBe('info');
    expect(rec.msg).toBe('hello');
    expect(rec.foo).toBe(1);
    expect(typeof rec.ts).toBe('string');
    expect(new Date(rec.ts as string).toISOString()).toBe(rec.ts);
  });

  it('filters records below the configured level', () => {
    const { stream, lines } = captureStream();
    const logger = createLogger({ level: 'warn', pretty: false, stdout: stream });
    logger.debug('d'); logger.info('i'); logger.warn('w'); logger.error('e');
    expect(lines.map((l) => parse(l).level)).toEqual(['warn', 'error']);
  });

  it('child merges parent ctx into every record', () => {
    const { stream, lines } = captureStream();
    const logger = createLogger({ level: 'info', pretty: false, stdout: stream });
    const child = logger.child({ request_id: 'r-1', route: '/x' });
    child.info('hit', { status: 200 });
    const rec = parse(lines[0]);
    expect(rec.request_id).toBe('r-1');
    expect(rec.route).toBe('/x');
    expect(rec.status).toBe(200);
  });

  it('redacts sensitive keys (case-insensitive) with ***', () => {
    const { stream, lines } = captureStream();
    const logger = createLogger({ level: 'info', pretty: false, stdout: stream });
    logger.info('boot', {
      apiKey: 'sk-abc',
      api_key: 'sk-def',
      Authorization: 'Bearer xyz',
      password: 'hunter2',
      token: 't-1',
      Secret: 'shh',
      visible: 'ok',
      nested: { passWord: 'inner', deeper: { token: 'deep' } }
    });
    const rec = parse(lines[0]);
    expect(rec.apiKey).toBe('***');
    expect(rec.api_key).toBe('***');
    expect(rec.Authorization).toBe('***');
    expect(rec.password).toBe('***');
    expect(rec.token).toBe('***');
    expect(rec.Secret).toBe('***');
    expect(rec.visible).toBe('ok');
    const nested = rec.nested as Record<string, unknown>;
    expect(nested.passWord).toBe('***');
    expect((nested.deeper as Record<string, unknown>).token).toBe('***');
  });

  it('does not redact base fields (ts/level/msg) even if their names match', () => {
    const { stream, lines } = captureStream();
    const logger = createLogger({ level: 'info', pretty: false, stdout: stream });
    logger.info('user provided api_key in request');
    const rec = parse(lines[0]);
    expect(rec.msg).toBe('user provided api_key in request');
  });

  it('handles cycles without throwing', () => {
    const { stream, lines } = captureStream();
    const logger = createLogger({ level: 'info', pretty: false, stdout: stream });
    const a: Record<string, unknown> = { name: 'a' };
    const b: Record<string, unknown> = { name: 'b', a };
    a.b = b;
    expect(() => logger.info('cycle', { a })).not.toThrow();
    expect(lines).toHaveLength(1);
  });

  it('depth-limits to 5 levels', () => {
    const { stream, lines } = captureStream();
    const logger = createLogger({ level: 'info', pretty: false, stdout: stream });
    type Nest = { v?: number; n?: Nest };
    let n: Nest = { v: 7 };
    for (let i = 0; i < 10; i++) n = { n };
    expect(() => logger.info('deep', { n })).not.toThrow();
    const rec = parse(lines[0]);
    expect(JSON.stringify(rec).length).toBeLessThan(2000);
  });

  it('unpacks Error in ctx.err as {message, stack, name}', () => {
    const { stream, lines } = captureStream();
    const logger = createLogger({ level: 'info', pretty: false, stdout: stream });
    const err = new Error('boom'); err.name = 'BoomError';
    logger.error('exploded', { err });
    const rec = parse(lines[0]);
    const errRec = rec.err as Record<string, unknown>;
    expect(errRec.message).toBe('boom');
    expect(errRec.name).toBe('BoomError');
    expect(typeof errRec.stack).toBe('string');
  });

  it('pretty mode emits a single non-JSON line per record', () => {
    const { stream, lines } = captureStream();
    const logger = createLogger({ level: 'info', pretty: true, stdout: stream });
    logger.warn('something', { status: 502 });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('WARN');
    expect(lines[0]).toContain('something');
    expect(lines[0]).toContain('status=502');
    expect(() => JSON.parse(lines[0])).toThrow();
  });

  it('serializer never crashes on malformed input', () => {
    const { stream } = captureStream();
    const logger = createLogger({ level: 'info', pretty: false, stdout: stream });
    expect(() => logger.info('weird', { fn: () => 1, sym: Symbol('x'), big: 10n })).not.toThrow();
  });
});

describe('bootLogger', () => {
  beforeEach(() => _resetLoggerForTests());

  it('returns a logger and sets it as the singleton', () => {
    const logger = bootLogger(
      {
        logLevel: 'info',
        logPretty: false,
        logFilePath: undefined,
        logFileMaxSizeMb: 5,
        logFileMaxFiles: 5,
        envWarnings: []
      },
      { registerProcessHandlers: false }
    );
    expect(logger).toBeDefined();
    expect(getLogger()).toBe(logger);
  });

  it('emits warn records for envWarnings (no throw)', () => {
    expect(() =>
      bootLogger(
        {
          logLevel: 'info',
          logPretty: false,
          logFilePath: undefined,
          logFileMaxSizeMb: 5,
          logFileMaxFiles: 5,
          envWarnings: ['LOG_LEVEL invalid', 'LOG_FILE_MAX_FILES out of range']
        },
        { registerProcessHandlers: false }
      )
    ).not.toThrow();
  });

  it('does not register crash handlers when registerProcessHandlers=false', () => {
    const before = process.listenerCount('uncaughtException');
    bootLogger(
      {
        logLevel: 'info',
        logPretty: false,
        logFilePath: undefined,
        logFileMaxSizeMb: 5,
        logFileMaxFiles: 5,
        envWarnings: []
      },
      { registerProcessHandlers: false }
    );
    expect(process.listenerCount('uncaughtException')).toBe(before);
  });
});
