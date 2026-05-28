import type { Logger } from './logger';

// owner/repo slug — hardcoded, same repo as the +layout.svelte footer link.
// Not an env var (personal tool; matches the existing hardcoded footer).
const GITHUB_REPO = 'varunpan/quicklogger';
const TTL_MS = 60 * 60 * 1000; // 1 hour — releases are infrequent, deploy is manual
const TIMEOUT_MS = 3000;
const RELEASES_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

/** The two release fields we surface. `latestVersion` is the v-stripped tag. */
export interface GithubRelease {
  latestVersion: string;
  releaseUrl: string;
}

interface CacheState {
  checkedAt: number;
  release: GithubRelease | null;
}

// Module-level TTL cache. Persists across requests within one server process,
// bounding GitHub calls to <=1/hour (well under the 60/hour unauthenticated
// per-IP limit). Reset between unit tests via _resetReleaseCache().
let cache: CacheState | null = null;

/** Test-only: clear the module cache between cases. */
export function _resetReleaseCache(): void {
  cache = null;
}

export interface ReleaseDeps {
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/**
 * Latest published quicklogger GitHub release, or null when unknown.
 *
 * Never throws. Every failure (timeout, network, non-200, 404, malformed body)
 * is caught, logged via the request logger, and resolved to last-known-good
 * (or null on cold start). On any attempt we always stamp `checkedAt = now` so
 * a persistent outage retries ~once/hour, not once per request.
 */
export async function getLatestRelease(
  logger: Logger,
  deps: ReleaseDeps = {}
): Promise<GithubRelease | null> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now;

  if (cache && now() - cache.checkedAt < TTL_MS) {
    return cache.release;
  }

  const lastKnownGood = cache?.release ?? null;

  try {
    const res = await fetchImpl(RELEASES_URL, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });

    if (res.status === 404) {
      // No published releases yet — expected-ish, log quietly (info, not warn).
      logger.info('github-release: no published releases', { repo: GITHUB_REPO });
      cache = { checkedAt: now(), release: lastKnownGood };
      return cache.release;
    }
    if (!res.ok) {
      logger.warn('github-release: non-ok response', { repo: GITHUB_REPO, status: res.status });
      cache = { checkedAt: now(), release: lastKnownGood };
      return cache.release;
    }

    const body = (await res.json()) as { tag_name?: unknown; html_url?: unknown };
    if (typeof body.tag_name !== 'string' || typeof body.html_url !== 'string') {
      logger.warn('github-release: malformed payload', { repo: GITHUB_REPO });
      cache = { checkedAt: now(), release: lastKnownGood };
      return cache.release;
    }

    const release: GithubRelease = {
      latestVersion: body.tag_name.replace(/^v/, ''),
      releaseUrl: body.html_url
    };
    cache = { checkedAt: now(), release };
    return release;
  } catch (err) {
    const isTimeout = (err as Error).name === 'AbortError' || (err as Error).name === 'TimeoutError';
    if (isTimeout) {
      logger.warn('github-release: timeout', { repo: GITHUB_REPO, timeout_ms: TIMEOUT_MS, err });
    } else {
      logger.warn('github-release: fetch failed', { repo: GITHUB_REPO, err });
    }
    cache = { checkedAt: now(), release: lastKnownGood };
    return cache.release;
  }
}
