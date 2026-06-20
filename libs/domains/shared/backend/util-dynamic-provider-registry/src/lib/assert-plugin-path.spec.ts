import { join } from 'node:path';

import { PluginPathSecurityError, assertPathUnderPluginRoot } from './assert-plugin-path';

const pluginRoot = join(__dirname, '../test-fixtures/plugin-root');

describe('assertPathUnderPluginRoot', () => {
  it('allows relative paths under plugin root', () => {
    expect(assertPathUnderPluginRoot('mounted-plugin-fixture', pluginRoot)).toContain('mounted-plugin-fixture');
  });

  it('rejects traversal outside plugin root', () => {
    expect(() => assertPathUnderPluginRoot('../runtime-provider-fixture', pluginRoot)).toThrow(PluginPathSecurityError);
  });
});
