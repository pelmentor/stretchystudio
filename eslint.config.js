import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

export default [
  {
    files: ['**/*.{js,jsx}'],
    ignores: ['dist'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    settings: { react: { version: '18.3' } },
    plugins: {
      react,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...react.configs.recommended.rules,
      ...react.configs['jsx-runtime'].rules,
      ...reactHooks.configs.recommended.rules,
      'react/jsx-no-target-blank': 'off',
      // The codebase is migrating to TypeScript-checked JSDoc via per-file
      // `// @ts-check` (Phase 0D). prop-types would be parallel-track noise:
      // 583 lint errors on a codebase that has zero runtime prop-types
      // imports and no intent to add them. Off.
      'react/prop-types': 'off',
      // Modern React renders bare apostrophes / quotes in JSX text fine.
      // The rule defends against pathologically truncated tags
      // ("<p>he said "hi") which our writers don't produce. Off.
      'react/no-unescaped-entities': 'off',
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
    },
  },
]
