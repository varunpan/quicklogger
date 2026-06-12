interface Entry<T> { promise: Promise<T>; expiresAt: number; }

export class TtlCache<T> {
  private readonly entries = new Map<string, Entry<T>>();
  constructor(private readonly ttlMs: number) {}

  get(key: string, fetcher: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const hit = this.entries.get(key);
    if (hit && hit.expiresAt > now) return hit.promise;
    // Cache the in-flight promise, not the resolved value. Concurrent misses for
    // the same key then share one fetch instead of each invoking `fetcher()` —
    // the thundering herd a cold page load triggers when several routes ask for
    // the same upstream data at once (review #36). The entry is set
    // synchronously, before any caller can await, so the second concurrent
    // caller sees the in-flight promise rather than a fresh miss.
    const promise = fetcher();
    const entry: Entry<T> = { promise, expiresAt: now + this.ttlMs };
    this.entries.set(key, entry);
    // A rejected fetch must not be cached — evict so the next caller retries
    // instead of replaying the failure for the rest of the TTL window. Guard on
    // identity so a newer entry for the same key (set after a re-fetch) survives.
    void promise.catch(() => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
    });
    return promise;
  }

  invalidate(key: string) { this.entries.delete(key); }
  clear() { this.entries.clear(); }
}
