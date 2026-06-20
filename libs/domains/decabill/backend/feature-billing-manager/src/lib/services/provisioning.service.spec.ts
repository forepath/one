import { ProvisioningService } from './provisioning.service';

describe('ProvisioningService', () => {
  const digitalocean = {
    provisionServer: jest.fn().mockResolvedValue({ serverId: '2' }),
    deprovisionServer: jest.fn().mockResolvedValue(undefined),
    getServerInfo: jest.fn().mockResolvedValue({
      serverId: '2',
      name: 'do-srv',
      publicIp: '5.6.7.8',
      status: 'active',
    }),
    startServer: jest.fn().mockResolvedValue(undefined),
    stopServer: jest.fn().mockResolvedValue(undefined),
    restartServer: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('routes to Hetzner provisioning', async () => {
    const hetzner: { provisionServer: jest.Mock } = {
      provisionServer: jest.fn().mockResolvedValue({ serverId: '1' }),
    };
    const service = new ProvisioningService(hetzner as never, digitalocean as never);
    const result = await service.provision('hetzner', { name: 'test' });

    expect(result).toEqual({ serverId: '1' });
  });

  it('routes to DigitalOcean provisioning', async () => {
    const hetzner: { provisionServer: jest.Mock } = {
      provisionServer: jest.fn(),
    };
    const service = new ProvisioningService(hetzner as never, digitalocean as never);
    const result = await service.provision('digital-ocean', { name: 'test' });

    expect(result).toEqual({ serverId: '2' });
    expect(digitalocean.provisionServer).toHaveBeenCalledWith({ name: 'test' });
  });

  it('routes deprovision to Hetzner', async () => {
    const hetzner: { provisionServer: jest.Mock; deprovisionServer: jest.Mock } = {
      provisionServer: jest.fn(),
      deprovisionServer: jest.fn().mockResolvedValue(undefined),
    };
    const service = new ProvisioningService(hetzner as never, digitalocean as never);

    await service.deprovision('hetzner', 'server-123');
    expect(hetzner.deprovisionServer).toHaveBeenCalledWith('server-123');
  });

  it('routes deprovision to DigitalOcean', async () => {
    const hetzner: { provisionServer: jest.Mock; deprovisionServer: jest.Mock } = {
      provisionServer: jest.fn(),
      deprovisionServer: jest.fn(),
    };
    const service = new ProvisioningService(hetzner as never, digitalocean as never);

    await service.deprovision('digital-ocean', 'server-456');
    expect(digitalocean.deprovisionServer).toHaveBeenCalledWith('server-456');
  });

  it('ignores deprovision for unknown provider', async () => {
    const hetzner: { provisionServer: jest.Mock; deprovisionServer: jest.Mock } = {
      provisionServer: jest.fn(),
      deprovisionServer: jest.fn(),
    };
    const service = new ProvisioningService(hetzner as never, digitalocean as never);

    await service.deprovision('unknown', 'server-123');
    expect(hetzner.deprovisionServer).not.toHaveBeenCalled();
    expect(digitalocean.deprovisionServer).not.toHaveBeenCalled();
  });

  it('returns null for unknown provider', async () => {
    const hetzner: { provisionServer: jest.Mock } = { provisionServer: jest.fn() };
    const service = new ProvisioningService(hetzner as never, digitalocean as never);
    const result = await service.provision('unknown', { name: 'test' });

    expect(result).toBeNull();
  });

  it('routes getServerInfo to Hetzner', async () => {
    const serverInfo = {
      serverId: '123',
      name: 'srv',
      publicIp: '1.2.3.4',
      status: 'running',
    };
    const hetzner: { getServerInfo: jest.Mock } = {
      getServerInfo: jest.fn().mockResolvedValue(serverInfo),
    };
    const service = new ProvisioningService(hetzner as never, digitalocean as never);
    const result = await service.getServerInfo('hetzner', '123');

    expect(result).toEqual(serverInfo);
    expect(hetzner.getServerInfo).toHaveBeenCalledWith('123');
  });

  it('routes getServerInfo to DigitalOcean', async () => {
    const hetzner: { getServerInfo: jest.Mock } = { getServerInfo: jest.fn() };
    const service = new ProvisioningService(hetzner as never, digitalocean as never);
    const result = await service.getServerInfo('digital-ocean', '456');

    expect(result).toEqual({
      serverId: '2',
      name: 'do-srv',
      publicIp: '5.6.7.8',
      status: 'active',
    });
    expect(digitalocean.getServerInfo).toHaveBeenCalledWith('456');
  });

  it('returns null for getServerInfo with unknown provider', async () => {
    const hetzner: { getServerInfo: jest.Mock } = { getServerInfo: jest.fn() };
    const service = new ProvisioningService(hetzner as never, digitalocean as never);
    const result = await service.getServerInfo('unknown', '123');

    expect(result).toBeNull();
    expect(hetzner.getServerInfo).not.toHaveBeenCalled();
    expect(digitalocean.getServerInfo).not.toHaveBeenCalled();
  });

  it('routes startServer to Hetzner', async () => {
    const hetzner: { startServer: jest.Mock } = {
      startServer: jest.fn().mockResolvedValue(undefined),
    };
    const service = new ProvisioningService(hetzner as never, digitalocean as never);

    await service.startServer('hetzner', '123');
    expect(hetzner.startServer).toHaveBeenCalledWith('123');
  });

  it('routes startServer to DigitalOcean', async () => {
    const hetzner: { startServer: jest.Mock } = { startServer: jest.fn() };
    const service = new ProvisioningService(hetzner as never, digitalocean as never);

    await service.startServer('digital-ocean', '123');
    expect(digitalocean.startServer).toHaveBeenCalledWith('123');
  });

  it('does nothing for startServer with unknown provider', async () => {
    const hetzner: { startServer: jest.Mock } = { startServer: jest.fn() };
    const service = new ProvisioningService(hetzner as never, digitalocean as never);

    await service.startServer('unknown', '123');
    expect(hetzner.startServer).not.toHaveBeenCalled();
    expect(digitalocean.startServer).not.toHaveBeenCalled();
  });

  it('routes stopServer to Hetzner', async () => {
    const hetzner: { stopServer: jest.Mock } = {
      stopServer: jest.fn().mockResolvedValue(undefined),
    };
    const service = new ProvisioningService(hetzner as never, digitalocean as never);

    await service.stopServer('hetzner', '123');
    expect(hetzner.stopServer).toHaveBeenCalledWith('123');
  });

  it('routes stopServer to DigitalOcean', async () => {
    const hetzner: { stopServer: jest.Mock } = { stopServer: jest.fn() };
    const service = new ProvisioningService(hetzner as never, digitalocean as never);

    await service.stopServer('digital-ocean', '123');
    expect(digitalocean.stopServer).toHaveBeenCalledWith('123');
  });

  it('does nothing for stopServer with unknown provider', async () => {
    const hetzner: { stopServer: jest.Mock } = { stopServer: jest.fn() };
    const service = new ProvisioningService(hetzner as never, digitalocean as never);

    await service.stopServer('unknown', '123');
    expect(hetzner.stopServer).not.toHaveBeenCalled();
    expect(digitalocean.stopServer).not.toHaveBeenCalled();
  });

  it('routes restartServer to Hetzner', async () => {
    const hetzner: { restartServer: jest.Mock } = {
      restartServer: jest.fn().mockResolvedValue(undefined),
    };
    const service = new ProvisioningService(hetzner as never, digitalocean as never);

    await service.restartServer('hetzner', '123');
    expect(hetzner.restartServer).toHaveBeenCalledWith('123');
  });

  it('routes restartServer to DigitalOcean', async () => {
    const hetzner: { restartServer: jest.Mock } = { restartServer: jest.fn() };
    const service = new ProvisioningService(hetzner as never, digitalocean as never);

    await service.restartServer('digital-ocean', '123');
    expect(digitalocean.restartServer).toHaveBeenCalledWith('123');
  });

  it('does nothing for restartServer with unknown provider', async () => {
    const hetzner: { restartServer: jest.Mock } = { restartServer: jest.fn() };
    const service = new ProvisioningService(hetzner as never, digitalocean as never);

    await service.restartServer('unknown', '123');
    expect(hetzner.restartServer).not.toHaveBeenCalled();
    expect(digitalocean.restartServer).not.toHaveBeenCalled();
  });

  it('ensurePublicIpForDns returns IP from initial when already set', async () => {
    const hetzner = { getServerInfo: jest.fn() };
    const digitalocean = { getServerInfo: jest.fn() };
    const service = new ProvisioningService(hetzner as never, digitalocean as never);
    const ip = await service.ensurePublicIpForDns('digital-ocean', '1', {
      serverId: '1',
      name: 'x',
      publicIp: '9.8.7.6',
      status: 'active',
    });

    expect(ip).toBe('9.8.7.6');
    expect(digitalocean.getServerInfo).not.toHaveBeenCalled();
  });

  it('ensurePublicIpForDns does not poll for Hetzner when IP is missing', async () => {
    const hetzner = { getServerInfo: jest.fn() };
    const digitalocean = { getServerInfo: jest.fn() };
    const service = new ProvisioningService(hetzner as never, digitalocean as never);
    const ip = await service.ensurePublicIpForDns('hetzner', '1', {
      serverId: '1',
      name: 'x',
      publicIp: '',
      status: 'initializing',
    });

    expect(ip).toBeUndefined();
    expect(hetzner.getServerInfo).not.toHaveBeenCalled();
  });

  it('ensurePublicIpForDns polls DigitalOcean until public IPv4 appears', async () => {
    jest.useFakeTimers();

    try {
      const hetzner = {};
      const digitalocean = {
        getServerInfo: jest
          .fn()
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
          }),
      };
      const service = new ProvisioningService(hetzner as never, digitalocean as never);
      const promise = service.ensurePublicIpForDns('digital-ocean', '1', null);

      await Promise.resolve();
      await jest.advanceTimersByTimeAsync(2000);
      await expect(promise).resolves.toBe('5.5.5.5');
      expect(digitalocean.getServerInfo).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });
});
