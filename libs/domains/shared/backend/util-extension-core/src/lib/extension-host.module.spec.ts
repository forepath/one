import { createExtensionHostModule } from './extension-host.module';
import { ProviderRegistry } from './provider-registry';

import type { TypedProvider } from './provider-registry';

interface DemoProvider extends TypedProvider {
  label: string;
}

describe('createExtensionHostModule', () => {
  it('builds a dynamic module with registry and loaded extensions providers', () => {
    class HostModule {}

    const dynamicModule = createExtensionHostModule<DemoProvider>({
      hostModule: HostModule,
      kind: 'agent-provider',
      registryToken: 'REGISTRY',
      loadedExtensionsToken: 'LOADED',
      extensionsEnvKey: 'UNUSED',
      defaultExtensions: [],
    });

    expect(dynamicModule.module).toBe(HostModule);
    expect(dynamicModule.providers?.length).toBe(2);
    expect(dynamicModule.exports).toEqual(['REGISTRY', 'LOADED']);
  });

  it('rejects registry wiring when manifest id does not match getType()', () => {
    const registry = new ProviderRegistry<DemoProvider>();
    const loadedExtensions = [{ manifest: { id: 'expected-id' } }];
    const instances: DemoProvider[] = [{ getType: () => 'different-id', label: 'Demo' }];

    expect(() => {
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
    }).toThrow(/does not match provider getType/);
  });
});
