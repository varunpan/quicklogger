// @vitest-environment node
//
// Regression guard for the build's supply-chain contract: the Node base image
// version and the npm install hardening. Like body-size-limit.test.ts, it reads
// the files that actually ship rather than a stand-in.
//
// History: through v0.3.4 every Dockerfile stage was `FROM node:24-alpine`, a
// floating major tag. Dependabot can only propose a newer tag than the one
// written down, and against a bare major the only newer tags are majors — which
// .github/dependabot.yml ignores — so no Node patch PR ever opened. Trivy doesn't
// flag the Node runtime itself either. v0.3.4 therefore shipped Node 24.21.0 and
// missed the 2026-10-21 Node security release (Brotli decoder RCE, TLS
// hostname-check bypasses), fixed in 24.22.1. Pinning the exact version is what
// makes the next Node security release show up as a Dependabot PR.
//
// The install hardening: dependency lifecycle scripts never run on install
// (`ignore-scripts`), freshly published versions wait out a release-age window
// (`min-release-age`), and git/tarball-URL dependencies are refused. The
// image's `deps` stage copies only package.json + package-lock.json, not
// `.npmrc`, so the Dockerfile must pass `--ignore-scripts` to `npm ci` itself.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dockerfile = readFileSync(join(repoRoot, 'Dockerfile'), 'utf8');
const npmrc = readFileSync(join(repoRoot, '.npmrc'), 'utf8');

// Image refs of every `FROM` whose repository is `node` (with or without a
// registry/namespace prefix such as `docker.io/library/`). Flags like
// `--platform=...` are skipped; `FROM <stage>` references don't match.
const nodeImages = [...dockerfile.matchAll(/^\s*FROM\s+(?:--\S+\s+)*(\S+)/gim)]
  .map((m) => m[1])
  .filter((ref) => /^(?:\S*\/)?node:/.test(ref));

// Exact MAJOR.MINOR.PATCH, optional variant suffix (`-alpine`), optional digest.
const EXACT_TAG = /:(\d+\.\d+\.\d+)(?:-[a-z0-9.]+)?(?:@sha256:[0-9a-f]{64})?$/;

// `.npmrc` as key -> value. Full-line `#` / `;` comments are skipped.
const npmConfig = new Map(
  npmrc
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !line.startsWith(';'))
    .map((line) => {
      const eq = line.indexOf('=');
      return [line.slice(0, eq).trim(), line.slice(eq + 1).trim()] as const;
    })
);

describe('Dockerfile Node base image', () => {
  it('builds every stage from a node image', () => {
    expect(nodeImages.length).toBeGreaterThan(0);
  });

  it('pins every node stage to an exact MAJOR.MINOR.PATCH, never a floating tag', () => {
    for (const ref of nodeImages) {
      expect(ref, `${ref} is a floating tag`).toMatch(EXACT_TAG);
    }
  });

  it('uses the same Node version in every stage', () => {
    const versions = nodeImages.map((ref) => ref.match(EXACT_TAG)?.[1]);
    expect(versions).not.toContain(undefined);
    expect(new Set(versions).size).toBe(1);
  });
});

describe('npm install hardening', () => {
  it('passes --ignore-scripts to every npm ci in the Dockerfile (the deps stage does not copy .npmrc)', () => {
    const installs = dockerfile.match(/\bnpm\s+ci\b[^\n]*/g) ?? [];
    expect(installs.length).toBeGreaterThan(0);
    for (const line of installs) {
      expect(line).toMatch(/\s--ignore-scripts\b/);
    }
  });

  it('.npmrc disables dependency lifecycle scripts', () => {
    expect(npmConfig.get('ignore-scripts')).toBe('true');
  });

  it('.npmrc sets a positive min-release-age window', () => {
    expect(Number(npmConfig.get('min-release-age'))).toBeGreaterThan(0);
  });

  it('.npmrc refuses git and tarball-URL dependencies', () => {
    expect(npmConfig.get('allow-git')).toBe('none');
    expect(npmConfig.get('allow-remote')).toBe('none');
  });
});
