import { AddonModuleRegistryService, type BillingAddonModule } from './addon-module-registry.service';
import { CloudInitModuleRegistryService } from './cloud-init-module-registry.service';
import { ContributorJobRegistryService } from './contributor-job-registry.service';
import { IntegratedStackRegistryService } from './integrated-stack-registry.service';
import { ProviderModuleRegistryService, type BillingProviderModule } from './provider-module-registry.service';

describe('ContributorJobRegistryService', () => {
  const run = jest.fn().mockResolvedValue(undefined);
  const createProvider = (id: string, jobs?: BillingProviderModule['jobs']): BillingProviderModule => ({
    id,
    collectMeters: jest.fn().mockResolvedValue([]),
    jobs,
  });
  const createAddon = (key: string, jobs?: BillingAddonModule['jobs']): BillingAddonModule => ({
    key,
    displayName: key,
    jobs,
    provision: jest.fn().mockResolvedValue(undefined),
    teardown: jest.fn().mockResolvedValue(undefined),
  });

  it('flattens jobs from provider, addon, integrated, and CloudInit modules', () => {
    const providers = new ProviderModuleRegistryService();
    const addons = new AddonModuleRegistryService();
    const stacks = new IntegratedStackRegistryService();
    const cloudInit = new CloudInitModuleRegistryService();
    const registry = new ContributorJobRegistryService(addons, stacks, cloudInit, providers);

    providers.register(createProvider('hetzner', [{ key: 'sync-prices', intervalMs: 120_000, run }]));
    addons.register(createAddon('container-manager', [{ key: 'collect-stats', intervalMs: 60_000, run }]));
    stacks.register({
      key: 'agenstra-controller',
      displayName: 'Controller',
      jobs: [{ key: 'sync', intervalMs: 30_000, run }],
    });
    cloudInit.register({
      key: 'my-app',
      displayName: 'My App',
      jobs: [{ key: 'ping', intervalMs: 45_000, run }],
    });

    registry.rebuild();

    expect(registry.list()).toEqual([
      expect.objectContaining({
        source: 'provider',
        sourceKey: 'hetzner',
        definition: expect.objectContaining({ key: 'sync-prices' }),
      }),
      expect.objectContaining({
        source: 'addon',
        sourceKey: 'container-manager',
        definition: expect.objectContaining({ key: 'collect-stats' }),
      }),
      expect.objectContaining({
        source: 'integrated',
        sourceKey: 'agenstra-controller',
        definition: expect.objectContaining({ key: 'sync' }),
      }),
      expect.objectContaining({
        source: 'cloud-init',
        sourceKey: 'my-app',
        definition: expect.objectContaining({ key: 'ping' }),
      }),
    ]);
  });

  it('rejects duplicate (source, sourceKey, key)', () => {
    const providers = new ProviderModuleRegistryService();
    const addons = new AddonModuleRegistryService();
    const stacks = new IntegratedStackRegistryService();
    const cloudInit = new CloudInitModuleRegistryService();
    const registry = new ContributorJobRegistryService(addons, stacks, cloudInit, providers);

    addons.register(
      createAddon('container-manager', [
        { key: 'collect-stats', intervalMs: 60_000, run },
        { key: 'collect-stats', intervalMs: 90_000, run },
      ]),
    );

    expect(() => registry.rebuild()).toThrow('Duplicate contributor job registration');
  });

  it('allows the same job key on different sources', () => {
    const providers = new ProviderModuleRegistryService();
    const addons = new AddonModuleRegistryService();
    const stacks = new IntegratedStackRegistryService();
    const cloudInit = new CloudInitModuleRegistryService();
    const registry = new ContributorJobRegistryService(addons, stacks, cloudInit, providers);

    addons.register(createAddon('mod-a', [{ key: 'collect-stats', intervalMs: 60_000, run }]));
    stacks.register({
      key: 'mod-a',
      displayName: 'Stack A',
      jobs: [{ key: 'collect-stats', intervalMs: 60_000, run }],
    });

    registry.rebuild();

    expect(registry.list()).toHaveLength(2);
  });
});
