import { join } from 'node:path';

import { resetPluginPathIndexCache } from './plugin-path-index';
import { ProviderLoadTargetError, resolveProviderLoadTarget } from './resolve-provider-load-target';

const appRoot = join(__dirname, '../test-fixtures/app-root-fixture');
const pluginRoot = join(__dirname, '../test-fixtures/plugin-root');

describe('resolveProviderLoadTarget', () => {
  beforeEach(() => {
    resetPluginPathIndexCache();
  });

  it('resolves file: entries from plugin path', () => {
    const target = resolveProviderLoadTarget(
      {
        specifier: 'file:mounted-plugin-fixture',
        pluginRelativePath: 'mounted-plugin-fixture',
      },
      { appRoot, pluginPath: pluginRoot },
    );

    expect(target.source).toBe('plugin-path');
    expect(target.specifier).toBe('@forepath/test/mounted-plugin-fixture');
  });

  it('falls back to plugin path when package is not baked in', () => {
    const target = resolveProviderLoadTarget(
      { specifier: '@forepath/test/mounted-plugin-fixture' },
      { appRoot, pluginPath: pluginRoot },
    );

    expect(target.source).toBe('plugin-path');
  });

  it('fails when package is missing from baked-in graph and plugin path', () => {
    expect(() =>
      resolveProviderLoadTarget(
        { specifier: '@forepath/missing/package' },
        { appRoot, pluginPath: pluginRoot, envKey: 'DYNAMIC_TEST' },
      ),
    ).toThrow(ProviderLoadTargetError);
  });
});
