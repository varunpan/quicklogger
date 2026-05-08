import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ command, mode }) => {
	// `vite dev` and `vite preview` need .env in process.env so server-side
	// modules (env.ts, lubelogger.ts) can read it. Production runs via
	// `node build` with env from docker-compose, so this branch is skipped
	// there. Vitest sets command !== 'serve' so tests are unaffected.
	if (command === 'serve') {
		const env = loadEnv(mode, process.cwd(), '');
		for (const [k, v] of Object.entries(env)) {
			if (process.env[k] === undefined) process.env[k] = v;
		}
	}
	return {
		plugins: [tailwindcss(), sveltekit()]
	};
});
