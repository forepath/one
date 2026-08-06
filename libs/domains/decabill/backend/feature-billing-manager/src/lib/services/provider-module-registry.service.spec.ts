import { ProviderModuleRegistryService } from './provider-module-registry.service';

describe('ProviderModuleRegistryService', () => {
  it('registers, gets, and lists modules', () => {
    const registry = new ProviderModuleRegistryService();
    const module = {
      id: 'acme',
      async collectMeters() {
        return [{ meterKey: 'cpu', value: 1 }];
      },
    };

    registry.register(module);

    expect(registry.has('acme')).toBe(true);
    expect(registry.get('acme')).toBe(module);
    expect(registry.list()).toEqual([module]);
  });
});
