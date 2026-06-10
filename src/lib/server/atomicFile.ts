/**
 * Crash-safe, race-safe disk writes for the on-disk JSON stores under `/data`.
 *
 * Two defects these primitives close (review #4 — "disk-cache write race"):
 *
 * 1. **Torn writes.** A plain `writeFile` truncates the target first, so a
 *    process kill mid-write leaves a corrupt/empty file. `atomicWriteFile`
 *    writes a temp file then `rename`s it over the target — `rename` is atomic
 *    on the same filesystem, so a reader sees either the old file or the new
 *    one, never a half-written one.
 * 2. **Lost updates.** `load() → mutate → write` with no lock lets two
 *    concurrent requests read the same snapshot and have the second write
 *    clobber the first (e.g. the OCR budget under-counting its daily spend).
 *    `withPathLock` serializes the *whole* read-modify-write per path, so the
 *    second request reads the state the first one just wrote.
 *
 * Scope: an in-process mutex. The stores are module-level singletons and the
 * app runs single-replica, so one lock map per process covers every writer.
 * A multi-replica deployment sharing `/data` would need an OS-level file lock.
 */
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

/**
 * Write `contents` to `path` atomically: temp file + `rename`. Creates the
 * parent directory if missing. Callers that read-modify-write should hold
 * {@link withPathLock} for the same `path` around the whole sequence.
 */
export async function atomicWriteFile(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(tmp, contents, 'utf-8');
  await rename(tmp, path);
}

// One promise chain per path. A new acquirer awaits the current tail; the tail
// is a *swallowed* promise so a rejecting section can't poison later acquirers.
const chains = new Map<string, Promise<unknown>>();

/**
 * Run `fn` with exclusive access to `path`: overlapping calls for the same
 * path run one at a time, in call order. Calls for different paths run
 * concurrently. Returns whatever `fn` resolves to (and rejects if `fn` does).
 */
export function withPathLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(path) ?? Promise.resolve();
  const run = prev.then(fn, fn); // run after prev settles, regardless of outcome
  const tail = run.then(
    () => {},
    () => {}
  );
  chains.set(path, tail);
  // Drop the entry once this section is the last in line — keeps the map from
  // growing one stale resolved promise per write forever.
  void tail.then(() => {
    if (chains.get(path) === tail) chains.delete(path);
  });
  return run;
}
