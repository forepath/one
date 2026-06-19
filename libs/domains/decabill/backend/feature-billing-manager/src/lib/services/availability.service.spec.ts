import axios from 'axios';

import { AvailabilityService } from './availability.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('AvailabilityService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetAllMocks();
    process.env = { ...originalEnv, HETZNER_API_TOKEN: 'test-token' };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('stores snapshot and returns response for non-hetzner provider', async () => {
    const repository = { create: jest.fn().mockResolvedValue({}) } as any;
    const service = new AvailabilityService(repository);
    const result = await service.checkAvailability('other', 'region', 'type');

    expect(result.isAvailable).toBe(true);
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'other',
        region: 'region',
        serverType: 'type',
        isAvailable: true,
      }),
    );
  });

  it('returns available when Hetzner server type exists and account has capacity', async () => {
    const repository = { create: jest.fn().mockResolvedValue({}) } as any;
    const service = new AvailabilityService(repository);

    mockedAxios.get
      // server_types
      .mockResolvedValueOnce({
        data: {
          server_types: [
            {
              id: 1,
              name: 'cx23',
              deprecated: false,
              prices: [{ location: 'fsn1' }],
            },
          ],
        },
      } as any)
      // limits
      .mockResolvedValueOnce({
        data: {
          limits: {
            max_servers: 10,
            server_count: 1,
          },
        },
      } as any);

    const result = await service.checkAvailability('hetzner', 'fsn1', 'cx23');

    expect(result.isAvailable).toBe(true);
    expect(result.reason).toBeUndefined();
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'hetzner',
        region: 'fsn1',
        serverType: 'cx23',
        isAvailable: true,
        rawResponse: expect.objectContaining({
          serverTypes: expect.any(Object),
          limits: expect.any(Object),
        }),
      }),
    );
  });

  it('returns not available when Hetzner account server limit is reached', async () => {
    const repository = { create: jest.fn().mockResolvedValue({}) } as any;
    const service = new AvailabilityService(repository);

    mockedAxios.get
      // server_types
      .mockResolvedValueOnce({
        data: {
          server_types: [
            {
              id: 1,
              name: 'cx23',
              deprecated: false,
              prices: [{ location: 'fsn1' }],
            },
          ],
        },
      } as any)
      // limits
      .mockResolvedValueOnce({
        data: {
          limits: {
            max_servers: 1,
            server_count: 1,
          },
        },
      } as any);

    const result = await service.checkAvailability('hetzner', 'fsn1', 'cx23');

    expect(result.isAvailable).toBe(false);
    expect(result.reason).toBe('Provider account limit reached');
    expect(result.alternatives).toEqual({
      availableTypes: ['cx23'],
    });
  });

  it('skips limits check when Hetzner /limits endpoint returns 404', async () => {
    const repository = { create: jest.fn().mockResolvedValue({}) } as any;
    const service = new AvailabilityService(repository);

    mockedAxios.get
      // server_types
      .mockResolvedValueOnce({
        data: {
          server_types: [
            {
              id: 1,
              name: 'cx23',
              deprecated: false,
              prices: [{ location: 'fsn1' }],
            },
          ],
        },
      } as any)
      // limits -> 404
      .mockRejectedValueOnce({
        response: { status: 404 },
      } as any);

    const result = await service.checkAvailability('hetzner', 'fsn1', 'cx23');

    expect(result.isAvailable).toBe(true);
    // rawResponse.limits should be null in this case
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        rawResponse: expect.objectContaining({
          limits: null,
        }),
      }),
    );
  });
});
