import { appendFile, stat, truncate, mkdir } from 'node:fs/promises';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import type { OcrMode, OcrResult } from '$lib/shared/types';

export interface AuditRecord {
  mode: OcrMode;
  ipHash: string;
  imgHash: string;
  imgBytes: number;
  imageType: 'jpeg' | 'png' | 'webp' | 'heic';
  provider: 'ollama' | 'openrouter';
  model: string;
  fellbackTo: 'ollama' | 'openrouter' | null;
  latencyMs: number;
  costCents: number;
  parsed: OcrResult | null;
  ok: boolean;
  error?: { code: string; message: string };
}

interface Options {
  path: string;
  maxBytes: number;
}

export class OcrAudit {
  constructor(private readonly opts: Options) {}

  async append(rec: AuditRecord): Promise<void> {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...rec }) + '\n';
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
}

export function resolveAuditHmacKey(opts: KeyOptions): Buffer {
  if (opts.ocrAuditHmacKey) return Buffer.from(opts.ocrAuditHmacKey, 'utf-8');
  try {
    return readFileSync(opts.ocrAuditKeyPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  const key = randomBytes(32);
  writeFileSync(opts.ocrAuditKeyPath, key, { mode: 0o600 });
  return key;
}
