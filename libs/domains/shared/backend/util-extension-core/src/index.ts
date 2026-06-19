export { ExtensionCoreModule } from './lib/extension-core.module';
export { createExtensionHostModule, getExtensionManifests } from './lib/extension-host.module';
export type { ExtensionHostModuleOptions } from './lib/extension-host.module';
export {
  DEFAULT_EXTENSION_VERSION,
  loadExtensionManifest,
  loadExtensionManifestFromFile,
  normalizeForepathExtensionManifest,
  resolveManifestPath,
  validateForepathExtensionManifest,
} from './lib/manifest-loader';
export { parseExtensionSpecifier } from './lib/parse-extension-specifier';
export { PluginResolver } from './lib/plugin-resolver';
export type { PluginResolverOptions } from './lib/plugin-resolver';
export { ProviderRegistry } from './lib/provider-registry';
export type { TypedProvider } from './lib/provider-registry';
export { readExtensionsFromEnv } from './lib/read-extensions-from-env';
export {
  applyExtensionWebpackExternals,
  collectNpmPackagesFromExtensionEnvKeys,
  createExtensionExternalsPredicate,
  extractNpmPackageFromSpecifier,
} from './lib/webpack-externals';
export type { ExtensionWebpackExternalsOptions, WebpackConfigLike } from './lib/webpack-externals';
export { resolveMonorepoPackageRoot } from './lib/tsconfig-paths';
export type { ExtensionSpecifier, ForepathExtension, ForepathExtensionManifest, LoadedExtension } from './lib/types';
