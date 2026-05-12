import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { OllamaOcrProvider, OcrProviderError } from './ocrProviders';

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
			model: 'qwen2.5vl:3b',
			timeoutMs: 5_000,
			keepAlive: '30m'
		});
		const buf = Buffer.from([0xff, 0xd8, 0xff]);
		const result = await p.extract(buf, PROMPT, SCHEMA);
		expect(result).toEqual({ v: 42 });
		expect(observedBody).toMatchObject({
			model: 'qwen2.5vl:3b',
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
