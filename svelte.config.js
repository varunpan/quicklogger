import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	compilerOptions: {
		// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	kit: {
		adapter: adapter({ out: 'build' }),
		// Absolute /_app/… asset URLs. The SW serves the same /offline shell for
		// every offline navigation, so a future nested route must not resolve
		// relative asset links against its own depth. Root-served app — safe globally.
		paths: { relative: false }
	}
};

export default config;
