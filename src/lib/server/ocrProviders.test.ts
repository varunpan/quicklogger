import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import {
	OllamaOcrProvider,
	OcrProviderError,
	OpenRouterOcrProvider,
	ChainOcrProvider,
	parseLenientJson
} from './ocrProviders';
import type { OcrProvider } from './ocrProviders';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const URL = 'http://ollama:11434';
const PROMPT = 'test-prompt';
const SCHEMA = { type: 'object', required: ['v'], properties: { v: { type: 'number' } } };

describe('OllamaOcrProvider', () => {
	it('POSTs to /api/chat with model + image and returns parsed JSON', async () => {
		let observedBody: Record<string, unknown> | undefined;
		server.use(
			http.post(`${URL}/api/chat`, async ({ request }) => {
				observedBody = (await request.json()) as Record<string, unknown>;
				return HttpResponse.json({
					message: { content: '{"v":42}' }
				});
			})
		);
		const p = new OllamaOcrProvider({
			url: URL,
			model: 'qwen2.5vl:7b',
			timeoutMs: 5_000,
			keepAlive: '30m'
		});
		const buf = Buffer.from([0xff, 0xd8, 0xff]);
		const result = await p.extract(buf, PROMPT, SCHEMA);
		expect(result).toEqual({ v: 42 });
		expect(observedBody).toMatchObject({
			model: 'qwen2.5vl:7b',
			stream: false,
			keep_alive: '30m',
			format: SCHEMA
		});
		const msg = (observedBody as { messages: { images: string[]; content: string }[] }).messages[0];
		expect(msg.images[0]).toBe(buf.toString('base64'));
		expect(msg.content).toBe(PROMPT);
	});

	it('throws OcrProviderError on non-2xx', async () => {
		server.use(http.post(`${URL}/api/chat`, () => new HttpResponse('boom', { status: 500 })));
		const p = new OllamaOcrProvider({ url: URL, model: 'm', timeoutMs: 5_000, keepAlive: '30m' });
		await expect(p.extract(Buffer.from([0xff]), PROMPT, SCHEMA)).rejects.toBeInstanceOf(
			OcrProviderError
		);
	});

	it('throws OcrProviderError when message.content is unparseable JSON', async () => {
		server.use(
			http.post(`${URL}/api/chat`, () =>
				HttpResponse.json({ message: { content: 'not valid json' } })
			)
		);
		const p = new OllamaOcrProvider({ url: URL, model: 'm', timeoutMs: 5_000, keepAlive: '30m' });
		await expect(p.extract(Buffer.from([0xff]), PROMPT, SCHEMA)).rejects.toBeInstanceOf(
			OcrProviderError
		);
	});

	it('returns 0 cost (local inference)', () => {
		const p = new OllamaOcrProvider({ url: URL, model: 'm', timeoutMs: 5_000, keepAlive: '30m' });
		expect(p.estimateCostCents()).toBe(0);
	});

	it('throws OcrProviderError on timeout', async () => {
		server.use(
			http.post(`${URL}/api/chat`, async () => {
				await new Promise((r) => setTimeout(r, 100));
				return HttpResponse.json({ message: { content: '{"v":1}' } });
			})
		);
		const p = new OllamaOcrProvider({ url: URL, model: 'm', timeoutMs: 10, keepAlive: '30m' });
		await expect(p.extract(Buffer.from([0xff]), PROMPT, SCHEMA)).rejects.toBeInstanceOf(
			OcrProviderError
		);
	});
});

const OR_URL = 'https://openrouter.ai/api/v1/chat/completions';

describe('OpenRouterOcrProvider', () => {
	it('POSTs with auth header, json_schema, and base64 image URL', async () => {
		let observedAuth = '';
		let observedBody: Record<string, unknown> | undefined;
		server.use(
			http.post(OR_URL, async ({ request }) => {
				observedAuth = request.headers.get('authorization') ?? '';
				observedBody = (await request.json()) as Record<string, unknown>;
				return HttpResponse.json({
					choices: [{ message: { content: '{"v":42}' } }]
				});
			})
		);
		const p = new OpenRouterOcrProvider({
			apiKey: 'sk-or-test',
			model: 'google/gemini-2.5-flash-lite',
			timeoutMs: 5_000
		});
		const result = await p.extract(Buffer.from([0xff, 0xd8, 0xff]), PROMPT, SCHEMA);
		expect(result).toEqual({ v: 42 });
		expect(observedAuth).toBe('Bearer sk-or-test');
		const rf = (
			observedBody as { response_format: { type: string; json_schema: { schema: object } } }
		).response_format;
		expect(rf.type).toBe('json_schema');
		expect(rf.json_schema.schema).toEqual(SCHEMA);
		const content = (observedBody as { messages: { content: Array<{ type: string }> }[] })
			.messages[0].content;
		expect(content[0].type).toBe('text');
		expect(content[1].type).toBe('image_url');
		// Anti-runaway: request body must cap output tokens. Real responses
		// are ~30 tokens (pump) / ~10 (odometer); 256 is the headroom value.
		expect((observedBody as { max_tokens: number }).max_tokens).toBe(256);
	});

	it('throws OcrProviderError on non-2xx', async () => {
		server.use(http.post(OR_URL, () => new HttpResponse('rate limited', { status: 429 })));
		const p = new OpenRouterOcrProvider({ apiKey: 'k', model: 'm', timeoutMs: 5_000 });
		await expect(p.extract(Buffer.from([0xff]), PROMPT, SCHEMA)).rejects.toBeInstanceOf(
			OcrProviderError
		);
	});

	it('reports a non-zero, sub-cent cost estimate', () => {
		const p = new OpenRouterOcrProvider({ apiKey: 'k', model: 'm', timeoutMs: 5_000 });
		expect(p.estimateCostCents()).toBeGreaterThan(0);
		expect(p.estimateCostCents()).toBeLessThan(1);
	});
});

describe('ChainOcrProvider', () => {
	it('returns the first provider result on success; activeProvider = first; lastFellbackTo = null', async () => {
		const a: OcrProvider = {
			name: 'ollama',
			estimateCostCents: () => 0,
			extract: vi.fn(async () => ({ v: 1 }))
		};
		const b: OcrProvider = {
			name: 'openrouter',
			estimateCostCents: () => 0.006,
			extract: vi.fn(async () => ({ v: 999 }))
		};
		const chain = new ChainOcrProvider([a, b]);
		const result = await chain.extract(Buffer.from([0xff]), PROMPT, SCHEMA);
		expect(result).toEqual({ v: 1 });
		expect(b.extract).not.toHaveBeenCalled();
		expect(chain.activeProvider?.name).toBe('ollama');
		expect(chain.lastFellbackTo).toBeNull();
	});

	it('falls through to the second provider on first failure; records lastFellbackTo', async () => {
		const a: OcrProvider = {
			name: 'ollama',
			estimateCostCents: () => 0,
			extract: vi.fn(async () => {
				throw new OcrProviderError('NETWORK', 'down');
			})
		};
		const b: OcrProvider = {
			name: 'openrouter',
			estimateCostCents: () => 0.006,
			extract: vi.fn(async () => ({ v: 42 }))
		};
		const chain = new ChainOcrProvider([a, b]);
		const result = await chain.extract(Buffer.from([0xff]), PROMPT, SCHEMA);
		expect(result).toEqual({ v: 42 });
		expect(chain.activeProvider?.name).toBe('openrouter');
		expect(chain.lastFellbackTo).toBe('ollama');
	});

	it('throws the last error when all providers fail', async () => {
		const a: OcrProvider = {
			name: 'ollama',
			estimateCostCents: () => 0,
			extract: vi.fn(async () => {
				throw new OcrProviderError('TIMEOUT', 'a-down');
			})
		};
		const b: OcrProvider = {
			name: 'openrouter',
			estimateCostCents: () => 0.006,
			extract: vi.fn(async () => {
				throw new OcrProviderError('HTTP', 'b-down');
			})
		};
		const chain = new ChainOcrProvider([a, b]);
		await expect(chain.extract(Buffer.from([0xff]), PROMPT, SCHEMA)).rejects.toMatchObject({
			name: 'OcrProviderError',
			code: 'HTTP'
		});
	});

	it('exposes the underlying chain via `chain` accessor for selectProvider tests', () => {
		const a: OcrProvider = {
			name: 'ollama',
			estimateCostCents: () => 0,
			extract: async () => ({})
		};
		const b: OcrProvider = {
			name: 'openrouter',
			estimateCostCents: () => 0.006,
			extract: async () => ({})
		};
		const chain = new ChainOcrProvider([a, b]);
		expect(chain.chain.length).toBe(2);
		expect(chain.chain[0].name).toBe('ollama');
		expect(chain.chain[1].name).toBe('openrouter');
	});
});

describe('parseLenientJson', () => {
	it('parses naked JSON (idempotent on clean input)', () => {
		expect(parseLenientJson('{"v":42}')).toEqual({ v: 42 });
	});

	it('strips a leading markdown fence and trailing fence', () => {
		const raw = '```json\n{"v":42,"label":"x"}\n```';
		expect(parseLenientJson(raw)).toEqual({ v: 42, label: 'x' });
	});

	it('strips trailing prose after the object (ministral-3:14b case)', () => {
		const raw = '```json\n{"v":1}\n```\nSanity check: this looks right.';
		expect(parseLenientJson(raw)).toEqual({ v: 1 });
	});

	it('strips prose prefix before the object', () => {
		const raw = 'Here is the JSON you requested:\n{"v":1}';
		expect(parseLenientJson(raw)).toEqual({ v: 1 });
	});

	it('handles nested objects via lastIndexOf', () => {
		const raw = '```json\n{"outer":{"inner":7}}\n```';
		expect(parseLenientJson(raw)).toEqual({ outer: { inner: 7 } });
	});

	it('throws OcrProviderError(PARSE) when no { is present', () => {
		expect(() => parseLenientJson('no json here at all')).toThrow(
			expect.objectContaining({ name: 'OcrProviderError', code: 'PARSE' })
		);
	});

	it('throws OcrProviderError(PARSE) when slice contents are malformed', () => {
		// Has { and } but the slice between them is invalid JSON.
		expect(() => parseLenientJson('prefix { not: json } suffix')).toThrow(
			expect.objectContaining({ name: 'OcrProviderError', code: 'PARSE' })
		);
	});
});
