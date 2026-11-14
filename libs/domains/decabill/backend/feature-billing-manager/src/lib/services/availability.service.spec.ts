import { AvailabilityService } from './availability.service';

describe('AvailabilityService', () => {
  it('stores snapshot and returns catalog dispatch result', async () => {
    const repository = { create: jest.fn().mockResolvedValue({}) } as any;
    const catalogDispatch = {
      checkAvailability: jest.fn().mockResolvedValue({
        isAvailable: true,
        rawResponse: { source: 'catalog' },
      }),
    } as any;
    const service = new AvailabilityService(repository, catalogDispatch);
    const result = await service.checkAvailability('hetzner', 'fsn1', 'cx23');

    expect(result.isAvailable).toBe(true);
    expect(catalogDispatch.checkAvailability).toHaveBeenCalledWith('hetzner', 'fsn1', 'cx23', undefined);
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'hetzner',
        region: 'fsn1',
        serverType: 'cx23',
        isAvailable: true,
        rawResponse: { source: 'catalog' },
      }),
    );
  });

  it('forwards providerDefaults to catalog dispatch', async () => {
    const repository = { create: jest.fn().mockResolvedValue({}) } as any;
    const catalogDispatch = {
      checkAvailability: jest.fn().mockResolvedValue({
        isAvailable: false,
        reason: 'Server type not found',
        alternatives: { availableTypes: ['cx23'] },
      }),
    } as any;
    const service = new AvailabilityService(repository, catalogDispatch);
    const result = await service.checkAvailability('hetzner', 'fsn1', 'missing', {
      HETZNER_API_TOKEN: 'tenant-token',
    });

    expect(result.isAvailable).toBe(false);
    expect(result.reason).toBe('Server type not found');
    expect(catalogDispatch.checkAvailability).toHaveBeenCalledWith('hetzner', 'fsn1', 'missing', {
      HETZNER_API_TOKEN: 'tenant-token',
    });
  });
});
