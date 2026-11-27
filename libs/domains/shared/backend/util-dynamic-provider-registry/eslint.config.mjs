import baseConfig from '../../../../../eslint.config.mjs';
import overridesConfig from '../../../../../eslint.overrides.mjs';

export default [
  ...baseConfig,
  ...overridesConfig,

  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    // Override or add rules here
    rules: {},
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    // Override or add rules here
    rules: {},
  },
  {
    files: ['**/*.js', '**/*.jsx'],
    // Override or add rules here
    rules: {},
  },
];
