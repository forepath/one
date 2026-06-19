import { Test } from '@nestjs/testing';
import type { BillingProvisioningProvider } from '@forepath/decabill/backend/util-plugin-host';
import { BILLING_PROVISIONING_PROVIDER_REGISTRY } from '@forepath/decabill/backend/util-plugin-host';
import { ProviderRegistry } from '@forepath/shared/backend/util-extension-core';

import { ProviderServerTypesService } from './provider-server-types.service';

describe('ProviderServerTypesService', () => {
  let service: ProviderServerTypesService;
  let registry: ProviderRegistry<BillingProvisioningProvider>;

  beforeEach(async () => {
    registry = new ProviderRegistry<BillingProvisioningProvider>();
    const moduleRef = await Test.createTestingModule({
      providers: [
        ProviderServerTypesService,
        {
          provide: BILLING_PROVISIONING_PROVIDER_REGISTRY,
          useValue: registry,
        },
      ],
    }).compile();

    service = moduleRef.get(ProviderServerTypesService);
  });

  it('returns empty array for unknown provider', async () => {
    const result = await service.getServerTypes('unknown');

    expect(result).toEqual([]);
  });

  it('delegates to the provisioning provider registry', async () => {
    const serverTypes = [{ id: 'cax11', name: 'CAX11', cores: 2, memory: 4, disk: 40, priceMonthly: 4.51 }];
    const provider: BillingProvisioningProvider = {
      getType: () => 'hetzner',
      getDisplayName: () => 'Hetzner Cloud',
      provision: jest.fn(),
      deprovision: jest.fn(),
      getServerInfo: jest.fn(),
      getServerTypes: jest.fn().mockResolvedValue(serverTypes),
      startServer: jest.fn(),
      stopServer: jest.fn(),
      restartServer: jest.fn(),
    };

    registry.register('hetzner', provider);

    const result = await service.getServerTypes('hetzner');

    expect(result).toEqual(serverTypes);
    expect(provider.getServerTypes).toHaveBeenCalled();
  });
});
