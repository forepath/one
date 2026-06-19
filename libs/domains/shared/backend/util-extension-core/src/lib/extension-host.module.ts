import { DynamicModule, Logger, Type } from '@nestjs/common';

import { PluginResolver } from './plugin-resolver';
import { ProviderRegistry, TypedProvider } from './provider-registry';
import { readExtensionsFromEnv } from './read-extensions-from-env';

import type { LoadedExtension } from './types';

export interface ExtensionHostModuleOptions<T extends TypedProvider> {
  hostModule: Type<unknown>;
  kind: string;
  registryToken: string | symbol;
  loadedExtensionsToken: string | symbol;
  extensionsEnvKey: string;
  defaultExtensions: readonly string[];
  workspaceRoot?: string;
}

export function createExtensionHostModule<T extends TypedProvider>(
  options: ExtensionHostModuleOptions<T>,
): DynamicModule {
  const logger = new Logger('ExtensionHostModule');
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const resolver = new PluginResolver({ workspaceRoot, expectedKind: options.kind });
  const specifiers = readExtensionsFromEnv(options.extensionsEnvKey, options.defaultExtensions);
  const loadedExtensions = specifiers.map((specifier) => resolver.resolveSync(specifier));
  const extensionModules = loadedExtensions.map((item) => item.extension.register());
  const instanceTokens = loadedExtensions.map((item) => item.extension.getInstanceToken());

  for (const item of loadedExtensions) {
    logger.log(`Registered extension host binding for ${item.manifest.id} v${item.manifest.version}`);
  }

  return {
    module: options.hostModule,
    imports: extensionModules,
    providers: [
      {
        provide: options.registryToken,
        useFactory: (...instances: T[]) => {
          const registry = new ProviderRegistry<T>();

          loadedExtensions.forEach((item, index) => {
            const instance = instances[index];
            const runtimeType = instance.getType();

            if (runtimeType !== item.manifest.id) {
              throw new Error(
                `Extension manifest id '${item.manifest.id}' does not match provider getType() '${runtimeType}'.`,
              );
            }

            registry.register(item.manifest.id, instance);
          });

          return registry;
        },
        inject: instanceTokens,
      },
      {
        provide: options.loadedExtensionsToken,
        useValue: loadedExtensions as LoadedExtension<T>[],
      },
    ],
    exports: [options.registryToken, options.loadedExtensionsToken],
  };
}

export function getExtensionManifests<T extends TypedProvider>(loaded: LoadedExtension<T>[]) {
  return loaded.map((item) => item.manifest);
}
