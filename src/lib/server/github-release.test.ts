// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getLatestRelease, _resetReleaseCache } from './github-release';
import type { Logger } from './logger';

function makeLogger() {
  const calls = { debug: [] as unknown[], info: [] as unknown[], warn: [] as unknown[], error: [] as unknown[] };
  const logger = {
    debug: (...a: unknown[]) => calls.debug.push(a),
    info: (...a: unknown[]) => calls.info.push(a),
    warn: (...a: unknown[]) => calls.warn.push(a),
    error: (...a: unknown[]) => calls.error.push(a),
    child() { return this; }
  } as unknown as Logger;
  return { logger, calls };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const RELEASE = { tag_name: 'v0.2.4', html_url: 'https://github.com/varunpan/quicklogger/releases/tag/v0.2.4' };

beforeEach(() => _resetReleaseCache());

describe('getLatestRelease', () => {
  it('success: strips leading v, returns latestVersion + releaseUrl', async () => {
    const { logger } = makeLogger();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(RELEASE));
    const out = await getLatestRelease(logger, { fetchImpl, now: () => 1000 });
    expect(out).toEqual({ latestVersion: '0.2.4', releaseUrl: RELEASE.html_url });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.github.com/repos/varunpan/quicklogger/releases/latest',
      expect.objectContaining({ headers: { Accept: 'application/vnd.github+json' } })
    );
  });

  it('TTL: a second call within the window does not fetch again', async () => {
    const { logger } = makeLogger();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(RELEASE));
    let t = 1000;
    await getLatestRelease(logger, { fetchImpl, now: () => t });
    t = 1000 + 59 * 60 * 1000;
    const out = await getLatestRelease(logger, { fetchImpl, now: () => t });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(out?.latestVersion).toBe('0.2.4');
  });

  it('TTL: a call past the window fetches again', async () => {
    const { logger } = makeLogger();
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ tag_name: 'v0.2.4', html_url: 'https://example/a' }))
      .mockResolvedValueOnce(jsonResponse({ tag_name: 'v0.2.5', html_url: 'https://example/b' }));
    let t = 1000;
    await getLatestRelease(logger, { fetchImpl, now: () => t });
    t = 1000 + 61 * 60 * 1000;
    const out = await getLatestRelease(logger, { fetchImpl, now: () => t });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(out?.latestVersion).toBe('0.2.5');
  });

  it('404: returns null, logs info (not warn)', async () => {
    const { logger, calls } = makeLogger();
    const fetchImpl = vi.fn().mockResolvedValue(new Response('', { status: 404 }));
    const out = await getLatestRelease(logger, { fetchImpl, now: () => 1000 });
    expect(out).toBeNull();
    expect(calls.info.length).toBe(1);
    expect(calls.warn.length).toBe(0);
  });

  it('non-200 (500): returns null, logs warn', async () => {
    const { logger, calls } = makeLogger();
    const fetchImpl = vi.fn().mockResolvedValue(new Response('', { status: 500 }));
    const out = await getLatestRelease(logger, { fetchImpl, now: () => 1000 });
    expect(out).toBeNull();
    expect(calls.warn.length).toBe(1);
  });

  it('network failure: returns null, logs warn', async () => {
    const { logger, calls } = makeLogger();
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('ECONNREFUSED'));
    const out = await getLatestRelease(logger, { fetchImpl, now: () => 1000 });
    expect(out).toBeNull();
    expect(calls.warn.length).toBe(1);
  });

  it('timeout: returns null, logs warn', async () => {
    const { logger, calls } = makeLogger();
    const fetchImpl = vi.fn().mockRejectedValue(Object.assign(new Error('t'), { name: 'TimeoutError' }));
    const out = await getLatestRelease(logger, { fetchImpl, now: () => 1000 });
    expect(out).toBeNull();
    expect(calls.warn.length).toBe(1);
  });

  it('last-known-good retained when a post-success refresh fails', async () => {
    const { logger } = makeLogger();
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ tag_name: 'v0.2.4', html_url: 'https://example/a' }))
      .mockRejectedValueOnce(new TypeError('ECONNREFUSED'));
    let t = 1000;
    await getLatestRelease(logger, { fetchImpl, now: () => t });
    t = 1000 + 61 * 60 * 1000;
    const out = await getLatestRelease(logger, { fetchImpl, now: () => t });
    expect(out).toEqual({ latestVersion: '0.2.4', releaseUrl: 'https://example/a' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('malformed payload (missing tag_name): returns null, logs warn', async () => {
    const { logger, calls } = makeLogger();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ html_url: 'https://example/x' }));
    const out = await getLatestRelease(logger, { fetchImpl, now: () => 1000 });
    expect(out).toBeNull();
    expect(calls.warn.length).toBe(1);
  });
});
