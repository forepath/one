import { BadRequestException, NotFoundException } from '@nestjs/common';

import { ContainerManagerService } from './container-manager.service';

describe('ContainerManagerService', () => {
  const subscriptionsRepository = {
    findByIdOrThrow: jest.fn(),
  };
  const subscriptionItemsRepository = {
    findByIdAndSubscriptionId: jest.fn(),
  };
  const subscriptionAddonsRepository = {
    findActiveBySubscriptionId: jest.fn(),
  };
  const servicePlansRepository = {
    findByIdOrThrow: jest.fn(),
  };
  const sshExecutor = {
    waitUntilReachable: jest.fn().mockResolvedValue(undefined),
    exec: jest.fn(),
  };
  const addonModuleRegistry = {
    has: jest.fn().mockReturnValue(true),
  };
  const billingNotificationPublisher = {
    publish: jest.fn(),
  };
  const samplesRepository = {
    findLatestPoints: jest.fn().mockResolvedValue([]),
  };
  const summariesRepository = {
    findByItemId: jest.fn().mockResolvedValue(null),
  };

  const service = new ContainerManagerService(
    subscriptionsRepository as never,
    subscriptionItemsRepository as never,
    subscriptionAddonsRepository as never,
    servicePlansRepository as never,
    sshExecutor as never,
    addonModuleRegistry as never,
    billingNotificationPublisher as never,
    samplesRepository as never,
    summariesRepository as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    addonModuleRegistry.has.mockReturnValue(true);
    subscriptionsRepository.findByIdOrThrow.mockResolvedValue({
      id: 'sub-1',
      userId: 'user-1',
      planId: 'plan-1',
      status: 'active',
    });
    subscriptionAddonsRepository.findActiveBySubscriptionId.mockResolvedValue([
      {
        status: 'active',
        addon: {
          id: 'addon-1',
          key: 'container-manager',
          moduleKey: 'container-manager',
          implementationType: 'module',
          name: 'Container Manager',
        },
      },
    ]);
    subscriptionItemsRepository.findByIdAndSubscriptionId.mockResolvedValue({
      id: 'item-1',
      sshPrivateKey: 'KEY',
      providerReference: 'srv-1',
      provisioningStatus: 'active',
      serverInfoSnapshot: { publicIp: '1.2.3.4' },
    });
  });

  it('lists containers via SSH docker commands', async () => {
    sshExecutor.exec
      .mockResolvedValueOnce({
        code: 0,
        stdout: `${JSON.stringify({ ID: 'abcdef123456', Names: 'web', Image: 'nginx', State: 'running', Status: 'Up 1 minute' })}\n`,
        stderr: '',
      })
      .mockResolvedValueOnce({
        code: 0,
        stdout: `${JSON.stringify({ Name: 'web', CPUPerc: '1.5%', MemPerc: '10%', MemUsage: '10MiB / 100MiB', BlockIO: '1kB / 2kB', NetIO: '3kB / 4kB' })}\n`,
        stderr: '',
      });

    const result = await service.listContainers('sub-1', 'item-1', { userId: 'user-1' });

    expect(result.containers).toHaveLength(1);
    expect(result.containers[0].name).toBe('web');
    expect(result.containers[0].stats?.cpuPercent).toBe(1.5);
    expect(summariesRepository.findByItemId).not.toHaveBeenCalled();
  });

  it('rejects when Container Manager addon is not active', async () => {
    subscriptionAddonsRepository.findActiveBySubscriptionId.mockResolvedValue([]);

    await expect(service.listContainers('sub-1', 'item-1', { userId: 'user-1' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects ownership mismatch for customers', async () => {
    await expect(service.listContainers('sub-1', 'item-1', { userId: 'other' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects canceled subscriptions', async () => {
    subscriptionsRepository.findByIdOrThrow.mockResolvedValue({
      id: 'sub-1',
      userId: 'user-1',
      planId: 'plan-1',
      status: 'canceled',
    });

    await expect(service.listContainers('sub-1', 'item-1', { userId: 'user-1' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('allows pending withdrawal when the item is still provisioned', async () => {
    subscriptionsRepository.findByIdOrThrow.mockResolvedValue({
      id: 'sub-1',
      userId: 'user-1',
      planId: 'plan-1',
      status: 'pending_withdrawal',
    });
    sshExecutor.exec
      .mockResolvedValueOnce({
        code: 0,
        stdout: `${JSON.stringify({ ID: 'abcdef123456', Names: 'web', Image: 'nginx', State: 'running', Status: 'Up 1 minute' })}\n`,
        stderr: '',
      })
      .mockResolvedValueOnce({
        code: 0,
        stdout: `${JSON.stringify({ Name: 'web', CPUPerc: '1.5%', MemPerc: '10%', MemUsage: '10MiB / 100MiB', BlockIO: '1kB / 2kB', NetIO: '3kB / 4kB' })}\n`,
        stderr: '',
      });

    const result = await service.listContainers('sub-1', 'item-1', { userId: 'user-1' });

    expect(result.containers).toHaveLength(1);
    expect(result.containers[0].name).toBe('web');
  });

  it('rejects non-active provisioning items', async () => {
    subscriptionItemsRepository.findByIdAndSubscriptionId.mockResolvedValue({
      id: 'item-1',
      sshPrivateKey: 'KEY',
      providerReference: 'srv-1',
      provisioningStatus: 'pending',
      serverInfoSnapshot: { publicIp: '1.2.3.4' },
    });

    await expect(service.listContainers('sub-1', 'item-1', { userId: 'user-1' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects invalid public IP values', async () => {
    subscriptionItemsRepository.findByIdAndSubscriptionId.mockResolvedValue({
      id: 'item-1',
      sshPrivateKey: 'KEY',
      providerReference: 'srv-1',
      provisioningStatus: 'active',
      serverInfoSnapshot: { publicIp: 'evil.example;rm -rf /' },
    });

    await expect(service.listContainers('sub-1', 'item-1', { userId: 'user-1' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects invalid container ids for stats history', async () => {
    await expect(
      service.getStatsHistory('sub-1', 'item-1', 'web;rm -rf /', { userId: 'user-1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(sshExecutor.exec).not.toHaveBeenCalled();
  });

  it('reads stats history from postgres without listing containers', async () => {
    const points = [
      {
        timestamp: '2026-08-17T12:00:00.000Z',
        cpuPercent: 1,
        memoryPercent: 2,
        memoryUsageBytes: 3,
        memoryLimitBytes: 4,
        blockReadBytes: 5,
        blockWriteBytes: 6,
        networkRxBytes: 7,
        networkTxBytes: 8,
      },
    ];
    samplesRepository.findLatestPoints.mockResolvedValue(points);

    const result = await service.getStatsHistory('sub-1', 'item-1', 'abcdef123456', { userId: 'user-1' });

    expect(result).toEqual({ containerId: 'abcdef123456', points });
    expect(samplesRepository.findLatestPoints).toHaveBeenCalledWith('item-1', 'abcdef123456', 60);
    expect(sshExecutor.exec).not.toHaveBeenCalled();
    expect(sshExecutor.waitUntilReachable).not.toHaveBeenCalled();
  });

  it('collects container logs via docker logs', async () => {
    sshExecutor.exec.mockResolvedValueOnce({
      code: 0,
      stdout: '2026-08-15T10:00:00.000000000Z hello\n2026-08-15T10:00:01.000000000Z world\n',
      stderr: '',
    });

    const result = await service.getLogs('sub-1', 'item-1', 'abcdef123456', { userId: 'user-1', tail: 50 });

    expect(result.containerId).toBe('abcdef123456');
    expect(result.tail).toBe(50);
    expect(result.lines).toEqual(['2026-08-15T10:00:00.000000000Z hello', '2026-08-15T10:00:01.000000000Z world']);
    expect(result.truncated).toBe(false);
    expect(sshExecutor.exec).toHaveBeenCalledWith(
      '1.2.3.4',
      22,
      'root',
      'KEY',
      'docker logs --timestamps --tail 50 abcdef123456 2>&1',
      expect.any(Object),
    );
  });

  it('merges host interfaces into network topology when ip JSON is available', async () => {
    sshExecutor.exec
      .mockResolvedValueOnce({
        code: 0,
        stdout: `${JSON.stringify({ ID: 'net1', Name: 'bridge', Driver: 'bridge', Scope: 'local' })}\n`,
        stderr: '',
      })
      .mockResolvedValueOnce({
        code: 0,
        stdout: JSON.stringify([
          {
            Id: 'net1',
            Name: 'bridge',
            Driver: 'bridge',
            Scope: 'local',
            Containers: { c1: { Name: 'web' } },
            IPAM: { Config: [{ Subnet: '172.18.0.0/16', Gateway: '172.18.0.1' }] },
          },
        ]),
        stderr: '',
      })
      .mockResolvedValueOnce({
        code: 0,
        stdout: JSON.stringify([
          {
            ifname: 'br-abc',
            operstate: 'UP',
            addr_info: [{ family: 'inet', local: '172.18.0.1', prefixlen: 16 }],
          },
          {
            ifname: 'eth0',
            operstate: 'UP',
            addr_info: [{ family: 'inet', local: '203.0.113.10', prefixlen: 24 }],
          },
        ]),
        stderr: '',
      })
      .mockResolvedValueOnce({
        code: 0,
        stdout: JSON.stringify([{ dst: 'default', gateway: '203.0.113.1', dev: 'eth0' }]),
        stderr: '',
      });

    const result = await service.listNetworks('sub-1', 'item-1', { userId: 'user-1' });

    expect(result.hostInterfaces).toHaveLength(2);
    expect(result.hostRoutes).toEqual([{ destination: 'default', gateway: '203.0.113.1', device: 'eth0' }]);
    expect(result.topology.nodes.some((node) => node.kind === 'host_iface')).toBe(true);
    expect(result.topology.nodes.some((node) => node.kind === 'internet')).toBe(true);
    expect(
      result.topology.edges.some((edge) => edge.from === 'exit:172.18.0.1' && edge.to === 'host_iface:br-abc'),
    ).toBe(true);
    expect(
      result.topology.edges.some(
        (edge) => edge.from === 'host_iface:br-abc' && edge.to === 'host_iface:eth0' && edge.label === 'nat',
      ),
    ).toBe(true);
  });

  it('keeps Docker-only topology when host ip commands fail', async () => {
    sshExecutor.exec
      .mockResolvedValueOnce({
        code: 0,
        stdout: `${JSON.stringify({ ID: 'net1', Name: 'bridge', Driver: 'bridge', Scope: 'local' })}\n`,
        stderr: '',
      })
      .mockResolvedValueOnce({
        code: 0,
        stdout: JSON.stringify([
          {
            Id: 'net1',
            Name: 'bridge',
            Driver: 'bridge',
            Scope: 'local',
            Containers: {},
            IPAM: { Config: [{ Subnet: '172.18.0.0/16', Gateway: '172.18.0.1' }] },
          },
        ]),
        stderr: '',
      })
      .mockResolvedValueOnce({ code: 1, stdout: '', stderr: 'ip: not found' })
      .mockResolvedValueOnce({ code: 1, stdout: '', stderr: 'ip: not found' })
      .mockResolvedValueOnce({ code: 1, stdout: '', stderr: 'ip: not found' });

    const result = await service.listNetworks('sub-1', 'item-1', { userId: 'user-1' });

    expect(result.hostInterfaces).toEqual([]);
    expect(result.hostRoutes).toEqual([]);
    expect(result.topology.nodes.every((node) => ['container', 'network', 'exit', 'route'].includes(node.kind))).toBe(
      true,
    );
  });

  it('rejects invalid container ids for logs', async () => {
    await expect(service.getLogs('sub-1', 'item-1', '../etc/passwd', { userId: 'user-1' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('maps collection failures to BadRequest and publishes notification', async () => {
    sshExecutor.exec.mockRejectedValue(new Error('boom'));
    servicePlansRepository.findByIdOrThrow.mockResolvedValue({ id: 'plan-1', name: 'Plan' });

    await expect(service.listContainers('sub-1', 'item-1', { userId: 'user-1' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(billingNotificationPublisher.publish).toHaveBeenCalledWith(
      'addon.collection_failed',
      expect.objectContaining({ subscriptionId: 'sub-1', itemId: 'item-1' }),
      'user-1',
    );
  });
});
