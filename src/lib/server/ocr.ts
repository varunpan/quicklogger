import type { Env } from './env';
import {
	ChainOcrProvider, type OcrProvider, OcrProviderError,
	OllamaOcrProvider, OpenRouterOcrProvider
} from './ocrProviders';
import { MODES } from './ocrModes';
import type { OcrMode, OcrResult } from '$lib/shared/types';

export type ImageType = 'jpeg' | 'png' | 'webp' | 'heic';

export function sniffImageType(buf: Uint8Array): ImageType | null {
	// Minimum we need to look at any byte past index 11 (HEIC brand, WebP 'WEBP' marker).
	if (buf.length < 3) return null;
	// JPEG: FF D8 FF
	if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
	if (buf.length < 8) return null;
	// PNG: 89 50 4E 47 0D 0A 1A 0A
	if (
		buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
		buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
	) return 'png';
	if (buf.length < 12) return null;
	// WebP: 'RIFF' .... 'WEBP'
	if (
		buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
		buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
	) return 'webp';
	// HEIC: bytes 4..7 == 'ftyp', followed by a heic-family brand at 8..11
	if (
		buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70
	) {
		const brand = String.fromCharCode(buf[8], buf[9], buf[10], buf[11]);
		if (brand === 'heic' || brand === 'heix' || brand === 'mif1' || brand === 'msf1') return 'heic';
	}
	return null;
}

export function selectProvider(env: Env): OcrProvider | null {
	const ollama = env.ollamaVisionUrl
		? new OllamaOcrProvider({
				url: env.ollamaVisionUrl,
				model: env.ollamaVisionModel,
				timeoutMs: env.ollamaVisionTimeoutMs,
				keepAlive: env.ollamaKeepAlive
			})
		: null;
	const openrouter = env.openrouterApiKey
		? new OpenRouterOcrProvider({
				apiKey: env.openrouterApiKey,
				model: env.openrouterVisionModel,
				timeoutMs: env.openrouterVisionTimeoutMs
			})
		: null;
	if (ollama && openrouter) return new ChainOcrProvider([ollama, openrouter]);
	if (ollama) return ollama;
	if (openrouter) return openrouter;
	return null;
}

export type PipelineOutcome =
	| {
			ok: true;
			imageType: ImageType;
			result: OcrResult;
			provider: 'ollama' | 'openrouter';
			fellbackTo: 'ollama' | 'openrouter' | null;
			costCents: number;
			latencyMs: number;
		}
	| {
			ok: false;
			statusCode: 400 | 415 | 422 | 502;
			error: string;
			imageType: ImageType | null;
			latencyMs: number;
		};

interface PipelineInput {
	bytes: Uint8Array;
	mode: OcrMode;
	provider: OcrProvider;
	env: Env;
}

export async function runOcrPipeline(input: PipelineInput): Promise<PipelineOutcome> {
	const t0 = Date.now();
	const imageType = sniffImageType(input.bytes);
	if (!imageType) {
		return { ok: false, statusCode: 415, error: 'unsupported image type', imageType: null, latencyMs: Date.now() - t0 };
	}
	const contract = MODES[input.mode];
	if (!contract) {
		return { ok: false, statusCode: 400, error: `unknown mode: ${input.mode}`, imageType, latencyMs: Date.now() - t0 };
	}

	let raw: unknown;
	try {
		raw = await input.provider.extract(input.bytes, contract.prompt, contract.schema);
	} catch (err) {
		const code = err instanceof OcrProviderError ? err.code : 'UNKNOWN';
		return { ok: false, statusCode: 502, error: `provider failed: ${code}`, imageType, latencyMs: Date.now() - t0 };
	}

	const schema = contract.validateSchema(raw);
	if (!schema.ok) {
		return { ok: false, statusCode: 502, error: `schema invalid: ${schema.error}`, imageType, latencyMs: Date.now() - t0 };
	}
	const value = schema.value;
	const ranges = contract.validateRanges(value, input.env);
	if (!ranges.ok) {
		return { ok: false, statusCode: 422, error: ranges.error, imageType, latencyMs: Date.now() - t0 };
	}
	if (contract.validateCrossField) {
		const cross = contract.validateCrossField(value);
		if (!cross.ok) {
			return { ok: false, statusCode: 422, error: cross.error, imageType, latencyMs: Date.now() - t0 };
		}
	}

	const isChain = input.provider instanceof ChainOcrProvider;
	const active = isChain ? (input.provider as ChainOcrProvider).activeProvider ?? input.provider : input.provider;
	const fellbackTo = isChain ? (input.provider as ChainOcrProvider).lastFellbackTo : null;
	return {
		ok: true,
		imageType,
		result: value,
		provider: active.name === 'openrouter' ? 'openrouter' : 'ollama',
		fellbackTo,
		costCents: input.provider.estimateCostCents(),
		latencyMs: Date.now() - t0
	};
}
