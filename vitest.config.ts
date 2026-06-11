import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';
import { svelteTesting } from '@testing-library/svelte/vite';

export default defineConfig({
  plugins: [sveltekit(), svelteTesting()],
  // vite.config.ts injects __APP_VERSION__ as a compile-time constant. Vitest
  // uses this separate config, so without its own define any component that
  // references __APP_VERSION__ (e.g. +layout.svelte) throws a ReferenceError
  // the first time a test renders it.
  define: {
    __APP_VERSION__: JSON.stringify('test')
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['src/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    globals: true
  }
});
