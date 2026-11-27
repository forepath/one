import baseConfig from '../../../../../eslint.config.mjs';
import overridesConfig, {
  angular as angularOverridesConfig,
} from '../../../../../eslint.overrides.mjs';
import nx from '@nx/eslint-plugin';

export default [
  ...baseConfig,
  ...overridesConfig,

  ...nx.configs['flat/angular'],
  {
    files: ['**/*.ts'],
    rules: {
      '@angular-eslint/directive-selector': [
        'error',
        {
          type: 'attribute',
          prefix: 'fpc',
          style: 'camelCase',
        },
      ],
      '@angular-eslint/component-selector': [
        'error',
        {
          type: 'element',
          prefix: 'fpc',
          style: 'kebab-case',
        },
      ],
    },
  },
  ...nx.configs['flat/angular-template'],
  ...angularOverridesConfig,
  {
    ignores: ['storybook-static'],
  },
];
