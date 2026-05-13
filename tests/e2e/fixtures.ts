import { expect, type Page } from '@playwright/test';

export async function mockLubelogger(page: Page) {
  await page.route('**/api/vehicles', (route) =>
    route.fulfill({ json: [{ id: 1, year: 2019, make: 'Honda', model: 'Civic Si' }] })
  );
  await page.route('**/api/vehicle/last-fuelup**', (route) =>
    route.fulfill({ json: null })
  );
  await page.route('**/api/fx**', (route) =>
    route.fulfill({ json: { rate: 0.73, source: 'frankfurter', fetchedAt: Date.now(), stale: false, ageHours: 1 } })
  );
  await page.route('**/api/fuelup', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    return route.fulfill({
      json: {
        ok: true,
        submitted: {
          gallons: body.volume * (body.volumeUnit === 'L' ? 1 / 3.785411784 : 1),
          cost: body.cost * (body.currency === 'CAD' ? 0.73 : 1),
          fxRate: body.currency === 'CAD' ? 0.73 : 1,
          fxSource: 'frankfurter',
          fxStale: false
        }
      }
    });
  });
}

/**
 * Pin the in-page Date to a fixed local-time instant. Forwards all constructor
 * args so multi-arg `new Date(y, m, d)` calls (used in local-calendar arithmetic
 * like `daysAgo`) still work correctly.
 */
export async function pinClock(page: Page, isoLocal: string) {
  await page.addInitScript((iso) => {
    const now = new Date(iso).getTime();
    const D = Date;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).Date = class extends D {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      constructor(...args: any[]) {
        if (args.length === 0) super(now);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        else super(...(args as [any]));
      }
      static now() { return now; }
    };
  }, isoLocal);
}

export type LastFuelupPayload = {
  id: string;
  vehicleId: string;
  date: string;
  odometer: string;
  fuelConsumed: string;
  cost: string;
  fuelEconomy?: string;
  isFillToFull?: string;
  missedFuelUp?: string;
  notes?: string;
  tags?: string;
  extraFields?: unknown[];
  files?: unknown[];
};

const DEFAULT_LAST_FUELUP: LastFuelupPayload = {
  id: '999',
  vehicleId: '1',
  date: '5/3/2026',
  odometer: '87234',
  fuelConsumed: '10.8',
  cost: '39.42',
  fuelEconomy: '0',
  isFillToFull: 'True',
  missedFuelUp: 'False',
  notes: 'Costco Pump 4',
  tags: '',
  extraFields: [],
  files: []
};

/**
 * Mock `/api/vehicles`, `/api/vehicle/last-fuelup`, and `/api/fx` for the
 * last-fuelup-aware home page. Pass `null` to simulate the no-prior-fuelup
 * case; pass an object to override the default payload; omit to use the
 * canonical default (with notes).
 */
export async function mockWithLastFuelup(
  page: Page,
  lastFuelup: LastFuelupPayload | null | undefined = DEFAULT_LAST_FUELUP
) {
  await page.route('**/api/vehicles', (route) =>
    route.fulfill({ json: [{ id: 1, year: 2014, make: 'Honda', model: 'Accord' }] })
  );
  await page.route('**/api/vehicle/last-fuelup**', (route) =>
    route.fulfill({ json: lastFuelup ?? null })
  );
  await page.route('**/api/fx**', (route) =>
    route.fulfill({ json: { rate: 1, source: 'identity', fetchedAt: Date.now(), stale: false, ageHours: 0 } })
  );
}

/**
 * Navigate to `/` via the SvelteKit client router instead of a hard load.
 * Why: `+page.ts` `load` runs server-side during SSR, and Playwright's
 * `page.route()` mocks don't intercept those in-process SvelteKit fetches.
 * Going through `/settings` first then clicking into `/` re-runs `load` in
 * the browser where the mocks apply.
 */
export async function gotoHomeViaClientRouter(page: Page) {
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('link', { name: 'Log Fuel' }).click();
  await expect(page).toHaveURL('/');
}

/**
 * Seed `quicklogger.prefs` in localStorage before page scripts run. The keys
 * are spec-defined; this helper stays prefs-shape-agnostic.
 */
export async function seedPrefs(page: Page, prefs: Record<string, unknown>) {
  await page.addInitScript((p) => {
    localStorage.setItem('quicklogger.prefs', JSON.stringify(p));
  }, prefs);
}

/**
 * Seed an entry into the IndexedDB `pendingSubmissions` store before page
 * scripts run. The shape mirrors the runtime `QueueEntry` (no id —
 * IndexedDB autoIncrements). Use this to set up offline-resolver fixtures
 * without going through the full submit flow.
 */
export async function seedQueueEntry(
  page: Page,
  entry: {
    input: Record<string, unknown>;
    status: 'queued' | 'failed' | 'synced';
    enqueuedAt?: number;
    attempts?: number;
    lastError?: string;
  }
) {
  await page.addInitScript(async (e) => {
    const open = indexedDB.open('quicklogger', 1);
    await new Promise<void>((resolve, reject) => {
      open.onupgradeneeded = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains('pendingSubmissions')) {
          const store = db.createObjectStore('pendingSubmissions', {
            keyPath: 'id',
            autoIncrement: true
          });
          store.createIndex('byStatus', 'status');
        }
      };
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('pendingSubmissions', 'readwrite');
        const row: Record<string, unknown> = {
          input: e.input,
          status: e.status,
          attempts: e.attempts ?? 0,
          enqueuedAt: e.enqueuedAt ?? Date.now()
        };
        if (e.lastError !== undefined) row.lastError = e.lastError;
        tx.objectStore('pendingSubmissions').add(row);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      open.onerror = () => reject(open.error);
    });
  }, entry);
}

/**
 * Seed the per-vehicle localStorage cache the offline resolver reads.
 */
export async function seedLastFuelupCache(
  page: Page,
  vehicleId: number,
  snapshot: Record<string, unknown>
) {
  await page.addInitScript(
    ({ key, value }) => {
      localStorage.setItem(key, JSON.stringify(value));
    },
    { key: `quicklogger.lastFuelup.${vehicleId}`, value: snapshot }
  );
}
