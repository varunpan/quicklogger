export interface Vehicle {
	id: number;
	year?: number;
	make?: string;
	model?: string;
	licensePlate?: string;
	vin?: string;
	[key: string]: unknown;
}

/** Shape returned by GET /api/vehicle/gasrecords under `culture-invariant: true`.
 *  Typed primitives (numbers, booleans); ISO `YYYY-MM-DD` dates; `notes` may
 *  be null. All fields verified always-present against LubeLogger v1.6.5
 *  during design (no `absent_in > 0` across 75 sampled records). */
export interface GasRecord {
	id: number;
	vehicleId: number;
	date: string;           // ISO YYYY-MM-DD
	odometer: number;
	fuelConsumed: number;
	cost: number;           // always present
	fuelEconomy: number;    // always present, 0 when not computed
	isFillToFull: boolean;
	missedFuelUp: boolean;
	notes: string | null;   // can be null
	tags: string;           // always present, possibly ""
	extraFields: unknown[];
	files: unknown[];
}

export type ReminderUrgency = 'NotUrgent' | 'Urgent' | 'VeryUrgent' | 'PastDue';
export type ReminderMetric = 'Odometer' | 'Date' | 'Both';

/** Shape returned by GET /api/vehicle/reminders under `culture-invariant: true`.
 *  Typed primitives; ISO `YYYY-MM-DD` dueDate; `notes` may be null. Every
 *  field always-present in the upstream payload (verified during design). */
export interface Reminder {
	id: number;
	vehicleId: number;
	description: string;
	urgency: ReminderUrgency;
	metric: ReminderMetric;
	userMetric: ReminderMetric;
	notes: string | null;   // can be null
	dueDate: string;        // ISO YYYY-MM-DD
	dueOdometer: number;
	dueDays: number;        // negative = overdue
	dueDistance: number;    // negative = overdue
	tags: string;           // always present, possibly ""
}

/** Shape returned by GET /api/info. Flat, all-string (verified against
 *  LubeLogger v1.6.5 during design). `currentVersion` is repeated here and
 *  on /api/version. The locale/currency/format fields are consumed by
 *  format.ts for client-side rendering (locale, currencySymbol, dateFormat). */
export interface LubeLoggerInfo {
	currentVersion: string;
	locale: string;
	currencySymbol: string;
	decimalSeparator: string;
	dateFormat: string;
	[key: string]: unknown;
}

/** Shape returned by GET /api/version. The only endpoint carrying
 *  `latestVersion` (drives the update-available check). */
export interface LubeLoggerVersion {
	currentVersion: string;
	latestVersion: string;
	[key: string]: unknown;
}

/** Form-data payload accepted by POST /api/vehicle/gasrecords/add (LubeLogger
 *  is case-insensitive on the form-data field names; we send lowercase). */
export interface AddGasRecordPayload {
	date: string;
	odometer: string;
	fuelconsumed: string;
	isfilltofull: string;
	missedfuelup: string;
	cost?: string;
	notes?: string;
	tags?: string;
}

/** One uploaded document as returned by `POST /api/documents/upload` and
 *  accepted nested under the JSON add-gas-record body's `files` array.
 *  `location` is the server-assigned GUID path; `name` is a display label
 *  only — LubeLogger stores by `location`, so duplicate names never collide. */
export interface UploadedFile {
	name: string;
	location: string;
	isPending: boolean;
}

export class LubeLoggerError extends Error {
	constructor(
		public readonly status: number,
		public readonly body: string
	) {
		super(`LubeLogger ${status}: ${body.slice(0, 200)}`);
		this.name = 'LubeLoggerError';
	}
}

import type { Logger } from './logger';

interface Options {
	baseUrl: string;
	apiKey: string;
	fetchImpl?: typeof fetch;
	timeoutMs?: number;
	logger?: Logger;
}

const NOOP_LOGGER: Logger = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
	child() { return this; }
};

export class LubeLoggerClient {
	private readonly fetchImpl: typeof fetch;
	private readonly timeoutMs: number;
	private readonly logger: Logger;

	constructor(private readonly opts: Options) {
		this.fetchImpl = opts.fetchImpl ?? fetch;
		this.timeoutMs = opts.timeoutMs ?? 5_000;
		this.logger = opts.logger ?? NOOP_LOGGER;
	}

	private async request(path: string, init: RequestInit = {}): Promise<Response> {
		const url = `${this.opts.baseUrl}${path}`;
		const method = (init.method ?? 'GET').toUpperCase();
		this.logger.debug('lubelogger request', {
			upstream_method: method,
			upstream_path: path
		});
		const headers = new Headers(init.headers);
		headers.set('x-api-key', this.opts.apiKey);
		headers.set('culture-invariant', 'true');
		let res: Response;
		try {
			res = await this.fetchImpl(url, {
				...init,
				headers,
				signal: AbortSignal.timeout(this.timeoutMs)
			});
		} catch (err) {
			const isAbort = (err as Error).name === 'AbortError' ||
				(err as Error).name === 'TimeoutError';
			if (isAbort) {
				this.logger.error('lubelogger timeout', {
					upstream_method: method,
					upstream_path: path,
					timeout_ms: this.timeoutMs,
					err
				});
			} else {
				this.logger.error('lubelogger fetch failed', {
					upstream_method: method,
					upstream_path: path,
					err
				});
			}
			throw err;
		}
		if (!res.ok) {
			const body = await res.text().catch(() => '');
			this.logger.warn('lubelogger non-ok', {
				upstream_method: method,
				upstream_path: path,
				upstream_status: res.status,
				upstream_body_preview: body.slice(0, 200)
			});
			throw new LubeLoggerError(res.status, body);
		}
		return res;
	}

	async listVehicles(): Promise<Vehicle[]> {
		const res = await this.request('/api/vehicles');
		return res.json() as Promise<Vehicle[]>;
	}

	async listGasRecords(vehicleId: number): Promise<GasRecord[]> {
		const res = await this.request(`/api/vehicle/gasrecords?vehicleId=${vehicleId}`);
		return res.json() as Promise<GasRecord[]>;
	}

	async listReminders(vehicleId: number): Promise<Reminder[]> {
		const res = await this.request(`/api/vehicle/reminders?vehicleId=${vehicleId}`);
		return res.json() as Promise<Reminder[]>;
	}

	async getInfo(): Promise<LubeLoggerInfo> {
		const res = await this.request('/api/info');
		return res.json() as Promise<LubeLoggerInfo>;
	}

	async getVersion(): Promise<LubeLoggerVersion> {
		const res = await this.request('/api/version');
		return res.json() as Promise<LubeLoggerVersion>;
	}

	/** Upload a single document (the resized OCR JPEG) to LubeLogger.
	 *  The multipart field name is `documents` (plural — verified against the
	 *  live API; the docs don't cover it). Returns the first element of the
	 *  response array. Throws `LubeLoggerError` if the array is empty. */
	async uploadDocument(bytes: Blob | Uint8Array, filename: string): Promise<UploadedFile> {
		// Copy into a fresh ArrayBuffer-backed view so the BlobPart type is
		// concrete (Uint8Array<ArrayBuffer>), then let the global Blob/FormData
		// (native under adapter-node and the node test env) build the part.
		const blob = bytes instanceof Blob ? bytes : new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' });
		const fd = new FormData();
		fd.set('documents', blob, filename);
		const res = await this.request('/api/documents/upload', { method: 'POST', body: fd });
		const arr = (await res.json()) as UploadedFile[];
		if (!Array.isArray(arr) || arr.length === 0) {
			throw new LubeLoggerError(502, 'documents/upload returned no entries');
		}
		return arr[0];
	}

	async addGasRecord(
		vehicleId: number,
		payload: AddGasRecordPayload,
		files?: UploadedFile[]
	): Promise<void> {
		// With files present, use the JSON variant of the add endpoint — it
		// binds the nested `files` array natively. Keys are camelCase, scalars
		// are strings (the binder is case-insensitive but we send the verified
		// shape). The flat-multipart path below is unchanged for the no-files
		// case (the proven v0.2.x behaviour).
		if (files && files.length > 0) {
			const body = {
				date: payload.date,
				odometer: payload.odometer,
				fuelConsumed: payload.fuelconsumed,
				cost: payload.cost ?? '',
				isFillToFull: payload.isfilltofull,
				missedFuelUp: payload.missedfuelup,
				notes: payload.notes ?? '',
				tags: payload.tags ?? '',
				files
			};
			await this.request(`/api/vehicle/gasrecords/add?vehicleId=${vehicleId}`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			});
			return;
		}
		const fd = new FormData();
		for (const [k, v] of Object.entries(payload)) {
			if (v !== undefined) fd.set(k, v);
		}
		await this.request(`/api/vehicle/gasrecords/add?vehicleId=${vehicleId}`, {
			method: 'POST',
			body: fd
		});
	}

	async fetchImage(path: string): Promise<Response> {
		return this.request(path);
	}
}
