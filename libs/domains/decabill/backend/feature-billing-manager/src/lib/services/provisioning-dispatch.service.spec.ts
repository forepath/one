import { ProviderModuleRegistryService } from './provider-module-registry.service';
import { ProvisioningDispatchService } from './provisioning-dispatch.service';

describe('ProvisioningDispatchService', () => {
  const credentials = { apiToken: 'token' };

  function createDispatch(
    modules: Parameters<ProviderModuleRegistryService['register']>[0][],
  ): ProvisioningDispatchService {
    const registry = new ProviderModuleRegistryService();

    for (const module of modules) {
      registry.register(module);
    }

    return new ProvisioningDispatchService(registry);
  }

  const hetznerModule = {
    id: 'hetzner',
    collectMeters: async () => [],
    provision: jest.fn().mockResolvedValue({ serverId: '1' }),
    deprovision: jest.fn().mockResolvedValue(undefined),
    getServerInfo: jest.fn().mockResolvedValue({
      serverId: '123',
      name: 'srv',
      publicIp: '1.2.3.4',
      status: 'running',
    }),
    startServer: jest.fn().mockResolvedValue(undefined),
    stopServer: jest.fn().mockResolvedValue(undefined),
    restartServer: jest.fn().mockResolvedValue(undefined),
    changeServerType: jest.fn().mockResolvedValue(undefined),
  };
  const digitalOceanModule = {
    id: 'digital-ocean',
    collectMeters: async () => [],
    provision: jest.fn().mockResolvedValue({ serverId: '2' }),
    deprovision: jest.fn().mockResolvedValue(undefined),
    getServerInfo: jest.fn().mockResolvedValue({
      serverId: '2',
      name: 'do-srv',
      publicIp: '5.6.7.8',
      status: 'active',
    }),
    startServer: jest.fn().mockResolvedValue(undefined),
    stopServer: jest.fn().mockResolvedValue(undefined),
    restartServer: jest.fn().mockResolvedValue(undefined),
    changeServerType: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses the registered hetzner module for provision', async () => {
    const dispatch = createDispatch([hetznerModule, digitalOceanModule]);
    const result = await dispatch.provision('hetzner', { name: 'test' }, credentials);

    expect(result).toEqual({ serverId: '1' });
    expect(hetznerModule.provision).toHaveBeenCalledWith({ name: 'test' }, credentials);
  });

  it('uses the registered digital-ocean module for provision', async () => {
    const dispatch = createDispatch([hetznerModule, digitalOceanModule]);
    const result = await dispatch.provision('digital-ocean', { name: 'test' });

    expect(result).toEqual({ serverId: '2' });
    expect(digitalOceanModule.provision).toHaveBeenCalledWith({ name: 'test' }, undefined);
  });

  it('throws for unknown provider instead of returning null', async () => {
    const dispatch = createDispatch([hetznerModule]);

    await expect(dispatch.provision('unknown', { name: 'test' })).rejects.toThrow('Unknown provisioning provider');
  });

  it('throws when the provider is registered without provision hook', async () => {
    const dispatch = createDispatch([
      {
        id: 'meter-only',
        collectMeters: async () => [],
      },
    ]);

    await expect(dispatch.provision('meter-only', { name: 'test' })).rejects.toThrow(
      'Provisioning provider is not provisionable: meter-only',
    );
  });

  it('throws for deprovision on unknown provider', async () => {
    const dispatch = createDispatch([hetznerModule]);

    await expect(dispatch.deprovision('unknown', 'server-123')).rejects.toThrow('Unknown provisioning provider');
  });

  it('routes lifecycle hooks to the registered module', async () => {
    const dispatch = createDispatch([hetznerModule, digitalOceanModule]);

    await dispatch.deprovision('hetzner', 'server-123', credentials);
    await dispatch.startServer('digital-ocean', '456');
    await dispatch.changeServerType('hetzner', '123', 'cx21', { isUpgrade: true, credentials });

    expect(hetznerModule.deprovision).toHaveBeenCalledWith('server-123', credentials);
    expect(digitalOceanModule.startServer).toHaveBeenCalledWith('456', undefined);
    expect(hetznerModule.changeServerType).toHaveBeenCalledWith('123', 'cx21', {
      isUpgrade: true,
      credentials,
    });
  });

  it('ensurePublicIpForDns returns IP from initial when already set', async () => {
    const dispatch = createDispatch([digitalOceanModule]);
    const ip = await dispatch.ensurePublicIpForDns('digital-ocean', '1', {
      serverId: '1',
      name: 'x',
      publicIp: '9.8.7.6',
      status: 'active',
    });

    expect(ip).toBe('9.8.7.6');
    expect(digitalOceanModule.getServerInfo).not.toHaveBeenCalled();
  });

  it('ensurePublicIpForDns polls DigitalOcean until public IPv4 appears', async () => {
    jest.useFakeTimers();

    try {
      digitalOceanModule.getServerInfo
        .mockResolvedValueOnce({
          serverId: '1',
          name: 'd',
          publicIp: '',
          status: 'new',
        })
        .mockResolvedValueOnce({
          serverId: '1',
          name: 'd',
          publicIp: '5.5.5.5',
          status: 'active',
        });

      const dispatch = createDispatch([digitalOceanModule]);
      const promise = dispatch.ensurePublicIpForDns('digital-ocean', '1', null);

      await Promise.resolve();
      await jest.advanceTimersByTimeAsync(2000);
      await expect(promise).resolves.toBe('5.5.5.5');
      expect(digitalOceanModule.getServerInfo).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });
});
