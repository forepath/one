import { DynamicModule, Module } from '@nestjs/common';

import {
  createExtensionHostModule,
  getExtensionManifests,
  LoadedExtension,
  TypedProvider,
} from '@forepath/shared/backend/util-extension-core';

import { BillingProvisioningMetadataRegistry } from './billing-provisioning-metadata.registry';
import { DecabillExtensionKind } from './kinds';
import { DECABILL_LOADED_EXTENSIONS } from './tokens';

export interface DecabillPluginHostModuleOptions<T extends TypedProvider = TypedProvider> {
  kind: DecabillExtensionKind;
  registryToken: string | symbol;
  extensionsEnvKey: string;
  defaultExtensions: readonly string[];
  workspaceRoot?: string;
}

@Module({})
export class DecabillPluginHostModule {
  static forRootAsync<T extends TypedProvider>(options: DecabillPluginHostModuleOptions<T>): DynamicModule {
    const dynamicModule = createExtensionHostModule<T>({
      hostModule: DecabillPluginHostModule,
      kind: options.kind,
      registryToken: options.registryToken,
      loadedExtensionsToken: DECABILL_LOADED_EXTENSIONS,
      extensionsEnvKey: options.extensionsEnvKey,
      defaultExtensions: options.defaultExtensions,
      workspaceRoot: options.workspaceRoot,
    });

    if (options.kind !== 'billing-provisioning-provider') {
      return dynamicModule;
    }

    return {
      ...dynamicModule,
      providers: [
        ...(dynamicModule.providers ?? []),
        {
          provide: BillingProvisioningMetadataRegistry,
          useFactory: (loaded: LoadedExtension<T>[]) => {
            const metadataRegistry = new BillingProvisioningMetadataRegistry();

            for (const item of loaded) {
              metadataRegistry.registerFromManifest(item.manifest);
            }

            return metadataRegistry;
          },
          inject: [DECABILL_LOADED_EXTENSIONS],
        },
      ],
      exports: [...(dynamicModule.exports ?? []), BillingProvisioningMetadataRegistry],
    };
  }
}

export function getDecabillExtensionManifests<T extends TypedProvider>(
  loaded: LoadedExtension<T>[],
  kind?: DecabillExtensionKind,
) {
  const manifests = getExtensionManifests(loaded);

  if (!kind) {
    return manifests;
  }

  return manifests.filter((manifest) => manifest.kind === kind);
}
