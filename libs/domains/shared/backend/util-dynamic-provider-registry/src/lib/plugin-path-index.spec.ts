import { join } from 'node:path';

import { buildPluginPathIndex, resetPluginPathIndexCache } from './plugin-path-index';

const pluginRoot = join(__dirname, '../test-fixtures/plugin-root');

describe('buildPluginPathIndex', () => {
  beforeEach(() => {
    resetPluginPathIndexCache();
  });

  it('indexes mounted plugin packages by package.json name', () => {
    const index = buildPluginPathIndex(pluginRoot, ['@forepath/']);

    expect(index.get('@forepath/test/mounted-plugin-fixture')).toMatchObject({
      source: 'plugin-path',
      specifier: '@forepath/test/mounted-plugin-fixture',
    });
  });
});
