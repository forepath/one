import type { ModuleRef } from '@nestjs/core';

export const DEFAULT_SPECIFIER_ALLOWLIST_PREFIXES = ['@forepath/', '@agenstra/'] as const;

export const DYNAMIC_PROVIDERS_FAIL_FAST_ENV = 'DYNAMIC_PROVIDERS_FAIL_FAST';

export const DYNAMIC_PROVIDER_PLUGIN_PATH_ENV = 'DYNAMIC_PROVIDER_PLUGIN_PATH';

export const DYNAMIC_PROVIDER_PLUGIN_INSTALL_ENV = 'DYNAMIC_PROVIDER_PLUGIN_INSTALL';

export type RegistryCriticality = 'critical' | 'optional';

export type ProviderLoadSource = 'baked-in' | 'plugin-path';

export type ProviderCreateFactory<T> = (moduleRef: ModuleRef) => T | Promise<T>;

export interface ProviderPackageEntry {
  /**
   * Optional non-PascalCase label used in logs (e.g. `custom` in `custom=@forepath/foo`).
   */
  alias?: string;
  /**
   * Package specifier (e.g. `@forepath/agenstra/backend/provisioning-custom`) or `file:relative-dir`.
   */
  specifier: string;
  /**
   * PascalCase class export name when not using `createProvider`.
   */
  classExport?: string;
  /**
   * Relative path under the plugin root when specifier uses `file:`.
   */
  pluginRelativePath?: string;
}

export interface ProviderLoadTarget {
  source: ProviderLoadSource;
  /** Logical package id for logs and export hints. */
  specifier: string;
  /** Absolute path to package root directory. */
  entryPath: string;
  /** Absolute path to package.json. */
  packageJsonPath: string;
  /** Resolved main entry file path. */
  mainPath: string;
}

export interface ProviderMetadataRecord {
  id: string;
  displayName: string;
  configSchema?: Record<string, unknown>;
}

export interface LoadedProviderModule {
  entry: ProviderPackageEntry;
  module: Record<string, unknown>;
}

export interface AssertRuntimeDependencyOptions {
  appRoot?: string;
  envKey?: string;
  allowlistPrefixes?: readonly string[];
}

export interface ResolveProviderLoadTargetOptions {
  appRoot?: string;
  pluginPath?: string;
  envKey?: string;
  allowlistPrefixes?: readonly string[];
}

export interface LoadProviderModuleOptions extends ResolveProviderLoadTargetOptions {
  envKey?: string;
}

export interface ResolveProviderExportOptions {
  entry: ProviderPackageEntry;
  loadTarget?: ProviderLoadTarget;
  /**
   * When true, allows generic `provider` / `Provider` exports (test fixtures only).
   */
  allowTestFixtureExports?: boolean;
}

export interface DynamicProviderRegistrationOptions<T> {
  envKey: string;
  criticality: RegistryCriticality;
  register: (instance: T) => void;
  dynamicLoader: {
    loadInstances: (
      envKey: string,
      criticality: RegistryCriticality,
      options?: { failFast?: boolean; appRoot?: string; pluginPath?: string },
    ) => Promise<T[]>;
  };
  failFast?: boolean;
  loggerContext?: string;
}

export interface DynamicProviderMetadataRegistrationOptions {
  envKey: string;
  criticality: RegistryCriticality;
  register: (metadata: ProviderMetadataRecord) => void;
  dynamicLoader: {
    loadMetadata: (
      envKey: string,
      criticality: RegistryCriticality,
      options?: { failFast?: boolean; appRoot?: string; pluginPath?: string },
    ) => Promise<ProviderMetadataRecord[]>;
  };
  failFast?: boolean;
  loggerContext?: string;
}
