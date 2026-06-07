import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Live-SW test (see the file header in the plan). Runs its own adapter-node
// server + LubeLogger upstream stub on private ports, independent of the global
// vite-preview webServer the rest of the suite uses.
const APP_PORT = 4393;
const UP_PORT = 4394;
const APP = `http://127.0.0.1:${APP_PORT}`;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

let upstream: Server;
let app: ChildProcess;

test.describe.configure({ mode: 'serial' });
// Drive a REAL service worker here; do NOT block it. Point baseURL at our server.
test.use({ serviceWorkers: 'allow', baseURL: APP });

test.beforeAll(async () => {
  // Minimal LubeLogger upstream: only what the home loader needs to succeed.
  upstream = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    res.setHeader('content-type', 'application/json');
    if (url.pathname === '/api/vehicles') {
      res.end(JSON.stringify([{ id: 1, year: 2019, make: 'Honda', model: 'Civic Si' }]));
    } else {
      res.end('[]'); // gasrecords (no prior fuelup), info, version, etc.
    }
  });
  await new Promise<void>((r) => upstream.listen(UP_PORT, r));

  // `build/` already exists — the global webServer ran `npm run build` first.
  app = spawn('node', ['build'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(APP_PORT),
      ORIGIN: APP,
      LUBELOGGER_URL: `http://127.0.0.1:${UP_PORT}`,
      LUBELOGGER_API_KEY: 'e2e',
      NODE_ENV: 'production'
    },
    stdio: 'ignore'
  });

  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      const r = await fetch(APP + '/healthz');
      if (r.status === 200 || r.status === 503) break; // listening (503 = upstream probe semantics)
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error('node build server did not start');
    await new Promise((r) => setTimeout(r, 300));
  }
});

test.afterAll(async () => {
  app?.kill('SIGKILL');
  await new Promise<void>((r) => upstream.close(() => r()));
});

test('offline cold-start renders the populated form and queues a submit', async ({
  page,
  context
}) => {
  // Smart checks off → an offline submit with no prior fuelup is deterministic
  // (checks D/G can fire without a `last` record). Currency stays USD (no FX).
  await context.addInitScript(() => {
    localStorage.setItem('quicklogger.prefs', JSON.stringify({ smartChecksEnabled: false }));
  });

  // 1. Online warm-up: register the SW, precache the shell, fill API_CACHE.
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  // The very first load's fetches run before the SW controls the page, so reload
  // once to route /api/vehicles through the SW and populate the API cache.
  await page.reload();
  await expect(page.getByText('2019 Honda Civic Si')).toBeVisible();
  await page.waitForFunction(async () => {
    const c = await caches.open('quicklogger-api-cache-v1');
    return Boolean(await c.match('/api/vehicles'));
  });

  // 2. Go offline and cold-start a brand-new page (the real fix path).
  await context.setOffline(true);
  const cold = await context.newPage();
  await cold.goto('/');

  // 3. The real form renders from the shell + the cached vehicle list.
  await expect(cold.getByText('2019 Honda Civic Si')).toBeVisible();
  await expect(cold.getByTestId('offline-banner')).toBeVisible();
  await expect(cold.getByRole('button', { name: 'Save offline' })).toBeVisible();

  // 4. Fill the form and save — POST fails offline, so it queues.
  await cold.getByPlaceholder('87,432').fill('87900');
  await cold.getByPlaceholder('11.2').fill('11.5');
  await cold.getByPlaceholder('42.18').fill('42.18');
  await cold.getByRole('button', { name: 'Save offline' }).click();
  await expect(cold.getByText(/Saved locally/)).toBeVisible();

  // 5. The submission is in the IndexedDB queue.
  const queued = await cold.evaluate(async () => {
    const db: IDBDatabase = await new Promise((res, rej) => {
      const open = indexedDB.open('quicklogger', 1);
      open.onsuccess = () => res(open.result);
      open.onerror = () => rej(open.error);
    });
    const count: number = await new Promise((res, rej) => {
      const rq = db.transaction('pendingSubmissions', 'readonly').objectStore('pendingSubmissions').count();
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error);
    });
    db.close();
    return count;
  });
  expect(queued).toBeGreaterThan(0);
});
