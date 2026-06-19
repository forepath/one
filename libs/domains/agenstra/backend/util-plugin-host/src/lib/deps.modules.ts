import { DynamicModule, Module } from '@nestjs/common';

export interface PluginDepsModuleOptions {
  imports?: DynamicModule['imports'];
  providers?: DynamicModule['providers'];
  exports?: DynamicModule['exports'];
}

function createDepsModule(name: string) {
  @Module({})
  class DepsModule {
    static forRoot(options: PluginDepsModuleOptions = {}): DynamicModule {
      return {
        module: DepsModule,
        global: true,
        imports: options.imports ?? [],
        providers: options.providers ?? [],
        exports: options.exports ?? [],
      };
    }
  }

  return DepsModule;
}

/** Shared dependencies for agent provider plugins (DockerService, etc.). */
export const AgentProviderDepsModule = createDepsModule('AgentProviderDepsModule');

/** Shared dependencies for chat filter plugins (TypeORM feature imports). */
export const ChatFilterDepsModule = createDepsModule('ChatFilterDepsModule');

/** Shared dependencies for cloud provisioning provider plugins. */
export const ProvisioningProviderDepsModule = createDepsModule('ProvisioningProviderDepsModule');

/** Shared dependencies for external context import provider plugins. */
export const ExternalImportDepsModule = createDepsModule('ExternalImportDepsModule');

/** Shared dependencies for embedding provider plugins. */
export const EmbeddingDepsModule = createDepsModule('EmbeddingDepsModule');
