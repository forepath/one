import type { StorybookConfig } from '@storybook/angular';

const config: StorybookConfig = {
  stories: [
    '../**/*.@(mdx|stories.@(js|jsx|ts|tsx))',
    // Dot-directories (`.storybook`) are skipped by `../**`; load foundation MDX explicitly.
    './docs/**/*.mdx',
  ],
  addons: ['@storybook/addon-docs'],
  staticDirs: [
    './public',
    // Monaco AMD build for `fpc-code-editor` (ngx-monaco-editor-v2 loads `assets/monaco/min/vs/loader.js`).
    { from: '../../../../../../node_modules/monaco-editor/min', to: '/assets/monaco/min' },
  ],
  framework: {
    name: '@storybook/angular',
    options: {},
  },
};

export default config;
