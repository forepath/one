import { DynamicModule, Module } from '@nestjs/common';

import {
  createExtensionHostModule,
  getExtensionManifests,
  LoadedExtension,
  TypedProvider,
} from '@forepath/shared/backend/util-extension-core';

import { AgenstraExtensionKind } from './kinds';
import { AGENSTRA_LOADED_EXTENSIONS } from './tokens';

export interface AgenstraPluginHostModuleOptions<T extends TypedProvider = TypedProvider> {
  kind: AgenstraExtensionKind;
  registryToken: string | symbol;
  extensionsEnvKey: string;
  defaultExtensions: readonly string[];
  workspaceRoot?: string;
}

@Module({})
export class AgenstraPluginHostModule {
  static forRootAsync<T extends TypedProvider>(options: AgenstraPluginHostModuleOptions<T>): DynamicModule {
    return createExtensionHostModule<T>({
      hostModule: AgenstraPluginHostModule,
      kind: options.kind,
      registryToken: options.registryToken,
      loadedExtensionsToken: AGENSTRA_LOADED_EXTENSIONS,
      extensionsEnvKey: options.extensionsEnvKey,
      defaultExtensions: options.defaultExtensions,
      workspaceRoot: options.workspaceRoot,
    });
  }
}

export function getAgenstraExtensionManifests<T extends TypedProvider>(
  loaded: LoadedExtension<T>[],
  kind?: AgenstraExtensionKind,
) {
  const manifests = getExtensionManifests(loaded);

  if (!kind) {
    return manifests;
  }

  return manifests.filter((manifest) => manifest.kind === kind);
}
