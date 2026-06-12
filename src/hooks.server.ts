import type { Handle } from '@sveltejs/kit';
import { building } from '$app/environment';
import { loadEnv } from '$lib/server/env';
import { bootLogger, getLogger } from '$lib/server/logger';
import { selectProvider } from '$lib/server/ocr';

const SILENCED_PATHS = new Set(['/healthz', '/service-worker.js', '/favicon.ico']);
function isSilencedPath(pathname: string): boolean {
  if (SILENCED_PATHS.has(pathname)) return true;
  if (pathname.startsWith('/_app/')) return true;
  return false;
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Defense-in-depth CSRF (review #17). SvelteKit's built-in origin check
// (kit.csrf.checkOrigin, default on) only fires for *form* content-types, so a
// cross-site `application/json` POST to /api/fuelup|ocr|log slips past it. We
// reject any mutating request whose `Origin` header is present AND does not
// match the app's own origin — which, under adapter-node, IS the configured
// ORIGIN env in production (and the request origin in dev), the same source
// SvelteKit's own check trusts. A *missing* Origin is deliberately allowed: it
// never comes from a browser (no CSRF vector — the app holds no cookie/session
// to abuse) and is exactly what non-browser clients like Apple Shortcuts send.
// SvelteKit's stricter form-type handling still runs inside resolve(), so this
// only adds coverage, never removes it. Exported for tests (underscore prefix
// keeps SvelteKit's endpoint-export validation happy).
export function _originBlocked(method: string, origin: string | null, expected: string): boolean {
  if (!MUTATING_METHODS.has(method)) return false;
  if (origin === null) return false;
  return origin !== expected;
}

export function _newRequestId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

let _booted = false;
function ensureBoot() {
  if (_booted) return;
  const env = loadEnv();
  bootLogger(env);
  getLogger().info('server start', {
    version: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'unknown',
    node_env: process.env.NODE_ENV ?? 'development',
    lubelogger_host: safeHost(env.lubeloggerUrl),
    ocr_providers: ocrProvidersList(env),
    fx_providers: env.fxProviders,
    log_file_enabled: Boolean(env.logFilePath)
  });
  // Warm the OCR provider chain so the `ocr chain effective` line is emitted
  // once at boot (next to `server start`) instead of riding on the first
  // request. Memoization inside selectProvider keeps subsequent per-request
  // calls silent for the same composition. Safe no-op when 0 or 1 slots
  // survive — those branches don't emit a chain-effective line at all.
  selectProvider(env, getLogger());
  _booted = true;
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '[invalid]';
  }
}

function ocrProvidersList(env: ReturnType<typeof loadEnv>): string[] {
  const out: string[] = [];
  if (env.ollamaVisionUrl) out.push('ollama-local');
  if (env.ollamaCloudApiKey) out.push('ollama-cloud');
  if (env.openrouterApiKey) out.push('openrouter');
  if (env.openaiCompatibleApiKey && env.openaiCompatibleUrl && env.openaiCompatibleModel) {
    out.push('openai-compatible');
  }
  return out;
}

function levelFromStatus(status: number): 'info' | 'warn' | 'error' {
  if (status >= 500) return 'error';
  if (status === 404) return 'info';
  if (status >= 400) return 'warn';
  return 'info';
}

export const handle: Handle = async ({ event, resolve }) => {
  // During the build-time prerender pass (`/offline`) there is no runtime env;
  // ensureBoot → loadEnv() would throw `LUBELOGGER_URL not set` and fail the
  // Docker/CI build. `/offline` is ssr=false with no server load, so resolve()
  // only emits the static shell and never touches locals/env.
  if (building) return resolve(event);
  ensureBoot();
  const requestId = _newRequestId();
  event.locals.requestId = requestId;
  event.locals.logger = getLogger().child({
    request_id: requestId,
    route: event.route?.id ?? null
  });

  const t0 = Date.now();
  let response: Response;
  const origin = event.request.headers.get('origin');
  if (_originBlocked(event.request.method, origin, event.url.origin)) {
    event.locals.logger.warn('csrf origin mismatch', {
      method: event.request.method,
      path: event.url.pathname,
      origin,
      expected: event.url.origin
    });
    response = new Response(JSON.stringify({ error: 'origin not allowed' }), {
      status: 403,
      headers: { 'content-type': 'application/json' }
    });
  } else {
    try {
      response = await resolve(event);
    } catch (err) {
      event.locals.logger.error('handler threw', { err });
      response = new Response('Internal Error', { status: 500 });
    }
  }

  if (!response.headers.get('x-request-id')) {
    response = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    });
    response.headers.set('X-Request-ID', requestId);
  }

  const path = event.url.pathname;
  if (!isSilencedPath(path)) {
    const duration_ms = Date.now() - t0;
    const level = levelFromStatus(response.status);
    event.locals.logger[level]('request', {
      method: event.request.method,
      path,
      status: response.status,
      duration_ms
    });
  }

  return response;
};
