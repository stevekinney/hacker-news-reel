import js from '@eslint/js';
import prettier from 'eslint-plugin-prettier';
import securityPlugin from 'eslint-plugin-security';
import unicorn from 'eslint-plugin-unicorn';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

import prettierConfig from './.prettierrc.json' with { type: 'json' };

export default defineConfig([
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/reference/**'],
  },
  tseslint.configs.strict,
  securityPlugin.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs,ts}'],
    plugins: { js },
    extends: ['js/recommended'],
  },
  {
    files: ['**/*.{js,mjs,cjs,ts}'],
    languageOptions: {
      globals: {
        Bun: true,
        ...globals.node,
        ...globals.es2025,
        ...globals.browser,
      },
    },
  },
  {
    rules: {
      'no-restricted-syntax': ['off', 'ForOfStatement'],
      'no-console': ['off'],
      'prefer-template': 'error',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      quotes: ['error', 'single', { avoidEscape: true }],
    },
  },
  {
    files: ['**/*.{js,mjs,cjs,ts}'],
    plugins: {
      prettier,
    },
    rules: {
      'prettier/prettier': [1, prettierConfig],
    },
  },
  {
    plugins: {
      unicorn,
    },
    rules: {
      'no-array-reduce': 'off',
      'no-process-exit': 'off',
    },
  },
]);
