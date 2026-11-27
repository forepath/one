import { readFileSync } from 'node:fs';
import globals from 'globals';
import nx from '@nx/eslint-plugin';
import jsoncEslintParser from 'jsonc-eslint-parser';

// Kept in JSON so the tools/code generators can extend it with updateJson.
const depConstraints = JSON.parse(
  readFileSync(
    new URL('./eslint.dep-constraints.json', import.meta.url),
    'utf8',
  ),
);

export default [
  ...nx.configs['flat/base'],
  {
    files: ['**/*.json'],
    // Override or add rules here
    rules: {},
    languageOptions: {
      parser: jsoncEslintParser,
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: [],
          depConstraints,
        },
      ],
    },
  },
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    rules: {
      // Newly enabled by the typescript-eslint v8 recommended set; were not enforced before the upgrade.
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
    },
  },
  {
    files: ['**/*.spec.ts', '**/*.spec.tsx', '**/*.spec.js', '**/*.spec.jsx'],
    languageOptions: {
      globals: globals.jest,
    },
  },
];
