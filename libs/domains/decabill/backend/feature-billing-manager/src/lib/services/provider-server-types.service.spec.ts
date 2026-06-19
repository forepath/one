import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import axios from 'axios';

import { ProviderServerTypesService } from './provider-server-types.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('ProviderServerTypesService', () => {
  let service: ProviderServerTypesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [ProviderServerTypesService],
    }).compile();

    service = moduleRef.get(ProviderServerTypesService);
  });

  describe('getServerTypes', () => {
    it('should return empty array for unknown provider', async () => {
      const result = await service.getServerTypes('unknown');

      expect(result).toEqual([]);
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });

    it('should fetch and map Hetzner server types when token is set', async () => {
      const env = process.env.HETZNER_API_TOKEN;

      process.env.HETZNER_API_TOKEN = 'test-token';
      mockedAxios.get.mockResolvedValue({
        data: {
          server_types: [
            {
              id: 1,
              name: 'cax11',
              description: 'CAX11',
              cores: 2,
              memory: 4,
              disk: 40,
              deprecated: false,
              prices: [{ location: 'fsn1', price_monthly: { gross: 4.51 }, price_hourly: { gross: 0.006 } }],
            },
          ],
        },
      });

      const result = await service.getServerTypes('hetzner');

      expect(mockedAxios.get).toHaveBeenCalledWith(
        'https://api.hetzner.cloud/v1/server_types',
        expect.objectContaining({ headers: { Authorization: 'Bearer test-token' } }),
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'cax11',
        name: 'CAX11',
        cores: 2,
        memory: 4,
        disk: 40,
        priceMonthly: 4.51,
        priceHourly: 0.006,
      });
      process.env.HETZNER_API_TOKEN = env;
    });

    it('should filter out deprecated server types', async () => {
      process.env.HETZNER_API_TOKEN = 'test-token';
      mockedAxios.get.mockResolvedValue({
        data: {
          server_types: [
            { id: 1, name: 'old', description: 'Old', cores: 1, memory: 2, disk: 20, deprecated: true, prices: [] },
            {
              id: 2,
              name: 'cax11',
              description: 'CAX11',
              cores: 2,
              memory: 4,
              disk: 40,
              deprecated: false,
              prices: [],
            },
          ],
        },
      });

      const result = await service.getServerTypes('hetzner');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('cax11');
    });

    it('should throw when HETZNER_API_TOKEN is not set', async () => {
      const env = process.env.HETZNER_API_TOKEN;

      delete process.env.HETZNER_API_TOKEN;

      await expect(service.getServerTypes('hetzner')).rejects.toThrow(BadRequestException);
      await expect(service.getServerTypes('hetzner')).rejects.toThrow('HETZNER_API_TOKEN');

      process.env.HETZNER_API_TOKEN = env;
    });

    it('should fetch and map DigitalOcean sizes when token is set', async () => {
      const env = process.env.DIGITALOCEAN_API_TOKEN;

      process.env.DIGITALOCEAN_API_TOKEN = 'do-test-token';
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

      const result = await service.getServerTypes('digital-ocean');

      expect(mockedAxios.get).toHaveBeenCalledWith(
        'https://api.digitalocean.com/v2/sizes',
        expect.objectContaining({ headers: { Authorization: 'Bearer do-test-token' } }),
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
      process.env.DIGITALOCEAN_API_TOKEN = env;
    });

    it('should throw when DIGITALOCEAN_API_TOKEN is not set', async () => {
      const env = process.env.DIGITALOCEAN_API_TOKEN;

      delete process.env.DIGITALOCEAN_API_TOKEN;

      await expect(service.getServerTypes('digital-ocean')).rejects.toThrow(BadRequestException);
      await expect(service.getServerTypes('digital-ocean')).rejects.toThrow('DIGITALOCEAN_API_TOKEN');

      process.env.DIGITALOCEAN_API_TOKEN = env;
    });
  });
});
