import type { StorybookConfig } from '@storybook/angular';

const config: StorybookConfig = {
  stories: [
    '../**/*.@(mdx|stories.@(js|jsx|ts|tsx))',
    // Dot-directories (`.storybook`) are skipped by `../**`; load foundation MDX explicitly.
    './docs/**/*.mdx',
  ],
  addons: ['@storybook/addon-docs'],
  staticDirs: ['./public'],
  framework: {
    name: '@storybook/angular',
    options: {},
  },
};

export default config;
