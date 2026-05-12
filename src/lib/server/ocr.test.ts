import { describe, it, expect } from 'vitest';
import { sniffImageType } from './ocr';

const JPEG_HEAD = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const WEBP_HEAD = Buffer.concat([
  Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP')
]);
const HEIC_HEAD = Buffer.concat([
  Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic')
]);
const NOT_AN_IMAGE = Buffer.from('this is plain text bytes...');

describe('sniffImageType', () => {
  it('detects JPEG by magic bytes', () => expect(sniffImageType(JPEG_HEAD)).toBe('jpeg'));
  it('detects PNG by magic bytes', () => expect(sniffImageType(PNG_HEAD)).toBe('png'));
  it('detects WebP by RIFF/WEBP', () => expect(sniffImageType(WEBP_HEAD)).toBe('webp'));
  it('detects HEIC by ftyp box', () => expect(sniffImageType(HEIC_HEAD)).toBe('heic'));
  it('returns null for non-image bytes', () => expect(sniffImageType(NOT_AN_IMAGE)).toBeNull());
  it('returns null for too-short buffers', () => expect(sniffImageType(Buffer.from([0xff]))).toBeNull());
});
