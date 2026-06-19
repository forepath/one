import {
  applyExtensionWebpackExternals,
  collectNpmPackagesFromExtensionEnvKeys,
  createExtensionExternalsPredicate,
  extractNpmPackageFromSpecifier,
} from './webpack-externals';

describe('webpack-externals', () => {
  const envKey = 'TEST_WEBPACK_EXTENSIONS';

  afterEach(() => {
    delete process.env[envKey];
  });

  it('extracts npm package names from specifiers', () => {
    expect(extractNpmPackageFromSpecifier('npm:@acme/my-extension')).toBe('@acme/my-extension');
    expect(extractNpmPackageFromSpecifier('@forepath/agenstra/backend/provider-cursor')).toBeUndefined();
  });

  it('collects npm packages from extension env keys', () => {
    process.env[envKey] = '@forepath/agenstra/backend/provider-cursor,npm:@acme/pkg-a, npm:@scope/pkg-b ,file:./local';

    expect(collectNpmPackagesFromExtensionEnvKeys([envKey])).toEqual(['@acme/pkg-a', '@scope/pkg-b']);
  });

  it('externalizes exact and subpath npm package requests', () => {
    const predicate = createExtensionExternalsPredicate(['@acme/my-extension']);
    const callback = jest.fn();

    predicate({ request: '@acme/my-extension' }, callback);
    expect(callback).toHaveBeenCalledWith(null, 'commonjs @acme/my-extension');

    callback.mockClear();
    predicate({ request: '@acme/my-extension/subpath' }, callback);
    expect(callback).toHaveBeenCalledWith(null, 'commonjs @acme/my-extension/subpath');

    callback.mockClear();
    predicate({ request: 'other-package' }, callback);
    expect(callback).toHaveBeenCalledWith();
  });

  it('adds externals predicate to webpack config when npm packages are configured', () => {
    process.env[envKey] = 'npm:@acme/external-plugin';

    const config: { externals?: unknown } = {};

    applyExtensionWebpackExternals(config, { extensionsEnvKeys: [envKey] });

    expect(Array.isArray(config.externals)).toBe(true);
    expect(config.externals).toHaveLength(1);
  });

  it('leaves webpack config unchanged when no npm packages are configured', () => {
    const config = { externals: { existing: true } };

    applyExtensionWebpackExternals(config, { extensionsEnvKeys: [envKey] });

    expect(config.externals).toEqual({ existing: true });
  });
});
