import type { Vehicle } from './lubelogger';

/**
 * Extract the VIN from a LubeLogger vehicle's `extraFields[]`.
 *
 * Returns the first non-empty value of any row whose `name`
 * matches "VIN" (case-insensitive, trimmed). Returns undefined
 * when no usable VIN row exists. Defensive against missing /
 * non-array `extraFields` and non-string `name` / `value` entries.
 */
export function extractVin(v: Vehicle): string | undefined {
	const fields = Array.isArray(v.extraFields) ? v.extraFields : [];
	for (const f of fields) {
		if (!f || typeof f !== 'object') continue;
		const rawName = (f as { name?: unknown }).name;
		if (typeof rawName !== 'string') continue;
		if (rawName.trim().toLowerCase() !== 'vin') continue;
		const rawValue = (f as { value?: unknown }).value;
		if (typeof rawValue !== 'string') continue;
		const trimmed = rawValue.trim();
		if (trimmed) return trimmed;
	}
	return undefined;
}

/**
 * Hoist a VIN out of `extraFields[]` into a top-level `vin` field
 * when present. Returns the original vehicle object unchanged when
 * no VIN is extractable — so JSON.stringify omits the `vin` key
 * entirely, keeping the wire additive for existing consumers.
 */
export function normalizeVehicleIdentifiers(v: Vehicle): Vehicle {
	const vin = extractVin(v);
	return vin ? { ...v, vin } : v;
}
