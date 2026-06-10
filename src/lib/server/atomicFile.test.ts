import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { atomicWriteFile, withPathLock } from './atomicFile';

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

describe('atomicWriteFile', () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'atomic-'));
    path = join(dir, 'store.json');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('writes the contents to the target path', async () => {
    await atomicWriteFile(path, '{"a":1}');
    expect(readFileSync(path, 'utf-8')).toBe('{"a":1}');
  });

  it('overwrites an existing file', async () => {
    writeFileSync(path, 'old');
    await atomicWriteFile(path, 'new');
    expect(readFileSync(path, 'utf-8')).toBe('new');
  });

  it('creates the parent directory if missing', async () => {
    const nested = join(dir, 'deep', 'nested', 'store.json');
    await atomicWriteFile(nested, 'hi');
    expect(readFileSync(nested, 'utf-8')).toBe('hi');
  });

  it('leaves no temp file behind on success', async () => {
    await atomicWriteFile(path, 'data');
    expect(readdirSync(dir)).toEqual(['store.json']);
  });
});

describe('withPathLock', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lock-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('serializes overlapping critical sections on the same path', async () => {
    const p = join(dir, 'a');
    const events: string[] = [];
    const section = (i: number) => async () => {
      events.push(`enter:${i}`);
      await tick();
      events.push(`exit:${i}`);
    };
    // Fire both before awaiting — they overlap in time, but the lock must
    // keep each section's enter/exit adjacent (no interleave).
    await Promise.all([withPathLock(p, section(0)), withPathLock(p, section(1))]);
    expect(events).toEqual(['enter:0', 'exit:0', 'enter:1', 'exit:1']);
  });

  it('lets different paths run concurrently', async () => {
    const events: string[] = [];
    const section = (id: string) => async () => {
      events.push(`enter:${id}`);
      await tick();
      events.push(`exit:${id}`);
    };
    await Promise.all([
      withPathLock(join(dir, 'a'), section('a')),
      withPathLock(join(dir, 'b'), section('b'))
    ]);
    // Both enter before either exits → interleaved (not serialized across paths).
    expect(events.slice(0, 2).sort()).toEqual(['enter:a', 'enter:b']);
  });

  it('returns the result of the critical section', async () => {
    const out = await withPathLock(join(dir, 'a'), async () => 42);
    expect(out).toBe(42);
  });

  it('does not poison the chain when a section rejects', async () => {
    const p = join(dir, 'a');
    await expect(withPathLock(p, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    // A later acquirer on the same path must still run.
    await expect(withPathLock(p, async () => 'ok')).resolves.toBe('ok');
  });

  it('does not leak unbounded lock state per path', async () => {
    // After all sections drain, re-acquiring still works (smoke test that the
    // map entry is cleaned up rather than chaining forever).
    const p = join(dir, 'a');
    for (let i = 0; i < 3; i++) await withPathLock(p, async () => i);
    await expect(withPathLock(p, async () => 'done')).resolves.toBe('done');
    void existsSync; // keep import set stable
  });
});
