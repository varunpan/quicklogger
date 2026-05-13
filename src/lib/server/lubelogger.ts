export interface Vehicle {
	id: number;
	year?: number;
	make?: string;
	model?: string;
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

interface Options {
	baseUrl: string;
	apiKey: string;
	fetchImpl?: typeof fetch;
	timeoutMs?: number;
}

export class LubeLoggerClient {
	private readonly fetchImpl: typeof fetch;
	private readonly timeoutMs: number;

	constructor(private readonly opts: Options) {
		this.fetchImpl = opts.fetchImpl ?? fetch;
		this.timeoutMs = opts.timeoutMs ?? 5_000;
	}

	private async request(path: string, init: RequestInit = {}): Promise<Response> {
		const url = `${this.opts.baseUrl}${path}`;
		const headers = new Headers(init.headers);
		headers.set('x-api-key', this.opts.apiKey);
		const res = await this.fetchImpl(url, {
			...init,
			headers,
			signal: AbortSignal.timeout(this.timeoutMs)
		});
		if (!res.ok) {
			const body = await res.text().catch(() => '');
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
}
