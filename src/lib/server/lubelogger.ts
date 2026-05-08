export interface Vehicle {
	id: number;
	year?: number;
	make?: string;
	model?: string;
	[key: string]: unknown;
}

export interface GasRecord {
	id: number;
	date: string;
	odometer: string;
	fuelconsumed: string;
	cost?: string;
	isfilltofull?: string;
	missedfuelup?: string;
	notes?: string;
	tags?: string;
	[key: string]: unknown;
}

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
