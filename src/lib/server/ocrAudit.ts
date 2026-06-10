import { appendFile, stat, truncate, mkdir } from 'node:fs/promises';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { withPathLock } from './atomicFile';
import type { OcrMode, OcrResult } from '$lib/shared/types';
import type { OcrSlotName } from './env';
import type { Logger } from './logger';

const NOOP_LOGGER: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child() { return this; }
};

export interface AuditCropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AuditRecord {
  mode: OcrMode;
  rotationApplied: number;
  cropApplied: boolean;
  cropRect: AuditCropRect | null;
  // Optional — present only when the client passed `lastOdometerMi` on an
  // odometer-mode request. Forensic field: pairs with `parsed.odometer`
  // to surface "model dropped the leading digit despite the hint" cases.
  lastOdometerMi?: number;
  ipHash: string;
  imgHash: string;
  imgBytes: number;
  imageType: 'jpeg' | 'png' | 'webp' | 'heic';
  provider: OcrSlotName;
  model: string;
  fellbackFrom: OcrSlotName | null;
  latencyMs: number;
  costCents: number;
  parsed: OcrResult | null;
  ok: boolean;
  error?: { code: string; message: string };
}

interface Options {
  path: string;
  maxBytes: number;
  logger?: Logger;
}

export class OcrAudit {
  private readonly log: Logger;
  constructor(private readonly opts: Options) {
    this.log = opts.logger ?? NOOP_LOGGER;
  }

  async append(rec: AuditRecord): Promise<void> {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...rec }) + '\n';
    try {
      // Serialize the rotate-then-append per file. Without the lock, concurrent
      // appends all stat the same size, all skip the truncate, and overshoot
      // maxBytes — or a truncate drops a line another append just wrote.
      await withPathLock(this.opts.path, async () => {
        await mkdir(dirname(this.opts.path), { recursive: true });
        try {
          const st = await stat(this.opts.path);
          if (st.size + line.length > this.opts.maxBytes) {
            await truncate(this.opts.path, 0);
          }
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
        }
        await appendFile(this.opts.path, line, 'utf-8');
      });
    } catch (err) {
      this.log.error('ocr audit append failed', { err, path: this.opts.path });
      // Swallow — audit failures must not crash a successful OCR response.
    }
  }
}

// HMAC-SHA-256 keyed by the audit HMAC key (env override or auto-generated
// file). Truncated to 16 hex chars (64 bits) — enough collision-resistance
// for de-duplication at homelab scale, short enough to read at a glance.
export function hashIp(ip: string, key: Buffer): string {
  const mac = createHmac('sha256', key).update(ip).digest('hex');
  return `sha256:${mac.slice(0, 16)}`;
}

export function hashImage(bytes: Buffer | Uint8Array): string {
  const h = createHash('sha256').update(bytes).digest('hex');
  return `sha256:${h}`;
}

interface KeyOptions {
  ocrAuditHmacKey: string | undefined;
  ocrAuditKeyPath: string;
  logger?: Logger;
}

export function resolveAuditHmacKey(opts: KeyOptions): Buffer {
  const log = opts.logger ?? NOOP_LOGGER;
  if (opts.ocrAuditHmacKey) return Buffer.from(opts.ocrAuditHmacKey, 'utf-8');
  try {
    return readFileSync(opts.ocrAuditKeyPath);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code !== 'ENOENT') {
      log.error('ocr audit key read failed', { err, path: opts.ocrAuditKeyPath });
      throw err;
    }
  }
  try {
    const key = randomBytes(32);
    mkdirSync(dirname(opts.ocrAuditKeyPath), { recursive: true });
    writeFileSync(opts.ocrAuditKeyPath, key, { mode: 0o600 });
    return key;
  } catch (err) {
    log.error('ocr audit key generation failed', { err, path: opts.ocrAuditKeyPath });
    throw err;
  }
}
