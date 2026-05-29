// @vitest-environment node
//
// Regression guard for the v0.2.5 fix. The production `multipart parse failed`
// bug was a transport-layer body cap (`ENV BODY_SIZE_LIMIT=131072` = 128 KiB
// in the Dockerfile) sitting *below* the app's own image-size policy
// (OCR_MAX_IMAGE_MB, default 5 MiB). adapter-node truncated resized pump
// photos mid-stream, so `request.formData()` threw — but only in the
// container, never in `vite dev` (no cap) or UAT (512 KiB default).
//
// The invariant: the transport cap must NEVER be tighter than the image
// policy. Either disable it (0 = unlimited, the chosen fix) or keep it at or
// above the default image limit. This test fails loudly in CI the moment
// someone re-pins a tight cap, instead of the failure surfacing only in prod.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DEFAULT_OCR_MAX_IMAGE_MB } from '../../src/lib/server/env';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dockerfile = readFileSync(join(repoRoot, 'Dockerfile'), 'utf8');

describe('Dockerfile BODY_SIZE_LIMIT vs OCR image policy', () => {
  it('declares BODY_SIZE_LIMIT exactly once', () => {
    const matches = dockerfile.match(/^\s*ENV\s+BODY_SIZE_LIMIT=/gm) ?? [];
    expect(matches.length).toBe(1);
  });

  it('is 0 (disabled) or >= the default image policy — never below it', () => {
    const m = dockerfile.match(/^\s*ENV\s+BODY_SIZE_LIMIT=(\d+)/m);
    expect(m).not.toBeNull();
    const limit = Number(m![1]);
    const policyBytes = DEFAULT_OCR_MAX_IMAGE_MB * 1024 * 1024;
    // 0 = no transport cap; any positive value must clear the image policy.
    expect(limit === 0 || limit >= policyBytes).toBe(true);
  });
});
