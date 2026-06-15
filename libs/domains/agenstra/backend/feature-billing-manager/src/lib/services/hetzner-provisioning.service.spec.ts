import { BadRequestException } from '@nestjs/common';
import axios from 'axios';

import { HetznerProvisioningService } from './hetzner-provisioning.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('HetznerProvisioningService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetAllMocks();
    process.env = { ...originalEnv, HETZNER_API_TOKEN: 'test-token' };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('provisions a server', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: { server: { id: 12345 } },
    });

    const service = new HetznerProvisioningService();
    const result = await service.provisionServer({
      name: 'test-server',
      serverType: 'cx11',
      location: 'fsn1',
      userData: '#!/bin/bash\necho hello',
    });

    expect(result).toEqual({ serverId: '12345' });
    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://api.hetzner.cloud/v1/servers',
      expect.objectContaining({
        name: 'test-server',
        server_type: 'cx11',
        location: 'fsn1',
      }),
      expect.objectContaining({
        headers: { Authorization: 'Bearer test-token' },
      }),
    );
  });

  it('provisions server with firewall', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { server: { id: 12345 } } }).mockResolvedValueOnce({});

    const service = new HetznerProvisioningService();
    const result = await service.provisionServer({
      name: 'test-server',
      serverType: 'cx11',
      location: 'fsn1',
      firewallId: 42,
      userData: '#!/bin/bash\necho hello',
    });

    expect(result).toEqual({ serverId: '12345' });
    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
    expect(mockedAxios.post).toHaveBeenNthCalledWith(
      2,
      'https://api.hetzner.cloud/v1/firewalls/42/actions/attach_to_server',
      { server: 12345 },
      expect.objectContaining({
        headers: { Authorization: 'Bearer test-token' },
      }),
    );
  });

  it('throws when no server id returned', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: {} });

    const service = new HetznerProvisioningService();

    await expect(
      service.provisionServer({
        name: 'test-server',
        serverType: 'cx11',
        location: 'fsn1',
        userData: '',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws when API token not set', async () => {
    delete process.env.HETZNER_API_TOKEN;

    const service = new HetznerProvisioningService();

    await expect(
      service.provisionServer({
        name: 'test-server',
        serverType: 'cx11',
        location: 'fsn1',
        userData: '',
      }),
    ).rejects.toThrow('HETZNER_API_TOKEN environment variable is not set');
  });

  it('deprovisions a server', async () => {
    mockedAxios.delete.mockResolvedValueOnce({});

    const service = new HetznerProvisioningService();

    await service.deprovisionServer('12345');

    expect(mockedAxios.delete).toHaveBeenCalledWith('https://api.hetzner.cloud/v1/servers/12345', {
      headers: { Authorization: 'Bearer test-token' },
    });
  });

  it('skips deprovisioning when API token not set', async () => {
    delete process.env.HETZNER_API_TOKEN;

    const service = new HetznerProvisioningService();

    await service.deprovisionServer('12345');

    expect(mockedAxios.delete).not.toHaveBeenCalled();
  });

  it('throws on deprovision error', async () => {
    mockedAxios.delete.mockRejectedValueOnce({ message: 'Not found' });

    const service = new HetznerProvisioningService();

    await expect(service.deprovisionServer('12345')).rejects.toThrow(BadRequestException);
  });

  describe('getServerInfo', () => {
    it('returns server info when API returns valid server', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          server: {
            id: 12345,
            name: 'subscription-abc-123',
            status: 'running',
            public_net: { ipv4: { ip: '1.2.3.4' } },
            private_net: [{ ip: '10.0.0.1', network: 1 }],
            datacenter: {
              name: 'fsn1-dc14',
              location: { name: 'fsn1' },
            },
          },
        },
      });

      const service = new HetznerProvisioningService();
      const result = await service.getServerInfo('12345');

      expect(result).toEqual({
        serverId: '12345',
        name: 'subscription-abc-123',
        publicIp: '1.2.3.4',
        privateIp: '10.0.0.1',
        status: 'running',
        metadata: { location: 'fsn1', datacenter: 'fsn1-dc14' },
      });
      expect(mockedAxios.get).toHaveBeenCalledWith('https://api.hetzner.cloud/v1/servers/12345', {
        headers: { Authorization: 'Bearer test-token' },
      });
    });

    it('returns server info with empty publicIp when not yet assigned', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          server: {
            id: 999,
            name: 'starting-server',
            status: 'starting',
            public_net: {},
            private_net: [],
            datacenter: { name: 'nbg1-dc3', location: { name: 'nbg1' } },
          },
        },
      });

      const service = new HetznerProvisioningService();
      const result = await service.getServerInfo('999');

      expect(result.publicIp).toBe('');
      expect(result.privateIp).toBeUndefined();
      expect(result.status).toBe('starting');
      expect(result.metadata).toEqual({ location: 'nbg1', datacenter: 'nbg1-dc3' });
    });

    it('throws when API token not set', async () => {
      delete process.env.HETZNER_API_TOKEN;

      const service = new HetznerProvisioningService();

      await expect(service.getServerInfo('12345')).rejects.toThrow('HETZNER_API_TOKEN environment variable is not set');
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });

    it('throws when server not found (404)', async () => {
      const notFoundError = Object.assign(new Error('Request failed with status code 404'), {
        response: { status: 404 },
      });

      mockedAxios.get.mockRejectedValue(notFoundError);

      const service = new HetznerProvisioningService();

      await expect(service.getServerInfo('99999')).rejects.toThrow(BadRequestException);
      await expect(service.getServerInfo('99999')).rejects.toThrow('Server 99999 not found');
    });

    it('throws when API response has no server object', async () => {
      mockedAxios.get.mockResolvedValue({ data: {} });

      const service = new HetznerProvisioningService();

      await expect(service.getServerInfo('12345')).rejects.toThrow(BadRequestException);
      await expect(service.getServerInfo('12345')).rejects.toThrow('Invalid response from Hetzner API');
    });

    it('throws on generic API error', async () => {
      mockedAxios.get.mockRejectedValue({ message: 'Network error' });

      const service = new HetznerProvisioningService();

      await expect(service.getServerInfo('12345')).rejects.toThrow(BadRequestException);
      await expect(service.getServerInfo('12345')).rejects.toThrow('Failed to get server info');
    });
  });

  describe('startServer', () => {
    it('calls Hetzner poweron action', async () => {
      mockedAxios.post.mockResolvedValueOnce({ data: { action: { id: 1 } } });

      const service = new HetznerProvisioningService();

      await service.startServer('12345');

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://api.hetzner.cloud/v1/servers/12345/actions/poweron',
        {},
        { headers: { Authorization: 'Bearer test-token' } },
      );
    });

    it('throws when API token not set', async () => {
      delete process.env.HETZNER_API_TOKEN;
      const service = new HetznerProvisioningService();

      await expect(service.startServer('12345')).rejects.toThrow(BadRequestException);
      await expect(service.startServer('12345')).rejects.toThrow('HETZNER_API_TOKEN');
    });

    it('throws on API error', async () => {
      mockedAxios.post.mockRejectedValue({ message: 'Conflict' });
      const service = new HetznerProvisioningService();

      await expect(service.startServer('12345')).rejects.toThrow(BadRequestException);
      await expect(service.startServer('12345')).rejects.toThrow('Failed to start server');
    });
  });

  describe('stopServer', () => {
    it('calls Hetzner poweroff action', async () => {
      mockedAxios.post.mockResolvedValueOnce({ data: { action: { id: 1 } } });

      const service = new HetznerProvisioningService();

      await service.stopServer('12345');

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://api.hetzner.cloud/v1/servers/12345/actions/poweroff',
        {},
        { headers: { Authorization: 'Bearer test-token' } },
      );
    });

    it('throws when API token not set', async () => {
      delete process.env.HETZNER_API_TOKEN;
      const service = new HetznerProvisioningService();

      await expect(service.stopServer('12345')).rejects.toThrow(BadRequestException);
    });

    it('throws on API error', async () => {
      mockedAxios.post.mockRejectedValue({ message: 'Server not found' });
      const service = new HetznerProvisioningService();

      await expect(service.stopServer('12345')).rejects.toThrow(BadRequestException);
      await expect(service.stopServer('12345')).rejects.toThrow('Failed to stop server');
    });
  });

  describe('restartServer', () => {
    it('calls Hetzner reboot action', async () => {
      mockedAxios.post.mockResolvedValueOnce({ data: { action: { id: 1 } } });

      const service = new HetznerProvisioningService();

      await service.restartServer('12345');

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://api.hetzner.cloud/v1/servers/12345/actions/reboot',
        {},
        { headers: { Authorization: 'Bearer test-token' } },
      );
    });

    it('throws when API token not set', async () => {
      delete process.env.HETZNER_API_TOKEN;
      const service = new HetznerProvisioningService();

      await expect(service.restartServer('12345')).rejects.toThrow(BadRequestException);
    });

    it('throws on API error', async () => {
      mockedAxios.post.mockRejectedValue({ message: 'Timeout' });
      const service = new HetznerProvisioningService();

      await expect(service.restartServer('12345')).rejects.toThrow(BadRequestException);
      await expect(service.restartServer('12345')).rejects.toThrow('Failed to restart server');
    });
  });
});
