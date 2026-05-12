export class OcrProviderError extends Error {
	constructor(
		public readonly code: string,
		message: string
	) {
		super(message);
		this.name = 'OcrProviderError';
	}
}

export interface OcrProvider {
	readonly name: 'ollama' | 'openrouter';
	estimateCostCents(): number;
	extract(bytes: Uint8Array, prompt: string, schema: object): Promise<unknown>;
}

interface OllamaOptions {
	url: string;
	model: string;
	timeoutMs: number;
	keepAlive: string;
	fetchImpl?: typeof fetch;
}

export class OllamaOcrProvider implements OcrProvider {
	readonly name = 'ollama' as const;
	private readonly fetchImpl: typeof fetch;
	constructor(private readonly opts: OllamaOptions) {
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

		let res: Response;
		try {
			res = await this.fetchImpl(`${this.opts.url}/api/chat`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body),
				signal: AbortSignal.timeout(this.opts.timeoutMs)
			});
		} catch (err) {
			throw new OcrProviderError('NETWORK', `ollama request failed: ${(err as Error).message}`);
		}
		if (!res.ok) {
			const txt = await res.text().catch(() => '');
			throw new OcrProviderError('HTTP', `ollama ${res.status}: ${txt.slice(0, 200)}`);
		}
		const wire = (await res.json().catch(() => null)) as { message?: { content?: string } } | null;
		const content = wire?.message?.content;
		if (typeof content !== 'string') {
			throw new OcrProviderError('NO_CONTENT', 'ollama response missing message.content');
		}
		try {
			return JSON.parse(content);
		} catch {
			throw new OcrProviderError('PARSE', `ollama content is not JSON: ${content.slice(0, 100)}`);
		}
	}
}
