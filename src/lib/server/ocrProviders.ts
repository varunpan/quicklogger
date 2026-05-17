import type { OcrSlotName } from './env';

export class OcrProviderError extends Error {
	constructor(
		public readonly code: string,
		message: string
	) {
		super(message);
		this.name = 'OcrProviderError';
	}
}

// Anchors on first `{` and last `}`. Idempotent on clean JSON. Strips
// markdown fences and any prose before/after the object. Throws
// OcrProviderError('PARSE', ...) if no braces are present or the slice
// doesn't parse. Used by OllamaOcrProvider because Ollama Cloud returns
// JSON wrapped in ```json fences and some models append a trailing
// "Sanity check: ..." paragraph; OpenRouter is strict-parsed because
// `response_format: json_schema` is contractually enforced there.
export function parseLenientJson(raw: string): unknown {
	const start = raw.indexOf('{');
	const end = raw.lastIndexOf('}');
	if (start < 0 || end < 0 || end <= start) {
		throw new OcrProviderError('PARSE', `no JSON object in: ${raw.slice(0, 100)}`);
	}
	try {
		return JSON.parse(raw.slice(start, end + 1));
	} catch {
		throw new OcrProviderError('PARSE', `content is not JSON: ${raw.slice(0, 100)}`);
	}
}

export interface OcrProvider {
	readonly name: OcrSlotName;
	estimateCostCents(): number;
	extract(bytes: Uint8Array, prompt: string, schema: object): Promise<unknown>;
}

interface OllamaOptions {
	url: string;
	model: string;
	timeoutMs: number;
	keepAlive: string;
	apiKey?: string;
	slotName: 'ollama-local' | 'ollama-cloud';
	fetchImpl?: typeof fetch;
}

export class OllamaOcrProvider implements OcrProvider {
	readonly name: 'ollama-local' | 'ollama-cloud';
	private readonly fetchImpl: typeof fetch;
	constructor(private readonly opts: OllamaOptions) {
		this.name = opts.slotName;
		this.fetchImpl = opts.fetchImpl ?? fetch;
	}

	estimateCostCents(): number {
		return 0;
	}

	async extract(bytes: Uint8Array, prompt: string, schema: object): Promise<unknown> {
		const body = {
			model: this.opts.model,
			stream: false,
			keep_alive: this.opts.keepAlive,
			options: { temperature: 0 },
			messages: [
				{
					role: 'user',
					content: prompt,
					images: [Buffer.from(bytes).toString('base64')]
				}
			],
			format: schema
		};

		const headers: Record<string, string> = { 'content-type': 'application/json' };
		if (this.opts.apiKey) {
			headers.authorization = `Bearer ${this.opts.apiKey}`;
		}

		let res: Response;
		try {
			res = await this.fetchImpl(`${this.opts.url}/api/chat`, {
				method: 'POST',
				headers,
				body: JSON.stringify(body),
				signal: AbortSignal.timeout(this.opts.timeoutMs)
			});
		} catch (err) {
			throw new OcrProviderError('NETWORK', `${this.name} request failed: ${(err as Error).message}`);
		}
		if (!res.ok) {
			const txt = await res.text().catch(() => '');
			throw new OcrProviderError('HTTP', `${this.name} ${res.status}: ${txt.slice(0, 200)}`);
		}
		const wire = (await res.json().catch(() => null)) as { message?: { content?: string } } | null;
		const content = wire?.message?.content;
		if (typeof content !== 'string') {
			throw new OcrProviderError('NO_CONTENT', `${this.name} response missing message.content`);
		}
		return parseLenientJson(content);
	}
}

interface OpenRouterOptions {
	url?: string;
	apiKey: string;
	model: string;
	timeoutMs: number;
	slotName: 'openrouter' | 'openai-compatible';
	fetchImpl?: typeof fetch;
}

const DEFAULT_OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Per-call cost estimate (cents). Gemini Flash Lite is ≈ $0.00006/call;
// we round up to 0.006 cents — conservative for the daily budget gate.
// Both `openrouter` and `openai-compatible` slots report the same value;
// per-slot override is YAGNI for personal use. Tighten OCR_DAILY_BUDGET_USD
// if you route openai-compatible at an expensive endpoint (e.g. OpenAI direct).
const OPENROUTER_COST_CENTS = 0.006;

// Anti-runaway output cap. Valid responses top out at ~30 tokens (pump)
// or ~10 tokens (odometer), so 256 gives ~8× headroom on the largest
// legitimate output and bounds worst-case per-call cost at ~0.01¢ on
// Gemini Flash Lite ($0.40/M output tokens).
const OPENROUTER_MAX_TOKENS = 256;

export class OpenRouterOcrProvider implements OcrProvider {
	readonly name: 'openrouter' | 'openai-compatible';
	private readonly url: string;
	private readonly fetchImpl: typeof fetch;
	constructor(private readonly opts: OpenRouterOptions) {
		this.name = opts.slotName;
		this.url = opts.url ?? DEFAULT_OPENROUTER_URL;
		this.fetchImpl = opts.fetchImpl ?? fetch;
	}

	estimateCostCents(): number {
		return OPENROUTER_COST_CENTS;
	}

	async extract(bytes: Uint8Array, prompt: string, schema: object): Promise<unknown> {
		const dataUrl = `data:image/jpeg;base64,${Buffer.from(bytes).toString('base64')}`;
		const body = {
			model: this.opts.model,
			messages: [
				{
					role: 'user',
					content: [
						{ type: 'text', text: prompt },
						{ type: 'image_url', image_url: { url: dataUrl } }
					]
				}
			],
			max_tokens: OPENROUTER_MAX_TOKENS,
			response_format: {
				type: 'json_schema',
				json_schema: {
					name: 'OcrReading',
					strict: true,
					schema
				}
			}
		};

		let res: Response;
		try {
			res = await this.fetchImpl(this.url, {
				method: 'POST',
				headers: {
					authorization: `Bearer ${this.opts.apiKey}`,
					'content-type': 'application/json'
				},
				body: JSON.stringify(body),
				signal: AbortSignal.timeout(this.opts.timeoutMs)
			});
		} catch (err) {
			throw new OcrProviderError(
				'NETWORK',
				`${this.name} request failed: ${(err as Error).message}`
			);
		}
		if (!res.ok) {
			const txt = await res.text().catch(() => '');
			throw new OcrProviderError('HTTP', `${this.name} ${res.status}: ${txt.slice(0, 200)}`);
		}
		const wire = (await res.json().catch(() => null)) as {
			choices?: { message?: { content?: string } }[];
		} | null;
		const content = wire?.choices?.[0]?.message?.content;
		if (typeof content !== 'string') {
			throw new OcrProviderError(
				'NO_CONTENT',
				`${this.name} response missing choices[0].message.content`
			);
		}
		try {
			return JSON.parse(content);
		} catch {
			throw new OcrProviderError(
				'PARSE',
				`${this.name} content is not JSON: ${content.slice(0, 100)}`
			);
		}
	}
}

// Chain wrapper: at most one fallback. Records which provider served
// the request; exposed for audit. Not a retry loop — every provider is
// tried at most once.
export class ChainOcrProvider implements OcrProvider {
	readonly name = 'ollama' as const; // unused; chain identifies via activeProvider
	private _activeProvider: OcrProvider | null = null;
	private _lastFellbackTo: 'ollama' | 'openrouter' | null = null;

	constructor(private readonly _chain: OcrProvider[]) {
		if (_chain.length === 0) throw new Error('ChainOcrProvider requires at least one provider');
	}

	get chain(): readonly OcrProvider[] {
		return this._chain;
	}
	get activeProvider(): OcrProvider | null {
		return this._activeProvider;
	}
	get lastFellbackTo(): 'ollama' | 'openrouter' | null {
		return this._lastFellbackTo;
	}

	estimateCostCents(): number {
		return this._activeProvider?.estimateCostCents() ?? this._chain[0].estimateCostCents();
	}

	async extract(bytes: Uint8Array, prompt: string, schema: object): Promise<unknown> {
		let lastErr: Error | undefined;
		this._lastFellbackTo = null;
		for (let i = 0; i < this._chain.length; i++) {
			const p = this._chain[i];
			try {
				const result = await p.extract(bytes, prompt, schema);
				this._activeProvider = p;
				if (i > 0) this._lastFellbackTo = this._chain[0].name;
				return result;
			} catch (err) {
				lastErr = err as Error;
			}
		}
		this._activeProvider = null;
		throw lastErr ?? new OcrProviderError('NO_PROVIDERS', 'no providers succeeded');
	}
}
