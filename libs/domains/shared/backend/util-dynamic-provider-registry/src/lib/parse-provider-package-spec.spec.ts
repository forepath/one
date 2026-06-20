import { parseProviderPackageSpec, parseProviderPluginInstallSpec } from './parse-provider-package-spec';

describe('parseProviderPackageSpec', () => {
  it('returns empty array for undefined or blank input', () => {
    expect(parseProviderPackageSpec(undefined)).toEqual([]);
    expect(parseProviderPackageSpec('   ')).toEqual([]);
  });

  it('parses bare specifier entries', () => {
    expect(parseProviderPackageSpec('@forepath/foo/bar')).toEqual([{ specifier: '@forepath/foo/bar' }]);
  });

  it('parses alias and class export entries', () => {
    expect(
      parseProviderPackageSpec('custom=@forepath/foo/bar,CustomProvider=@forepath/foo/baz,@forepath/other'),
    ).toEqual([
      { alias: 'custom', specifier: '@forepath/foo/bar' },
      { classExport: 'CustomProvider', specifier: '@forepath/foo/baz' },
      { specifier: '@forepath/other' },
    ]);
  });

  it('throws when entry has empty specifier', () => {
    expect(() => parseProviderPackageSpec('broken=')).toThrow(
      "Invalid dynamic provider entry 'broken=': missing value after '='",
    );
  });
});

describe('parseProviderPackageSpec file entries', () => {
  it('parses bare file: entries', () => {
    expect(parseProviderPackageSpec('file:mounted-plugin-fixture')).toEqual([
      {
        specifier: 'file:mounted-plugin-fixture',
        pluginRelativePath: 'mounted-plugin-fixture',
      },
    ]);
  });

  it('parses alias=file entries', () => {
    expect(parseProviderPackageSpec('custom=file:mounted-plugin-fixture')).toEqual([
      {
        alias: 'custom',
        specifier: 'file:mounted-plugin-fixture',
        pluginRelativePath: 'mounted-plugin-fixture',
      },
    ]);
  });

  it('rejects file: combined with package-style value', () => {
    expect(() => parseProviderPackageSpec('file:@forepath/foo')).toThrow(
      "'file:' entries cannot use package specifiers",
    );
  });
});

describe('parseProviderPluginInstallSpec', () => {
  it('parses comma-separated install targets', () => {
    expect(parseProviderPluginInstallSpec('file:foo.tgz,@forepath/bar@1.0.0')).toEqual([
      'file:foo.tgz',
      '@forepath/bar@1.0.0',
    ]);
  });
});
