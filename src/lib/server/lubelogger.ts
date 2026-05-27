export interface Vehicle {
	id: number;
	year?: number;
	make?: string;
	model?: string;
	licensePlate?: string;
	vin?: string;
	[key: string]: unknown;
}

/** Shape returned by GET /api/vehicle/gasrecords (camelCase, stringified values). */
export interface GasRecord {
	id: string;
	vehicleId: string;
	date: string;
	odometer: string;
	fuelConsumed: string;
	cost?: string;
	fuelEconomy?: string;
	isFillToFull?: string;
	missedFuelUp?: string;
	notes?: string;
	tags?: string;
	extraFields?: unknown[];
	files?: unknown[];
	[key: string]: unknown;
}

export type ReminderUrgency = 'NotUrgent' | 'Urgent' | 'VeryUrgent' | 'PastDue';
export type ReminderMetric = 'Odometer' | 'Date' | 'Both';

/** Shape returned by GET /api/vehicle/reminders. Every field is always
 *  present in the upstream payload (verified against LubeLogger during
 *  design). All values are strings, matching the LubeLogger
 *  stringified-everything convention also seen on GasRecord. */
export interface Reminder {
	id: string;
	vehicleId: string;
	description: string;
	urgency: ReminderUrgency;
	metric: ReminderMetric;
	userMetric: ReminderMetric;
	notes: string;
	dueDate: string;       // 'M/D/YYYY'; placeholder when userMetric === 'Odometer'
	dueOdometer: string;   // stringified int; '0' when userMetric === 'Date'
	dueDays: string;       // stringified int countdown; negative = overdue
	dueDistance: string;   // stringified int countdown (mi); negative = overdue
	tags: string;
	[key: string]: unknown;
}

/** Shape returned by GET /api/info. Flat, all-string (verified against
 *  LubeLogger v1.6.5 during design). `currentVersion` is repeated here and
 *  on /api/version; the locale/currency/format fields are cached but unused
 *  this branch (the follow-up branch consumes them for display formatting). */
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

	async addGasRecord(vehicleId: number, payload: AddGasRecordPayload): Promise<void> {
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
