import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['.claude/**', '.output/**', '.wxt/**', 'safari/**', 'safari-ios/**', 'build/**', 'node_modules/**', 'playwright-report/**', 'test-results/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Diagnostics go through hostDiag / the content script's diag, not the console.
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
    },
  },
  {
    // Node tools and the preview page: they report to the console, and TypeScript checks names in the .ts ones.
    files: ['scripts/**', 'preview/**', '*.config.{js,ts}'],
    rules: { 'no-console': 'off', 'no-undef': 'off' },
  },
  {
    // Gmail's sync payloads are deeply nested untyped arrays; fixtures poke at them directly.
    files: ['tests/session/**'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
);
