import { ProviderCatalogDispatchService } from './provider-catalog-dispatch.service';
import { ProviderModuleRegistryService } from './provider-module-registry.service';
import { ProviderRegistryService } from './provider-registry.service';

describe('ProviderCatalogDispatchService', () => {
  it('returns empty catalog lists for unknown providers', async () => {
    const modules = new ProviderModuleRegistryService();
    const metadata = new ProviderRegistryService();
    const dispatch = new ProviderCatalogDispatchService(modules, metadata);

    await expect(dispatch.getLocations('unknown')).resolves.toEqual([]);
    await expect(dispatch.getServerTypes('unknown')).resolves.toEqual([]);
    await expect(dispatch.checkAvailability('unknown', 'fsn1', 'cx11')).resolves.toEqual({ isAvailable: true });
  });

  it('delegates catalog and availability hooks to the registered module', async () => {
    const modules = new ProviderModuleRegistryService();
    const metadata = new ProviderRegistryService();
    const module = {
      id: 'hetzner',
      collectMeters: async () => [],
      getLocations: jest.fn().mockResolvedValue([{ id: 'fsn1', name: 'Falkenstein' }]),
      getServerTypes: jest.fn().mockResolvedValue([{ id: 'cx11', name: 'CX11', cores: 1, memory: 2, disk: 20 }]),
      checkAvailability: jest.fn().mockResolvedValue({ isAvailable: false, reason: 'Sold out' }),
    };

    modules.register(module);
    const dispatch = new ProviderCatalogDispatchService(modules, metadata);

    await expect(dispatch.getLocations('hetzner')).resolves.toEqual([{ id: 'fsn1', name: 'Falkenstein' }]);
    await expect(dispatch.getServerTypes('hetzner')).resolves.toEqual([
      { id: 'cx11', name: 'CX11', cores: 1, memory: 2, disk: 20 },
    ]);
    await expect(dispatch.checkAvailability('hetzner', 'fsn1', 'cx11')).resolves.toEqual({
      isAvailable: false,
      reason: 'Sold out',
    });
  });

  it('detects provisioning-capable providers', () => {
    const modules = new ProviderModuleRegistryService();
    const metadata = new ProviderRegistryService();

    modules.register({ id: 'hetzner', collectMeters: async () => [], provision: async () => ({ serverId: '1' }) });
    modules.register({ id: 'meter-only', collectMeters: async () => [] });
    metadata.register({ id: 'hetzner', displayName: 'Hetzner' });

    const dispatch = new ProviderCatalogDispatchService(modules, metadata);

    expect(dispatch.requiresProvisioning('hetzner')).toBe(true);
    expect(dispatch.requiresProvisioning('meter-only')).toBe(false);
    expect(dispatch.hasRegisteredMetadata('hetzner')).toBe(true);
  });
});
