// @vitest-environment node
//
// Regression guard for the BODY_SIZE_LIMIT contract.
//
// History: v0.2.5 fixed a 128 KiB transport cap (BODY_SIZE_LIMIT=131072) sitting
// *below* the app image policy, which truncated resized pump photos and surfaced
// as `400 multipart parse failed`. The chosen fix — "disable the cap" — was
// shipped as BODY_SIZE_LIMIT=0. But in @sveltejs/adapter-node `0` is a literal
// 0-byte limit: it REJECTS every request with a body (413), the opposite of
// "unlimited". To disable the cap you MUST use Infinity (the adapter even prints
// "specify Infinity rather than 0" on the 413). So v0.2.5's `0` was the wrong
// disable sentinel; v0.2.6 corrects the Dockerfile default to Infinity.
//
// The invariant: the transport cap must NEVER be tighter than the image policy,
// and `0` is NOT a valid "disabled" value. Either set Infinity (uncapped) or a
// finite value at/above the default image limit. Fails loudly in CI the moment
// someone re-pins a tight cap OR mistakes `0` for "unlimited".
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DEFAULT_OCR_MAX_IMAGE_MB } from '../../src/lib/server/env';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dockerfile = readFileSync(join(repoRoot, 'Dockerfile'), 'utf8');
const policyBytes = DEFAULT_OCR_MAX_IMAGE_MB * 1024 * 1024;

// Interpret the Dockerfile token the way adapter-node does for the values we ship:
// `Infinity` -> Infinity, plain integers -> that many bytes. A non-numeric token
// (e.g. an accidental `5M` suffix form) yields NaN and fails the validity check
// below — keep the Dockerfile value unambiguous.
function parseLimit(token: string): number {
  return token === 'Infinity' ? Infinity : Number(token);
}

describe('Dockerfile BODY_SIZE_LIMIT vs OCR image policy', () => {
  it('declares BODY_SIZE_LIMIT exactly once', () => {
    const matches = dockerfile.match(/^\s*ENV\s+BODY_SIZE_LIMIT=/gm) ?? [];
    expect(matches.length).toBe(1);
  });

  it('is Infinity (disabled) or a finite value >= the image policy — never 0 or below', () => {
    const m = dockerfile.match(/^\s*ENV\s+BODY_SIZE_LIMIT=(\S+)/m);
    expect(m).not.toBeNull();
    const limit = parseLimit(m![1]);
    expect(Number.isNaN(limit)).toBe(false);
    expect(limit === Infinity || limit >= policyBytes).toBe(true);
  });

  it('rejects 0 as a disabled value (adapter-node treats 0 as a 0-byte cap)', () => {
    // Documents the v0.2.5 mistake: 0 is reject-all, not unlimited.
    const zero = parseLimit('0');
    expect(zero === Infinity || zero >= policyBytes).toBe(false);
  });
});
