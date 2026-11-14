import { BadRequestException } from '@nestjs/common';
import axios from 'axios';

import { waitForTcpPort } from '../../utils/wait-for-tcp-port.util';

import { DigitaloceanProvisioningService } from './digitalocean-provisioning.service';

jest.mock('axios');
jest.mock('../../utils/wait-for-tcp-port.util', () => ({
  waitForTcpPort: jest.fn().mockResolvedValue(undefined),
  isTcpPortOpen: jest.fn(),
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedWaitForTcpPort = waitForTcpPort as jest.MockedFunction<typeof waitForTcpPort>;

describe('DigitaloceanProvisioningService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetAllMocks();
    process.env = { ...originalEnv, DIGITALOCEAN_API_TOKEN: 'test-token' };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('provisions a droplet', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: { droplet: { id: 98765 } },
    });

    const service = new DigitaloceanProvisioningService();
    const result = await service.provisionServer({
      name: 'test-server',
      serverType: 's-1vcpu-1gb',
      location: 'fra1',
      userData: '#!/bin/bash\necho hello',
    });

    expect(result).toEqual({ serverId: '98765' });
    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://api.digitalocean.com/v2/droplets',
      expect.objectContaining({
        name: 'test-server',
        region: 'fra1',
        size: 's-1vcpu-1gb',
        user_data: '#!/bin/bash\necho hello',
      }),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
        }),
      }),
    );
  });

  it('registers the public key as a temporary account key, passes it on create and deletes it afterwards', async () => {
    mockedAxios.post
      .mockResolvedValueOnce({ data: { ssh_key: { id: 555 } } })
      .mockResolvedValueOnce({ data: { droplet: { id: 98766 } } });
    mockedAxios.delete.mockResolvedValueOnce({});

    const service = new DigitaloceanProvisioningService();
    const result = await service.provisionServer({
      name: 'test-server',
      serverType: 's-1vcpu-1gb',
      location: 'fra1',
      userData: '#!/bin/bash\necho hello',
      sshPublicKey: 'ssh-ed25519 AAAATEST',
    });

    expect(result).toEqual({ serverId: '98766' });
    expect(mockedAxios.post).toHaveBeenNthCalledWith(
      1,
      'https://api.digitalocean.com/v2/account/keys',
      expect.objectContaining({
        name: expect.stringMatching(/^decabill-test-server-/),
        public_key: 'ssh-ed25519 AAAATEST',
      }),
      expect.anything(),
    );
    expect(mockedAxios.post).toHaveBeenNthCalledWith(
      2,
      'https://api.digitalocean.com/v2/droplets',
      expect.objectContaining({ ssh_keys: [555] }),
      expect.anything(),
    );
    expect(mockedAxios.delete).toHaveBeenCalledWith(
      'https://api.digitalocean.com/v2/account/keys/555',
      expect.anything(),
    );
  });

  it('deletes the temporary account key even when droplet creation fails', async () => {
    mockedAxios.post
      .mockResolvedValueOnce({ data: { ssh_key: { id: 556 } } })
      .mockRejectedValueOnce(Object.assign(new Error('boom'), { isAxiosError: true }));
    mockedAxios.delete.mockResolvedValueOnce({});

    const service = new DigitaloceanProvisioningService();

    await expect(
      service.provisionServer({
        name: 'test-server',
        serverType: 's-1vcpu-1gb',
        location: 'fra1',
        userData: '#!/bin/bash\necho hello',
        sshPublicKey: 'ssh-ed25519 AAAATEST',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(mockedAxios.delete).toHaveBeenCalledWith(
      'https://api.digitalocean.com/v2/account/keys/556',
      expect.anything(),
    );
  });

  it('decodes base64 user_data before sending (billing cloud-init matches Hetzner encoding)', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: { droplet: { id: 111 } },
    });

    const plainScript = '#!/bin/bash\necho billing-controller';
    const userDataBase64 = Buffer.from(plainScript, 'utf8').toString('base64');
    const service = new DigitaloceanProvisioningService();

    await service.provisionServer({
      name: 'do-billing',
      serverType: 's-1vcpu-1gb',
      location: 'fra1',
      userData: userDataBase64,
    });

    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://api.digitalocean.com/v2/droplets',
      expect.objectContaining({
        user_data: plainScript,
      }),
      expect.any(Object),
    );
  });

  it('throws when user_data exceeds DigitalOcean 64KiB limit after decode', async () => {
    const service = new DigitaloceanProvisioningService();
    const huge = '#!/bin/bash\n' + 'x'.repeat(70 * 1024);

    await expect(
      service.provisionServer({
        name: 'test-server',
        serverType: 's-1vcpu-1gb',
        location: 'fra1',
        userData: huge,
      }),
    ).rejects.toThrow(BadRequestException);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('throws when no server id returned', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: {} });

    const service = new DigitaloceanProvisioningService();

    await expect(
      service.provisionServer({
        name: 'test-server',
        serverType: 's-1vcpu-1gb',
        location: 'fra1',
        userData: '',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws when API token not set', async () => {
    delete process.env.DIGITALOCEAN_API_TOKEN;

    const service = new DigitaloceanProvisioningService();

    await expect(
      service.provisionServer({
        name: 'test-server',
        serverType: 's-1vcpu-1gb',
        location: 'fra1',
        userData: '',
      }),
    ).rejects.toThrow('DIGITALOCEAN_API_TOKEN environment variable is not set');
  });

  it('deprovisions a droplet', async () => {
    mockedAxios.delete.mockResolvedValueOnce({});

    const service = new DigitaloceanProvisioningService();

    await service.deprovisionServer('98765');

    expect(mockedAxios.delete).toHaveBeenCalledWith('https://api.digitalocean.com/v2/droplets/98765', {
      headers: { Authorization: 'Bearer test-token' },
    });
  });

  it('skips deprovisioning when API token not set', async () => {
    delete process.env.DIGITALOCEAN_API_TOKEN;

    const service = new DigitaloceanProvisioningService();

    await service.deprovisionServer('98765');

    expect(mockedAxios.delete).not.toHaveBeenCalled();
  });

  describe('getServerInfo', () => {
    it('returns server info when API returns valid droplet', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          droplet: {
            id: 98765,
            name: 'subscription-xyz',
            status: 'active',
            region: { slug: 'fra1', name: 'Frankfurt' },
            networks: {
              v4: [
                { ip_address: '1.2.3.4', type: 'public' },
                { ip_address: '10.10.0.5', type: 'private' },
              ],
            },
          },
        },
      });

      const service = new DigitaloceanProvisioningService();
      const result = await service.getServerInfo('98765');

      expect(result).toEqual({
        serverId: '98765',
        name: 'subscription-xyz',
        publicIp: '1.2.3.4',
        privateIp: '10.10.0.5',
        status: 'active',
        metadata: { region: 'fra1', regionName: 'Frankfurt' },
      });
    });

    it('throws when API token not set', async () => {
      delete process.env.DIGITALOCEAN_API_TOKEN;

      const service = new DigitaloceanProvisioningService();

      await expect(service.getServerInfo('98765')).rejects.toThrow(
        'DIGITALOCEAN_API_TOKEN environment variable is not set',
      );
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });
  });

  describe('power actions', () => {
    it('calls power_on for startServer', async () => {
      mockedAxios.post.mockResolvedValueOnce({ data: { action: { id: 1 } } });
      const service = new DigitaloceanProvisioningService();

      await service.startServer('98765');
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://api.digitalocean.com/v2/droplets/98765/actions',
        { type: 'power_on' },
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
        }),
      );
    });

    it('calls power_off for stopServer', async () => {
      mockedAxios.post.mockResolvedValueOnce({ data: { action: { id: 1 } } });
      const service = new DigitaloceanProvisioningService();

      await service.stopServer('98765');
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://api.digitalocean.com/v2/droplets/98765/actions',
        { type: 'power_off' },
        expect.any(Object),
      );
    });

    it('calls reboot for restartServer', async () => {
      mockedAxios.post.mockResolvedValueOnce({ data: { action: { id: 1 } } });
      const service = new DigitaloceanProvisioningService();

      await service.restartServer('98765');
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://api.digitalocean.com/v2/droplets/98765/actions',
        { type: 'reboot' },
        expect.any(Object),
      );
    });
  });

  describe('changeServerType', () => {
    const dropletPayload = (status: string, locked = false) => ({
      data: {
        droplet: {
          id: 98765,
          name: 'test-droplet',
          status,
          locked,
          networks: {
            v4: [{ ip_address: '5.6.7.8', type: 'public' }],
          },
          region: { slug: 'fra1', name: 'Frankfurt' },
        },
      },
    });

    beforeEach(() => {
      jest.useFakeTimers({ advanceTimers: true });
      mockedWaitForTcpPort.mockResolvedValue(undefined);
    });

    afterEach(() => {
      jest.useRealTimers();
      jest.restoreAllMocks();
    });

    function mockDoApi(options: {
      initialStatus?: string;
      afterShutdownStatus?: string;
      afterPowerOffStatus?: string;
      afterResizeStatus?: string;
      afterPowerOnStatus?: string;
    }) {
      let dropletStatus = options.initialStatus ?? 'active';
      const actionStatus = new Map<number, string>();

      mockedAxios.get.mockImplementation(async (url: string) => {
        if (url.includes('/actions/')) {
          const id = Number(url.split('/').pop());

          return { data: { action: { id, status: actionStatus.get(id) ?? 'completed' } } };
        }

        return dropletPayload(dropletStatus);
      });

      mockedAxios.post.mockImplementation(async (_url: string, body: { type?: string }) => {
        const id = mockedAxios.post.mock.calls.length;

        actionStatus.set(id, 'completed');

        if (body?.type === 'shutdown') {
          dropletStatus = options.afterShutdownStatus ?? dropletStatus;
        }

        if (body?.type === 'power_off') {
          dropletStatus = options.afterPowerOffStatus ?? 'off';
        }

        if (body?.type === 'resize') {
          dropletStatus = options.afterResizeStatus ?? 'off';
        }

        if (body?.type === 'power_on') {
          dropletStatus = options.afterPowerOnStatus ?? 'active';
        }

        return { data: { action: { id, status: 'in-progress', type: body?.type } } };
      });
    }

    it('powers off an active droplet, resizes, and waits for active', async () => {
      mockDoApi({
        afterShutdownStatus: 'active',
        afterPowerOffStatus: 'off',
        afterResizeStatus: 'off',
        afterPowerOnStatus: 'active',
      });

      const service = new DigitaloceanProvisioningService();
      const promise = service.changeServerType('98765', 's-2vcpu-2gb', { resizeDisk: true });

      await jest.runAllTimersAsync();
      await promise;

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://api.digitalocean.com/v2/droplets/98765/actions',
        { type: 'shutdown' },
        expect.any(Object),
      );
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://api.digitalocean.com/v2/droplets/98765/actions',
        { type: 'power_off' },
        expect.any(Object),
      );
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://api.digitalocean.com/v2/droplets/98765/actions',
        { type: 'resize', size: 's-2vcpu-2gb', disk: true },
        expect.any(Object),
      );
      expect(mockedWaitForTcpPort).toHaveBeenCalledWith('5.6.7.8', 22, { timeoutMs: 90 * 1000 });
    });

    it('guest SSH force poweroff skips API shutdown when droplet goes off', async () => {
      const sshExecutor = {
        waitUntilReachable: jest.fn().mockResolvedValue(undefined),
        exec: jest.fn().mockRejectedValue(new Error('read ECONNRESET')),
      };
      let dropletStatus = 'active';
      const actionStatus = new Map<number, string>();

      mockedAxios.get.mockImplementation(async (url: string) => {
        if (url.includes('/actions/')) {
          const id = Number(url.split('/').pop());

          return { data: { action: { id, status: actionStatus.get(id) ?? 'completed' } } };
        }

        return dropletPayload(dropletStatus);
      });
      mockedAxios.post.mockImplementation(async (_url: string, body: { type?: string }) => {
        const id = mockedAxios.post.mock.calls.length;

        actionStatus.set(id, 'completed');

        if (body?.type === 'resize') {
          dropletStatus = 'active';
        }

        return { data: { action: { id, status: 'in-progress', type: body?.type } } };
      });
      sshExecutor.exec.mockImplementation(async () => {
        dropletStatus = 'off';
        throw new Error('read ECONNRESET');
      });

      const service = new DigitaloceanProvisioningService(sshExecutor as never);
      const promise = service.changeServerType('98765', 's-2vcpu-2gb', { sshPrivateKey: 'key' });

      await jest.runAllTimersAsync();
      await promise;

      expect(sshExecutor.waitUntilReachable).toHaveBeenCalled();
      expect(sshExecutor.exec).toHaveBeenCalled();
      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://api.digitalocean.com/v2/droplets/98765/actions',
        { type: 'resize', size: 's-2vcpu-2gb', disk: false },
        expect.any(Object),
      );
    });

    it('powers on after resize when droplet remains off', async () => {
      mockDoApi({
        afterShutdownStatus: 'off',
        afterResizeStatus: 'off',
        afterPowerOnStatus: 'active',
      });

      const service = new DigitaloceanProvisioningService();
      const promise = service.changeServerType('98765', 's-2vcpu-2gb');

      await jest.runAllTimersAsync();
      await promise;

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://api.digitalocean.com/v2/droplets/98765/actions',
        { type: 'power_on' },
        expect.any(Object),
      );
      expect(mockedAxios.post).not.toHaveBeenCalledWith(
        'https://api.digitalocean.com/v2/droplets/98765/actions',
        { type: 'power_off' },
        expect.any(Object),
      );
      expect(mockedWaitForTcpPort).toHaveBeenCalledWith('5.6.7.8', 22, { timeoutMs: 90 * 1000 });
    });

    it('skips power_off when droplet is already off', async () => {
      mockDoApi({
        initialStatus: 'off',
        afterResizeStatus: 'active',
      });

      const service = new DigitaloceanProvisioningService();
      const promise = service.changeServerType('98765', 's-2vcpu-2gb');

      await jest.runAllTimersAsync();
      await promise;

      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://api.digitalocean.com/v2/droplets/98765/actions',
        { type: 'resize', size: 's-2vcpu-2gb', disk: false },
        expect.any(Object),
      );
      expect(mockedWaitForTcpPort).toHaveBeenCalledWith('5.6.7.8', 22, { timeoutMs: 90 * 1000 });
    });

    it('waits for active before shutdown when droplet is still new', async () => {
      let dropletStatus = 'new';
      const actionStatus = new Map<number, string>();

      mockedAxios.get.mockImplementation(async (url: string) => {
        if (url.includes('/actions/')) {
          const id = Number(url.split('/').pop());

          return { data: { action: { id, status: actionStatus.get(id) ?? 'completed' } } };
        }

        return dropletPayload(dropletStatus);
      });
      mockedAxios.post.mockImplementation(async (_url: string, body: { type?: string }) => {
        const id = mockedAxios.post.mock.calls.length;

        actionStatus.set(id, 'completed');

        if (body?.type === 'shutdown' || body?.type === 'power_off') {
          dropletStatus = 'off';
        }

        if (body?.type === 'resize') {
          dropletStatus = 'active';
        }

        return { data: { action: { id, status: 'in-progress', type: body?.type } } };
      });

      // After the initial "new" read, become active on subsequent polls.
      const originalGet = mockedAxios.get.getMockImplementation()!;

      mockedAxios.get.mockImplementation(async (url: string) => {
        const result = await originalGet(url);

        if (!url.includes('/actions/') && dropletStatus === 'new') {
          dropletStatus = 'active';
        }

        return result;
      });

      const service = new DigitaloceanProvisioningService();
      const promise = service.changeServerType('98765', 's-2vcpu-2gb');

      await jest.runAllTimersAsync();
      await promise;

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://api.digitalocean.com/v2/droplets/98765/actions',
        { type: 'shutdown' },
        expect.any(Object),
      );
    });

    it('throws when resize action errors before power_on', async () => {
      mockedAxios.get
        .mockResolvedValueOnce(dropletPayload('off'))
        .mockResolvedValueOnce({ data: { action: { id: 9, status: 'errored', type: 'resize' } } });
      mockedAxios.post.mockResolvedValueOnce({ data: { action: { id: 9, status: 'in-progress' } } });

      const service = new DigitaloceanProvisioningService();
      const promise = service.changeServerType('98765', 's-2vcpu-2gb');

      await expect(promise).rejects.toThrow(/action 9 failed/);
      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    });

    it('throws when API token not set', async () => {
      delete process.env.DIGITALOCEAN_API_TOKEN;
      const service = new DigitaloceanProvisioningService();

      await expect(service.changeServerType('98765', 's-2vcpu-2gb')).rejects.toThrow(BadRequestException);
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });

    it('skips SSH wait after resize when droplet has no public IP', async () => {
      let dropletStatus = 'off';

      mockedAxios.get.mockImplementation(async (url: string) => {
        if (url.includes('/actions/')) {
          return { data: { action: { id: Number(url.split('/').pop()), status: 'completed' } } };
        }

        return {
          data: {
            droplet: {
              id: 98765,
              name: 'test-droplet',
              status: dropletStatus,
              networks: { v4: [] },
              region: { slug: 'fra1', name: 'Frankfurt' },
            },
          },
        };
      });
      mockedAxios.post.mockImplementation(async (_url: string, body?: { type?: string }) => {
        if (body?.type === 'power_on') {
          dropletStatus = 'active';
        }

        return { data: { action: { id: body?.type === 'resize' ? 9 : 2, status: 'in-progress' } } };
      });

      const service = new DigitaloceanProvisioningService();
      const promise = service.changeServerType('98765', 's-2vcpu-2gb');

      await jest.runAllTimersAsync();
      await promise;

      expect(mockedWaitForTcpPort).not.toHaveBeenCalled();
    });

    it('continues when SSH wait after resize times out', async () => {
      mockDoApi({ initialStatus: 'off', afterResizeStatus: 'active' });
      mockedWaitForTcpPort.mockRejectedValueOnce(new Error('Timed out waiting'));

      const service = new DigitaloceanProvisioningService();
      const promise = service.changeServerType('98765', 's-2vcpu-2gb');

      await jest.runAllTimersAsync();
      await expect(promise).resolves.toBeUndefined();
    });

    it('throws when resize does not return an action id', async () => {
      mockedAxios.get.mockResolvedValue(dropletPayload('off'));
      mockedAxios.post.mockResolvedValue({ data: { action: {} } });

      const service = new DigitaloceanProvisioningService();

      await expect(service.changeServerType('98765', 's-2vcpu-2gb')).rejects.toThrow(
        'DigitalOcean resize did not return an action id',
      );
    });

    it('formats DigitalOcean API errors when resize fails unexpectedly', async () => {
      mockedAxios.get.mockResolvedValue(dropletPayload('off'));
      const axiosError = Object.assign(new Error('Request failed'), {
        isAxiosError: true,
        response: { status: 422, data: { id: 'unprocessable', message: 'size unavailable' } },
        message: 'Request failed',
      });

      mockedAxios.post.mockRejectedValue(axiosError);

      const service = new DigitaloceanProvisioningService();

      await expect(service.changeServerType('98765', 's-2vcpu-2gb')).rejects.toThrow('unprocessable: size unavailable');
    });

    it('skips guest SSH poweroff when droplet has no public IP', async () => {
      let dropletStatus = 'active';

      mockedAxios.get.mockImplementation(async (url: string) => {
        if (url.includes('/actions/')) {
          return { data: { action: { id: Number(url.split('/').pop()), status: 'completed' } } };
        }

        return {
          data: {
            droplet: {
              id: 98765,
              name: 'test-droplet',
              status: dropletStatus,
              networks: { v4: [] },
              region: { slug: 'fra1', name: 'Frankfurt' },
            },
          },
        };
      });
      mockedAxios.post.mockImplementation(async (_url: string, body?: { type?: string }) => {
        if (body?.type === 'shutdown' || body?.type === 'power_off') {
          dropletStatus = 'off';
        }

        if (body?.type === 'power_on' || body?.type === 'resize') {
          if (body?.type === 'power_on') {
            dropletStatus = 'active';
          }

          return { data: { action: { id: body?.type === 'resize' ? 9 : 2, status: 'in-progress' } } };
        }

        return { data: { action: { id: 1, status: 'in-progress' } } };
      });

      const sshExecutor = {
        waitUntilReachable: jest.fn(),
        exec: jest.fn(),
      };
      const service = new DigitaloceanProvisioningService(sshExecutor as never);
      const promise = service.changeServerType('98765', 's-2vcpu-2gb', { sshPrivateKey: 'key' });

      await jest.runAllTimersAsync();
      await promise;

      expect(sshExecutor.waitUntilReachable).not.toHaveBeenCalled();
    });
  });

  describe('error paths', () => {
    it('throws when deprovision fails', async () => {
      mockedAxios.delete.mockRejectedValueOnce({
        message: 'delete failed',
        response: { status: 500 },
      });

      const service = new DigitaloceanProvisioningService();

      await expect(service.deprovisionServer('98765')).rejects.toThrow('Failed to deprovision server: delete failed');
    });

    it('throws not found when getServerInfo returns 404', async () => {
      mockedAxios.get.mockRejectedValueOnce({
        message: 'Not Found',
        response: { status: 404 },
      });

      const service = new DigitaloceanProvisioningService();

      await expect(service.getServerInfo('98765')).rejects.toThrow('Server 98765 not found');
    });

    it('throws when getServerInfo returns an invalid payload', async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: {} });

      const service = new DigitaloceanProvisioningService();

      await expect(service.getServerInfo('98765')).rejects.toThrow('Invalid response from DigitalOcean API');
    });

    it('throws when power action fails', async () => {
      mockedAxios.post.mockRejectedValueOnce({ message: 'power failed' });

      const service = new DigitaloceanProvisioningService();

      await expect(service.startServer('98765')).rejects.toThrow('Failed to start server: power failed');
    });

    it('throws when power action token is missing', async () => {
      delete process.env.DIGITALOCEAN_API_TOKEN;
      const service = new DigitaloceanProvisioningService();

      await expect(service.stopServer('98765')).rejects.toThrow(
        'DIGITALOCEAN_API_TOKEN environment variable is not set',
      );
    });

    it('formats message-only DigitalOcean API errors on resize failure', async () => {
      mockedAxios.get.mockResolvedValue({
        data: {
          droplet: {
            id: 98765,
            name: 'test-droplet',
            status: 'off',
            networks: { v4: [{ ip_address: '5.6.7.8', type: 'public' }] },
            region: { slug: 'fra1', name: 'Frankfurt' },
          },
        },
      });
      mockedAxios.post.mockRejectedValue({
        message: 'Request failed',
        response: { status: 400, data: { message: 'size is not available' } },
      });

      const service = new DigitaloceanProvisioningService();

      await expect(service.changeServerType('98765', 's-2vcpu-2gb')).rejects.toThrow('size is not available');
    });

    it('throws generic getServerInfo failures', async () => {
      mockedAxios.get.mockRejectedValueOnce({
        message: 'network down',
        response: { status: 503 },
      });

      const service = new DigitaloceanProvisioningService();

      await expect(service.getServerInfo('98765')).rejects.toThrow('Failed to get server info: network down');
    });
  });
});
