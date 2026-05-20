// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { Logger } from '$lib/server/logger';

declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			logger: Logger;
			requestId: string;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}

	// Injected at build by vite.config.ts `define` from package.json#version.
	// Compile-time literal; do not assign at runtime.
	const __APP_VERSION__: string;
}

export {};
