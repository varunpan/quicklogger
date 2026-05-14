import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import svelteParser from 'svelte-eslint-parser';
import globals from 'globals';

export default [
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs['flat/recommended'],
  {
    files: ['**/*.svelte', 'src/lib/client/**/*.ts', 'src/routes/**/*.ts'],
    languageOptions: {
      globals: { ...globals.browser, __APP_VERSION__: 'readonly' }
    }
  },
  {
    files: ['src/service-worker.ts'],
    languageOptions: {
      globals: { ...globals.serviceworker }
    }
  },
  {
    files: ['**/*.svelte'],
    languageOptions: {
      parser: svelteParser,
      parserOptions: { parser: ts.parser }
    }
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_'
      }]
    }
  },
  {
    ignores: ['build/', '.svelte-kit/', 'node_modules/', 'coverage/', 'playwright-report/']
  }
];
