export type ImageType = 'jpeg' | 'png' | 'webp' | 'heic';

export function sniffImageType(buf: Uint8Array): ImageType | null {
	// Minimum we need to look at any byte past index 11 (HEIC brand, WebP 'WEBP' marker).
	if (buf.length < 3) return null;
	// JPEG: FF D8 FF
	if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
	if (buf.length < 8) return null;
	// PNG: 89 50 4E 47 0D 0A 1A 0A
	if (
		buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
		buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
	) return 'png';
	if (buf.length < 12) return null;
	// WebP: 'RIFF' .... 'WEBP'
	if (
		buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
		buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
	) return 'webp';
	// HEIC: bytes 4..7 == 'ftyp', followed by a heic-family brand at 8..11
	if (
		buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70
	) {
		const brand = String.fromCharCode(buf[8], buf[9], buf[10], buf[11]);
		if (brand === 'heic' || brand === 'heix' || brand === 'mif1' || brand === 'msf1') return 'heic';
	}
	return null;
}
