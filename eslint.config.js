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
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_'
        }
      ],
      // Type-only imports must use `import type` — stops a careless import
      // from pulling $lib/server modules into client bundles at runtime
      // (e.g. client/api.ts importing lubelogger types). Inline `import()`
      // type annotations stay allowed: they're erased at compile time (no
      // runtime pull-in) and are the established idiom in the test files.
      '@typescript-eslint/consistent-type-imports': ['error', { disallowTypeAnnotations: false }]
    }
  },
  {
    ignores: ['build/', '.svelte-kit/', 'node_modules/', 'coverage/', 'playwright-report/']
  }
];
