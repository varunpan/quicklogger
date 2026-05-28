import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { loadServerInfo, saveServerInfo } from './server-info';
import type { ServerInfo } from '$lib/shared/types';

const SAMPLE: ServerInfo = {
  reachable: true, status: 'ok', currentVersion: '1.6.5', latestVersion: '1.7.0',
  updateAvailable: true, locale: 'en-US', currencySymbol: '$',
  decimalSeparator: '.', dateFormat: 'M/d/yyyy',
  lubeloggerCurrency: 'USD',
  appCurrentVersion: '0.2.3', appLatestVersion: '0.2.4', appUpdateAvailable: true,
  appReleaseUrl: 'https://github.com/varunpan/quicklogger/releases/tag/v0.2.4'
};

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('server-info cache', () => {
  it('returns null when nothing is stored', () => {
    expect(loadServerInfo()).toBeNull();
  });
  it('round-trips a saved ServerInfo (including the cached-but-unused fields)', () => {
    saveServerInfo(SAMPLE);
    expect(loadServerInfo()).toEqual(SAMPLE);
  });
  it('returns null on malformed JSON', () => {
    localStorage.setItem('quicklogger-server-info', 'not json');
    expect(loadServerInfo()).toBeNull();
  });
  it('returns null when localStorage is undefined (SSR)', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(loadServerInfo()).toBeNull();
  });
  it('saveServerInfo is a no-op when localStorage is undefined (SSR)', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(() => saveServerInfo(SAMPLE)).not.toThrow();
  });
  it('tolerates absence of lubeloggerCurrency (older cache shape)', () => {
    const legacy = {
      reachable: true, status: 'ok', currentVersion: '1.6.5', latestVersion: '1.6.5',
      updateAvailable: false, locale: 'en-US', currencySymbol: '$',
      decimalSeparator: '.', dateFormat: 'M/d/yyyy'
      // no lubeloggerCurrency
    };
    localStorage.setItem('quicklogger-server-info', JSON.stringify(legacy));
    const got = loadServerInfo();
    expect(got).not.toBeNull();
    expect(got!.locale).toBe('en-US');
    expect((got as Partial<ServerInfo>).lubeloggerCurrency).toBeUndefined();
  });
  it('tolerates absence of app* fields (older cache shape)', () => {
    const legacy = {
      reachable: true, status: 'ok', currentVersion: '1.6.5', latestVersion: '1.6.5',
      updateAvailable: false, locale: 'en-US', currencySymbol: '$',
      decimalSeparator: '.', dateFormat: 'M/d/yyyy', lubeloggerCurrency: 'USD'
    };
    localStorage.setItem('quicklogger-server-info', JSON.stringify(legacy));
    const got = loadServerInfo();
    expect(got).not.toBeNull();
    expect((got as Partial<ServerInfo>).appUpdateAvailable).toBeUndefined();
  });
});
