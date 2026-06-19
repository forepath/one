import { BadRequestException } from '@nestjs/common';
import axios from 'axios';

import { DigitalOceanProvider } from './digital-ocean.provider';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('DigitalOceanProvider', () => {
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

    const service = new DigitalOceanProvider();
    const result = await service.provision({
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

  it('decodes base64 user_data before sending (billing cloud-init matches Hetzner encoding)', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: { droplet: { id: 111 } },
    });

    const plainScript = '#!/bin/bash\necho billing-controller';
    const userDataBase64 = Buffer.from(plainScript, 'utf8').toString('base64');
    const service = new DigitalOceanProvider();

    await service.provision({
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
    const service = new DigitalOceanProvider();
    const huge = '#!/bin/bash\n' + 'x'.repeat(70 * 1024);

    await expect(
      service.provision({
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

    const service = new DigitalOceanProvider();

    await expect(
      service.provision({
        name: 'test-server',
        serverType: 's-1vcpu-1gb',
        location: 'fra1',
        userData: '',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws when API token not set', async () => {
    delete process.env.DIGITALOCEAN_API_TOKEN;

    const service = new DigitalOceanProvider();

    await expect(
      service.provision({
        name: 'test-server',
        serverType: 's-1vcpu-1gb',
        location: 'fra1',
        userData: '',
      }),
    ).rejects.toThrow('DIGITALOCEAN_API_TOKEN environment variable is not set');
  });

  it('deprovisions a droplet', async () => {
    mockedAxios.delete.mockResolvedValueOnce({});

    const service = new DigitalOceanProvider();

    await service.deprovision('98765');

    expect(mockedAxios.delete).toHaveBeenCalledWith('https://api.digitalocean.com/v2/droplets/98765', {
      headers: { Authorization: 'Bearer test-token' },
    });
  });

  it('skips deprovisioning when API token not set', async () => {
    delete process.env.DIGITALOCEAN_API_TOKEN;

    const service = new DigitalOceanProvider();

    await service.deprovision('98765');

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

      const service = new DigitalOceanProvider();
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

      const service = new DigitalOceanProvider();

      await expect(service.getServerInfo('98765')).rejects.toThrow(
        'DIGITALOCEAN_API_TOKEN environment variable is not set',
      );
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });
  });

  describe('power actions', () => {
    it('calls power_on for startServer', async () => {
      mockedAxios.post.mockResolvedValueOnce({ data: { action: { id: 1 } } });
      const service = new DigitalOceanProvider();

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
      const service = new DigitalOceanProvider();

      await service.stopServer('98765');
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://api.digitalocean.com/v2/droplets/98765/actions',
        { type: 'power_off' },
        expect.any(Object),
      );
    });

    it('calls reboot for restartServer', async () => {
      mockedAxios.post.mockResolvedValueOnce({ data: { action: { id: 1 } } });
      const service = new DigitalOceanProvider();

      await service.restartServer('98765');
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://api.digitalocean.com/v2/droplets/98765/actions',
        { type: 'reboot' },
        expect.any(Object),
      );
    });
  });

  describe('getServerTypes', () => {
    it('fetches and maps DigitalOcean sizes when token is set', async () => {
      mockedAxios.get.mockResolvedValue({
        data: {
          sizes: [
            {
              slug: 's-1vcpu-1gb',
              memory: 1024,
              vcpus: 1,
              disk: 25,
              price_monthly: 6,
              price_hourly: 0.009,
              available: true,
              deprecated: false,
              description: 'Basic',
            },
          ],
        },
      });

      const service = new DigitalOceanProvider();
      const result = await service.getServerTypes();

      expect(mockedAxios.get).toHaveBeenCalledWith(
        'https://api.digitalocean.com/v2/sizes',
        expect.objectContaining({ headers: { Authorization: 'Bearer test-token' } }),
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 's-1vcpu-1gb',
        name: 'S-1VCPU-1GB',
        cores: 1,
        memory: 1,
        disk: 25,
        priceMonthly: 6,
        priceHourly: 0.009,
      });
    });

    it('throws when DIGITALOCEAN_API_TOKEN is not set', async () => {
      delete process.env.DIGITALOCEAN_API_TOKEN;
      const service = new DigitalOceanProvider();

      await expect(service.getServerTypes()).rejects.toThrow(BadRequestException);
      await expect(service.getServerTypes()).rejects.toThrow('DIGITALOCEAN_API_TOKEN');
    });
  });
});
