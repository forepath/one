import { Test, TestingModule } from '@nestjs/testing';
import axios from 'axios';
import { RedisCacheService } from '@forepath/shared/backend/util-redis-cache';

import { ProviderLocationsService } from './provider-locations.service';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('ProviderLocationsService', () => {
  let service: ProviderLocationsService;
  const originalHetznerToken = process.env.HETZNER_API_TOKEN;
  const originalDoToken = process.env.DIGITALOCEAN_API_TOKEN;
  const redisCache = {
    getJson: jest.fn().mockResolvedValue(null),
    setJson: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    process.env.HETZNER_API_TOKEN = 'hetzner-token';
    process.env.DIGITALOCEAN_API_TOKEN = 'do-token';
    redisCache.getJson.mockReset().mockResolvedValue(null);
    redisCache.setJson.mockReset().mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [ProviderLocationsService, { provide: RedisCacheService, useValue: redisCache }],
    }).compile();

    service = module.get(ProviderLocationsService);
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env.HETZNER_API_TOKEN = originalHetznerToken;
    process.env.DIGITALOCEAN_API_TOKEN = originalDoToken;
  });

  it('should map Hetzner API locations and merge static fallbacks', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        locations: [{ id: 1, name: 'fsn1', city: 'Falkenstein', country: 'DE', latitude: 0, longitude: 0 }],
      },
    });

    const locations = await service.getLocations('hetzner');

    expect(locations.find((item) => item.id === 'fsn1')?.name).toBe('Falkenstein');
    expect(locations.find((item) => item.id === 'nbg1')?.name).toBe('Nuremberg');
    expect(redisCache.setJson).toHaveBeenCalled();
  });

  it('should return cached Hetzner locations without calling the provider API', async () => {
    const cached = [{ id: 'fsn1', name: 'Cached Falkenstein' }];
    redisCache.getJson.mockResolvedValueOnce(cached);

    const locations = await service.getLocations('hetzner');

    expect(locations).toEqual(cached);
    expect(mockedAxios.get).not.toHaveBeenCalled();
    expect(redisCache.setJson).not.toHaveBeenCalled();
  });

  it('should return static Hetzner catalog when API fails', async () => {
    mockedAxios.get.mockRejectedValueOnce(new Error('network error'));

    const locations = await service.getLocations('hetzner');

    expect(locations.find((item) => item.id === 'fsn1')?.name).toBe('Falkenstein');
    expect(redisCache.setJson).toHaveBeenCalled();
  });

  it('should map DigitalOcean API regions and merge static fallbacks', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        regions: [{ slug: 'fra1', name: 'Frankfurt 1', available: true }],
      },
    });

    const locations = await service.getLocations('digital-ocean');

    expect(locations.find((item) => item.id === 'fra1')?.name).toBe('Frankfurt 1');
    expect(locations.find((item) => item.id === 'nyc3')?.name).toBe('New York 3');
    expect(redisCache.setJson).toHaveBeenCalled();
  });

  it('should return static DigitalOcean catalog when API fails', async () => {
    mockedAxios.get.mockRejectedValueOnce(new Error('network error'));

    const locations = await service.getLocations('digital-ocean');

    expect(locations.find((item) => item.id === 'fra1')?.name).toBe('Frankfurt 1');
    expect(redisCache.setJson).toHaveBeenCalled();
  });
});
