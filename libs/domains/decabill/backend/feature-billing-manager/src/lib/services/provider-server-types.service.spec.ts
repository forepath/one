import { Test } from '@nestjs/testing';

import { ProviderCatalogDispatchService } from './provider-catalog-dispatch.service';
import { ProviderServerTypesService } from './provider-server-types.service';

describe('ProviderServerTypesService', () => {
  let service: ProviderServerTypesService;
  const catalogDispatch = {
    getServerTypes: jest.fn(),
  };

  beforeEach(async () => {
    catalogDispatch.getServerTypes.mockReset();

    const moduleRef = await Test.createTestingModule({
      providers: [ProviderServerTypesService, { provide: ProviderCatalogDispatchService, useValue: catalogDispatch }],
    }).compile();

    service = moduleRef.get(ProviderServerTypesService);
  });

  it('delegates to catalog dispatch', async () => {
    const serverTypes = [{ id: 'cx11', name: 'CX11', cores: 1, memory: 2, disk: 20 }];

    catalogDispatch.getServerTypes.mockResolvedValue(serverTypes);

    await expect(service.getServerTypes('hetzner')).resolves.toEqual(serverTypes);
    expect(catalogDispatch.getServerTypes).toHaveBeenCalledWith('hetzner', undefined);
  });

  it('returns empty array for unknown provider', async () => {
    catalogDispatch.getServerTypes.mockResolvedValue([]);

    await expect(service.getServerTypes('unknown')).resolves.toEqual([]);
  });
});
