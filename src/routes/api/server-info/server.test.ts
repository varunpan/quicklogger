// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { GET, _buildServerInfo, _isUpdateAvailable } from './+server';
import { _resetReleaseCache, type GithubRelease } from '$lib/server/github-release';
import type { LubeLoggerInfo, LubeLoggerVersion } from '$lib/server/lubelogger';
import { LubeLoggerError } from '$lib/server/lubelogger';

const upstream = setupServer();
beforeAll(() => upstream.listen({ onUnhandledRequest: 'error' }));
afterEach(() => upstream.resetHandlers());
afterAll(() => upstream.close());

beforeAll(() => {
	process.env.LUBELOGGER_URL = 'http://lubelog:8080';
	process.env.LUBELOGGER_API_KEY = 'k';
});

const noopLogger = {
	debug: () => {}, info: () => {}, warn: () => {}, error: () => {},
	child() { return this; }
} as unknown as import('$lib/server/logger').Logger;

function event() {
	return { locals: { logger: noopLogger, requestId: 't' } } as unknown as Parameters<typeof GET>[0];
}

const INFO = {
	currentVersion: '1.6.5', locale: 'en-US', currencySymbol: '$',
	decimalSeparator: '.', dateFormat: 'M/d/yyyy'
};

const GH_URL = 'https://api.github.com/repos/varunpan/quicklogger/releases/latest';
const GH_RELEASE = { tag_name: 'v0.2.4', html_url: 'https://github.com/varunpan/quicklogger/releases/tag/v0.2.4' };
const NO_RELEASE: PromiseSettledResult<GithubRelease | null> = { status: 'fulfilled', value: null };

afterEach(() => _resetReleaseCache());

describe('_isUpdateAvailable', () => {
	it('latest > current → true', () => {
		expect(_isUpdateAvailable('1.6.5', '1.7.0')).toBe(true);
	});
	it('equal → false', () => {
		expect(_isUpdateAvailable('1.6.5', '1.6.5')).toBe(false);
	});
	it('latest < current → false', () => {
		expect(_isUpdateAvailable('1.7.0', '1.6.5')).toBe(false);
	});
	it('missing version → false', () => {
		expect(_isUpdateAvailable(null, '1.7.0')).toBe(false);
		expect(_isUpdateAvailable('1.6.5', null)).toBe(false);
	});
	it('non-numeric suffix → false (never throws)', () => {
		expect(_isUpdateAvailable('1.6.5', '1.7.0-beta')).toBe(false);
	});
	it('differing-length compare treats missing parts as 0', () => {
		expect(_isUpdateAvailable('1.6', '1.6.5')).toBe(true);
		expect(_isUpdateAvailable('1.6.5', '1.6')).toBe(false);
	});
});

describe('_buildServerInfo', () => {
	it('both fulfilled → reachable, ok, merged fields', () => {
		const out = _buildServerInfo(
			{ status: 'fulfilled', value: INFO as LubeLoggerInfo },
			{ status: 'fulfilled', value: { currentVersion: '1.6.5', latestVersion: '1.7.0' } as LubeLoggerVersion },
			'USD',
			NO_RELEASE,
			null
		);
		expect(out).toEqual({
			reachable: true, status: 'ok', currentVersion: '1.6.5', latestVersion: '1.7.0',
			updateAvailable: true, locale: 'en-US', currencySymbol: '$',
			decimalSeparator: '.', dateFormat: 'M/d/yyyy', lubeloggerCurrency: 'USD',
			appCurrentVersion: null, appLatestVersion: null, appUpdateAvailable: false, appReleaseUrl: null
		});
	});

	it('release fulfilled + newer version → app fields populated, appUpdateAvailable true', () => {
		const out = _buildServerInfo(
			{ status: 'fulfilled', value: INFO as LubeLoggerInfo },
			{ status: 'fulfilled', value: { currentVersion: '1.6.5', latestVersion: '1.6.5' } as LubeLoggerVersion },
			'USD',
			{ status: 'fulfilled', value: { latestVersion: '0.2.4', releaseUrl: 'https://example/r' } },
			'0.2.3'
		);
		expect(out.appCurrentVersion).toBe('0.2.3');
		expect(out.appLatestVersion).toBe('0.2.4');
		expect(out.appUpdateAvailable).toBe(true);
		expect(out.appReleaseUrl).toBe('https://example/r');
		expect(out.currentVersion).toBe('1.6.5');
		expect(out.reachable).toBe(true);
	});

	it('release rejected → app fields null/false, LubeLogger fields intact', () => {
		const out = _buildServerInfo(
			{ status: 'fulfilled', value: INFO as LubeLoggerInfo },
			{ status: 'fulfilled', value: { currentVersion: '1.6.5', latestVersion: '1.6.5' } as LubeLoggerVersion },
			'USD',
			{ status: 'rejected', reason: new Error('boom') },
			'0.2.3'
		);
		expect(out.appLatestVersion).toBeNull();
		expect(out.appReleaseUrl).toBeNull();
		expect(out.appUpdateAvailable).toBe(false);
		expect(out.currentVersion).toBe('1.6.5');
	});
	it('info fulfilled, version rejected → reachable, ok, latestVersion null', () => {
		const out = _buildServerInfo(
			{ status: 'fulfilled', value: INFO as LubeLoggerInfo },
			{ status: 'rejected', reason: new LubeLoggerError(404, '') },
			'USD',
			NO_RELEASE,
			null
		);
		expect(out.reachable).toBe(true);
		expect(out.status).toBe('ok');
		expect(out.currentVersion).toBe('1.6.5');
		expect(out.latestVersion).toBeNull();
		expect(out.updateAvailable).toBe(false);
		expect(out.locale).toBe('en-US');
	});
	it('version fulfilled, info rejected → reachable, ok, locale null', () => {
		const out = _buildServerInfo(
			{ status: 'rejected', reason: new LubeLoggerError(404, '') },
			{ status: 'fulfilled', value: { currentVersion: '1.6.5', latestVersion: '1.6.5' } as LubeLoggerVersion },
			'USD',
			NO_RELEASE,
			null
		);
		expect(out.reachable).toBe(true);
		expect(out.currentVersion).toBe('1.6.5');
		expect(out.latestVersion).toBe('1.6.5');
		expect(out.locale).toBeNull();
	});
	it('both 401 → unreachable=false, unauthorized, null data', () => {
		const out = _buildServerInfo(
			{ status: 'rejected', reason: new LubeLoggerError(401, '') },
			{ status: 'rejected', reason: new LubeLoggerError(401, '') },
			'USD',
			NO_RELEASE,
			null
		);
		expect(out.reachable).toBe(false);
		expect(out.status).toBe('unauthorized');
		expect(out.currentVersion).toBeNull();
		expect(out.latestVersion).toBeNull();
		expect(out.updateAvailable).toBe(false);
	});
	it('both 404 → unreachable', () => {
		const out = _buildServerInfo(
			{ status: 'rejected', reason: new LubeLoggerError(404, '') },
			{ status: 'rejected', reason: new LubeLoggerError(404, '') },
			'USD',
			NO_RELEASE,
			null
		);
		expect(out.reachable).toBe(false);
		expect(out.status).toBe('unreachable');
	});
	it('mixed 401 + non-LubeLoggerError → unreachable (not all 401)', () => {
		const out = _buildServerInfo(
			{ status: 'rejected', reason: new LubeLoggerError(401, '') },
			{ status: 'rejected', reason: new TypeError('ECONNREFUSED') },
			'USD',
			NO_RELEASE,
			null
		);
		expect(out.status).toBe('unreachable');
	});
});

describe('GET /api/server-info', () => {
	it('both upstream calls succeed → 200, reachable, ok', async () => {
		upstream.use(
			http.get('http://lubelog:8080/api/info', () => HttpResponse.json(INFO)),
			http.get('http://lubelog:8080/api/version', () =>
				HttpResponse.json({ currentVersion: '1.6.5', latestVersion: '1.6.5' })),
			http.get(GH_URL, () => HttpResponse.json(GH_RELEASE))
		);
		const res = await GET(event());
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toMatchObject({ reachable: true, status: 'ok', currentVersion: '1.6.5', updateAvailable: false });
	});

	it('update available surfaces through the route', async () => {
		upstream.use(
			http.get('http://lubelog:8080/api/info', () => HttpResponse.json(INFO)),
			http.get('http://lubelog:8080/api/version', () =>
				HttpResponse.json({ currentVersion: '1.6.5', latestVersion: '1.7.0' })),
			http.get(GH_URL, () => HttpResponse.json(GH_RELEASE))
		);
		const res = await GET(event());
		const body = await res.json();
		expect(body.updateAvailable).toBe(true);
		expect(body.latestVersion).toBe('1.7.0');
	});

	it('both 401 → 200 with status unauthorized and null data', async () => {
		upstream.use(
			http.get('http://lubelog:8080/api/info', () => new HttpResponse('', { status: 401 })),
			http.get('http://lubelog:8080/api/version', () => new HttpResponse('', { status: 401 })),
			http.get(GH_URL, () => HttpResponse.json(GH_RELEASE))
		);
		const res = await GET(event());
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toMatchObject({ reachable: false, status: 'unauthorized', currentVersion: null });
	});

	it('both 404 → 200 with status unreachable', async () => {
		upstream.use(
			http.get('http://lubelog:8080/api/info', () => new HttpResponse('', { status: 404 })),
			http.get('http://lubelog:8080/api/version', () => new HttpResponse('', { status: 404 })),
			http.get(GH_URL, () => HttpResponse.json(GH_RELEASE))
		);
		const res = await GET(event());
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.status).toBe('unreachable');
	});

	it('surfaces env.lubeloggerCurrency in the response', async () => {
		process.env.LUBELOGGER_CURRENCY = 'CAD';
		upstream.use(
			http.get('http://lubelog:8080/api/info', () => HttpResponse.json(INFO)),
			http.get('http://lubelog:8080/api/version', () =>
				HttpResponse.json({ currentVersion: '1.6.5', latestVersion: '1.6.5' })),
			http.get(GH_URL, () => HttpResponse.json(GH_RELEASE))
		);
		try {
			const res = await GET(event());
			const body = await res.json();
			expect(body.lubeloggerCurrency).toBe('CAD');
		} finally {
			delete process.env.LUBELOGGER_CURRENCY;
		}
	});

	it('GitHub failure leaves LubeLogger fields intact, still 200', async () => {
		upstream.use(
			http.get('http://lubelog:8080/api/info', () => HttpResponse.json(INFO)),
			http.get('http://lubelog:8080/api/version', () =>
				HttpResponse.json({ currentVersion: '1.6.5', latestVersion: '1.6.5' })),
			http.get(GH_URL, () => new HttpResponse('', { status: 500 }))
		);
		const res = await GET(event());
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.currentVersion).toBe('1.6.5');
		expect(body.appLatestVersion).toBeNull();
		expect(body.appUpdateAvailable).toBe(false);
	});
});
