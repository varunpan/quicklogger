import type { Env, OcrSlotName } from './env';
import {
	ChainOcrProvider, type OcrProvider, OcrProviderError,
	OllamaOcrProvider, OpenRouterOcrProvider
} from './ocrProviders';
import { MODES } from './ocrModes';
import type { ModeContract } from './ocrModes';
import type { OcrMode, OcrResult } from '$lib/shared/types';

export type ImageType = 'jpeg' | 'png' | 'webp' | 'heic';

export function sniffImageType(buf: Uint8Array): ImageType | null {
	if (buf.length < 3) return null;
	if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
	if (buf.length < 8) return null;
	if (
		buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
		buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
	) return 'png';
	if (buf.length < 12) return null;
	if (
		buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
		buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
	) return 'webp';
	if (
		buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70
	) {
		const brand = String.fromCharCode(buf[8], buf[9], buf[10], buf[11]);
		if (brand === 'heic' || brand === 'heix' || brand === 'mif1' || brand === 'msf1') return 'heic';
	}
	return null;
}

// Default chain order when OCR_PROVIDER_CHAIN is unset. Preserves
// back-compat: existing 2-slot deploys see [ollama-local, openrouter]
// after configured-only filtering, identical to v0.2.1 behavior.
const DEFAULT_SLOT_ORDER: readonly OcrSlotName[] = [
	'ollama-local',
	'openrouter',
	'ollama-cloud',
	'openai-compatible'
];

// Required-var hint string for the WARN log emitted when an
// explicitly-named slot is missing config.
const REQUIRED_ENV_VAR_BY_SLOT: Record<OcrSlotName, string> = {
	'ollama-local': 'OLLAMA_VISION_URL',
	'ollama-cloud': 'OLLAMA_CLOUD_API_KEY',
	'openrouter': 'OPENROUTER_API_KEY',
	'openai-compatible': 'OPENAI_COMPATIBLE_API_KEY (and URL, MODEL)'
};

// Resolves the model tag for a given slot — used by the route handler
// when writing the audit row. Exported because the route handler reads
// the active slot's model from env, not from the provider instance.
export function modelForSlot(slot: OcrSlotName, env: Env): string {
	switch (slot) {
		case 'ollama-local': return env.ollamaVisionModel;
		case 'ollama-cloud': return env.ollamaCloudModel;
		case 'openrouter': return env.openrouterVisionModel;
		case 'openai-compatible': return env.openaiCompatibleModel ?? '';
	}
}

interface BuiltSlot {
	provider: OcrProvider;
	timeoutMs: number;
}

function buildSlot(slot: OcrSlotName, env: Env): BuiltSlot | null {
	switch (slot) {
		case 'ollama-local':
			if (!env.ollamaVisionUrl) return null;
			return {
				provider: new OllamaOcrProvider({
					url: env.ollamaVisionUrl,
					model: env.ollamaVisionModel,
					timeoutMs: env.ollamaVisionTimeoutMs,
					keepAlive: env.ollamaKeepAlive,
					slotName: 'ollama-local'
				}),
				timeoutMs: env.ollamaVisionTimeoutMs
			};
		case 'ollama-cloud':
			if (!env.ollamaCloudApiKey) return null;
			return {
				provider: new OllamaOcrProvider({
					url: env.ollamaCloudUrl,
					model: env.ollamaCloudModel,
					timeoutMs: env.ollamaCloudTimeoutMs,
					keepAlive: env.ollamaKeepAlive,
					apiKey: env.ollamaCloudApiKey,
					slotName: 'ollama-cloud'
				}),
				timeoutMs: env.ollamaCloudTimeoutMs
			};
		case 'openrouter':
			if (!env.openrouterApiKey) return null;
			return {
				provider: new OpenRouterOcrProvider({
					apiKey: env.openrouterApiKey,
					model: env.openrouterVisionModel,
					timeoutMs: env.openrouterVisionTimeoutMs,
					slotName: 'openrouter'
				}),
				timeoutMs: env.openrouterVisionTimeoutMs
			};
		case 'openai-compatible':
			if (!env.openaiCompatibleUrl || !env.openaiCompatibleApiKey || !env.openaiCompatibleModel) {
				return null;
			}
			return {
				provider: new OpenRouterOcrProvider({
					url: env.openaiCompatibleUrl,
					apiKey: env.openaiCompatibleApiKey,
					model: env.openaiCompatibleModel,
					timeoutMs: env.openaiCompatibleTimeoutMs,
					slotName: 'openai-compatible'
				}),
				timeoutMs: env.openaiCompatibleTimeoutMs
			};
	}
}

interface SelectProviderLogger {
	warn: (msg: string) => void;
	info: (msg: string) => void;
}

export interface SelectProviderResult {
	provider: OcrProvider | null;
	chainTimeoutMs: number;
}

export function selectProvider(
	env: Env,
	logger: SelectProviderLogger = console
): SelectProviderResult {
	const explicitChain = env.ocrProviderChain;
	const chain = explicitChain ?? DEFAULT_SLOT_ORDER;
	const built: BuiltSlot[] = [];

	for (const slot of chain) {
		const b = buildSlot(slot, env);
		if (b) {
			built.push(b);
		} else if (explicitChain) {
			// WARN only when explicitly named — default chain is best-effort.
			logger.warn(`OCR chain slot '${slot}' skipped: ${REQUIRED_ENV_VAR_BY_SLOT[slot]} not set`);
		}
	}

	if (built.length === 0) return { provider: null, chainTimeoutMs: 0 };
	const chainTimeoutMs = built.reduce((sum, b) => sum + b.timeoutMs, 0);
	if (built.length === 1) return { provider: built[0].provider, chainTimeoutMs };

	logger.info(`OCR chain effective: ${built.map((b) => b.provider.name).join(', ')}`);
	return { provider: new ChainOcrProvider(built.map((b) => b.provider)), chainTimeoutMs };
}

export type PipelineOutcome =
	| {
			ok: true;
			imageType: ImageType;
			result: OcrResult;
			provider: OcrSlotName;
			fellbackFrom: OcrSlotName | null;
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
	lastOdometerMi?: number;
	lastPricePerUnit?: number;
}

export async function runOcrPipeline(input: PipelineInput): Promise<PipelineOutcome> {
	const t0 = Date.now();
	const imageType = sniffImageType(input.bytes);
	if (!imageType) {
		return { ok: false, statusCode: 415, error: 'unsupported image type', imageType: null, latencyMs: Date.now() - t0 };
	}
	// Cast to the base ModeContract so the dispatcher can pass the union result
	// type back into validateRanges / validateCrossField. MODES preserves per-mode
	// specificity at the call site (MODES.pump → ModeContract<OcrPumpResult>), but
	// when keyed by a runtime OcrMode here, TypeScript widens to the union of
	// contracts, whose validate* methods have incompatible parameter types.
	const contract: ModeContract = MODES[input.mode];
	if (!contract) {
		return { ok: false, statusCode: 400, error: `unknown mode: ${input.mode}`, imageType, latencyMs: Date.now() - t0 };
	}

	// Build the prompt context. Defensive on both hint fields — only forward
	// when finite positive; otherwise drop so the prompt builder never emits
	// a "previous reading was NaN" hint. The result is undefined (no
	// context) when neither hint passes the gate, so old callers that pass
	// nothing observe identical behaviour to v0.2.0+.
	const ctx: { lastOdometerMi?: number; lastPricePerUnit?: number } = {};
	if (
		typeof input.lastOdometerMi === 'number' &&
		Number.isFinite(input.lastOdometerMi) &&
		input.lastOdometerMi > 0
	) {
		ctx.lastOdometerMi = input.lastOdometerMi;
	}
	if (
		typeof input.lastPricePerUnit === 'number' &&
		Number.isFinite(input.lastPricePerUnit) &&
		input.lastPricePerUnit > 0
	) {
		ctx.lastPricePerUnit = input.lastPricePerUnit;
	}
	const promptCtx = Object.keys(ctx).length > 0 ? ctx : undefined;
	const promptStr = contract.prompt(promptCtx);

	let raw: unknown;
	try {
		raw = await input.provider.extract(input.bytes, promptStr, contract.schema);
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
	const fellbackFrom = isChain ? (input.provider as ChainOcrProvider).lastFellbackFrom : null;
	return {
		ok: true,
		imageType,
		result: value,
		provider: active.name,
		fellbackFrom,
		costCents: input.provider.estimateCostCents(),
		latencyMs: Date.now() - t0
	};
}
