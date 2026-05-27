import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadEnv } from '$lib/server/env';
import {
  LubeLoggerClient,
  LubeLoggerError,
  type LubeLoggerInfo,
  type LubeLoggerVersion
} from '$lib/server/lubelogger';
import type { ServerInfo } from '$lib/shared/types';

const UNREACHABLE: ServerInfo = {
  reachable: false,
  status: 'unreachable',
  currentVersion: null,
  latestVersion: null,
  updateAvailable: false,
  locale: null,
  currencySymbol: null,
  decimalSeparator: null,
  dateFormat: null
};

/** Guarded numeric semver compare. Returns false on missing versions, any
 *  non-integer part (e.g. a `-beta` suffix), or latest <= current. Never throws.
 *  Missing trailing parts are treated as 0 ("1.6" === "1.6.0"). */
export function _isUpdateAvailable(current: string | null, latest: string | null): boolean {
  if (!current || !latest) return false;
  const cur = current.split('.').map(Number);
  const lat = latest.split('.').map(Number);
  if (![...cur, ...lat].every((n) => Number.isInteger(n))) return false;
  const len = Math.max(cur.length, lat.length);
  for (let i = 0; i < len; i++) {
    const c = cur[i] ?? 0;
    const l = lat[i] ?? 0;
    if (l > c) return true;
    if (l < c) return false;
  }
  return false;
}

/** Merge the two settled upstream results into the public ServerInfo. */
export function _buildServerInfo(
  infoR: PromiseSettledResult<LubeLoggerInfo>,
  versionR: PromiseSettledResult<LubeLoggerVersion>
): ServerInfo {
  const info = infoR.status === 'fulfilled' ? infoR.value : null;
  const version = versionR.status === 'fulfilled' ? versionR.value : null;
  const reachable = info !== null || version !== null;

  let status: ServerInfo['status'];
  if (reachable) {
    status = 'ok';
  } else {
    const rejections = [infoR, versionR].filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected'
    );
    const allUnauthorized =
      rejections.length > 0 &&
      rejections.every((r) => r.reason instanceof LubeLoggerError && r.reason.status === 401);
    status = allUnauthorized ? 'unauthorized' : 'unreachable';
  }

  const currentVersion = version?.currentVersion ?? info?.currentVersion ?? null;
  const latestVersion = version?.latestVersion ?? null;

  return {
    reachable,
    status,
    currentVersion,
    latestVersion,
    updateAvailable: _isUpdateAvailable(currentVersion, latestVersion),
    locale: info?.locale ?? null,
    currencySymbol: info?.currencySymbol ?? null,
    decimalSeparator: info?.decimalSeparator ?? null,
    dateFormat: info?.dateFormat ?? null
  };
}

// Health probe: "I checked and it's down" is a successful result, so this
// route always returns HTTP 200 — deliberately different from the app's
// data-serving routes, which propagate upstream errors as non-2xx.
export const GET: RequestHandler = async ({ locals }) => {
  try {
    const env = loadEnv();
    const client = new LubeLoggerClient({
      baseUrl: env.lubeloggerUrl,
      apiKey: env.lubeloggerApiKey,
      logger: locals.logger
    });
    const [infoR, versionR] = await Promise.allSettled([client.getInfo(), client.getVersion()]);
    return json(_buildServerInfo(infoR, versionR));
  } catch (err) {
    // loadEnv() misconfiguration or any unexpected throw — report unreachable
    // rather than 500, to keep the Settings block's contract (always parseable).
    locals.logger.warn('server-info: probe failed to build', { err });
    return json(UNREACHABLE);
  }
};
