/**
 * Short-lived duplicate-submit guard keyed on the client's submission id,
 * shared by `/api/fuelup` and `/api/odometer`. Extracted from `/api/fuelup`
 * unchanged in behaviour.
 *
 * A duplicate (same key) arriving while the first is in flight, or within the
 * window after it succeeded, awaits and shares the first one's result instead
 * of writing upstream again — a double-tap, or the SW queue replay racing a
 * foreground submit whose response was lost. The pending promise is
 * registered synchronously, before any `await`, which is what closes the
 * concurrent race. Successes stay cached for the window; failures are dropped
 * on completion (no record was created) so a genuine retry reaches upstream.
 */

/** A submission's serialized outcome. Stored serialized (not a `Response`)
 *  because a `Response` body is single-use — concurrent waiters each build
 *  their own fresh `Response` from the same bytes. */
export type SubmitResult = { status: number; body: string };

export class IdempotencyWindow {
  // `settled` gates the sweep: `ts` is stamped at registration, so a
  // submission in flight for longer than the window would age out while
  // unresolved — and evicting it would let a late duplicate re-submit
  // concurrently, the exact double-write this map prevents.
  private readonly map = new Map<
    string,
    { ts: number; settled: boolean; promise: Promise<SubmitResult> }
  >();

  constructor(private readonly windowMs = 60_000) {}

  async run(key: string, submit: () => Promise<SubmitResult>): Promise<SubmitResult> {
    const now = Date.now();
    for (const [k, v] of this.map) {
      if (v.settled && now - v.ts > this.windowMs) this.map.delete(k);
    }

    const existing = this.map.get(key);
    if (existing) return existing.promise;

    const promise = submit();
    const entry = { ts: now, settled: false, promise };
    this.map.set(key, entry);

    const result = await promise;
    entry.settled = true;
    if (result.status >= 200 && result.status < 300) {
      entry.ts = Date.now();
    } else {
      this.map.delete(key);
    }
    return result;
  }

  clear(): void {
    this.map.clear();
  }
}

export function jsonResponse(r: SubmitResult): Response {
  return new Response(r.body, {
    status: r.status,
    headers: { 'content-type': 'application/json' }
  });
}
