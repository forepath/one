import { Test, TestingModule } from '@nestjs/testing';

import { ProviderCatalogDispatchService } from './provider-catalog-dispatch.service';
import { ProviderLocationsService } from './provider-locations.service';

describe('ProviderLocationsService', () => {
  let service: ProviderLocationsService;
  const catalogDispatch = {
    getLocations: jest.fn(),
  };

  beforeEach(async () => {
    catalogDispatch.getLocations.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [ProviderLocationsService, { provide: ProviderCatalogDispatchService, useValue: catalogDispatch }],
    }).compile();

    service = module.get(ProviderLocationsService);
  });

  it('delegates to catalog dispatch for known providers', async () => {
    const locations = [{ id: 'fsn1', name: 'Falkenstein' }];

    catalogDispatch.getLocations.mockResolvedValue(locations);

    await expect(service.getLocations('hetzner', { HETZNER_API_TOKEN: 'token' })).resolves.toEqual(locations);
    expect(catalogDispatch.getLocations).toHaveBeenCalledWith('hetzner', { HETZNER_API_TOKEN: 'token' });
  });

  it('returns empty list when catalog dispatch has no module hooks', async () => {
    catalogDispatch.getLocations.mockResolvedValue([]);

    await expect(service.getLocations('unknown')).resolves.toEqual([]);
  });
});
