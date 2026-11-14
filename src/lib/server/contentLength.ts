/**
 * Best-effort early rejection from the advertised Content-Length. The
 * transport runs with BODY_SIZE_LIMIT=Infinity (deliberate — see
 * photo-ocr.md), so without this a route buffers the entire body into memory
 * before any app-level check runs. Returns true only when the header is
 * present, numeric, positive, and exceeds `capBytes`; a missing / non-numeric
 * / lying header returns false so chunked bodies fall through to the
 * post-parse gates, which stay authoritative. Shared by `/api/fuelup`,
 * `/api/ocr` and `/api/odometer`.
 */
export function contentLengthExceeds(header: string | null, capBytes: number): boolean {
  if (header === null) return false;
  const n = Number(header);
  if (!Number.isFinite(n) || n <= 0) return false;
  return n > capBytes;
}
