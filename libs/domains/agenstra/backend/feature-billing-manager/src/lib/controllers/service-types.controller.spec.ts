import { Test } from '@nestjs/testing';

import { ServiceTypesRepository } from '../repositories/service-types.repository';
import { ProviderRegistryService } from '../services/provider-registry.service';
import { ProviderServerTypesService } from '../services/provider-server-types.service';

import { ServiceTypesController } from './service-types.controller';

describe('ServiceTypesController', () => {
  const mockProviderServerTypes = {
    getServerTypes: jest.fn().mockResolvedValue([]),
  };

  describe('getProviderServerTypes', () => {
    it('should return server types for a provider', async () => {
      const serverTypes = [{ id: 'cax11', name: 'CAX11', cores: 2, memory: 4, disk: 40, priceMonthly: 4.51 }];
      const serverTypesService = {
        getServerTypes: jest.fn().mockResolvedValue(serverTypes),
      };
      const moduleRef = await Test.createTestingModule({
        controllers: [ServiceTypesController],
        providers: [
          { provide: ServiceTypesRepository, useValue: {} },
          { provide: ProviderRegistryService, useValue: { getProviders: jest.fn() } },
          { provide: ProviderServerTypesService, useValue: serverTypesService },
        ],
      }).compile();
      const controller = moduleRef.get(ServiceTypesController);
      const result = await controller.getProviderServerTypes('hetzner');

      expect(result).toEqual(serverTypes);
      expect(serverTypesService.getServerTypes).toHaveBeenCalledWith('hetzner');
    });
  });

  describe('getProviders', () => {
    it('should return provider details from registry', async () => {
      const providerDetails = [
        { id: 'hetzner', displayName: 'Hetzner Cloud', configSchema: { required: ['location'] } },
      ];
      const providerRegistry = {
        getProviders: jest.fn().mockReturnValue(providerDetails),
      };
      const moduleRef = await Test.createTestingModule({
        controllers: [ServiceTypesController],
        providers: [
          { provide: ServiceTypesRepository, useValue: {} },
          { provide: ProviderRegistryService, useValue: providerRegistry },
          { provide: ProviderServerTypesService, useValue: mockProviderServerTypes },
        ],
      }).compile();
      const controller = moduleRef.get(ServiceTypesController);
      const result = await controller.getProviders();

      expect(result).toEqual(providerDetails);
      expect(providerRegistry.getProviders).toHaveBeenCalled();
    });

    it('should return provider details with configSchema.properties.enum for select options', async () => {
      const providerDetails = [
        {
          id: 'hetzner',
          displayName: 'Hetzner Cloud',
          configSchema: {
            properties: {
              serverType: { type: 'string', enum: ['cax11', 'cpx11'] },
              location: { type: 'string', enum: ['fsn1', 'nbg1'] },
            },
          },
        },
      ];
      const providerRegistry = { getProviders: jest.fn().mockReturnValue(providerDetails) };
      const moduleRef = await Test.createTestingModule({
        controllers: [ServiceTypesController],
        providers: [
          { provide: ServiceTypesRepository, useValue: {} },
          { provide: ProviderRegistryService, useValue: providerRegistry },
          { provide: ProviderServerTypesService, useValue: mockProviderServerTypes },
        ],
      }).compile();
      const controller = moduleRef.get(ServiceTypesController);
      const result = await controller.getProviders();

      expect(result).toHaveLength(1);
      const schema = result[0].configSchema as { properties?: Record<string, { enum?: string[] }> };

      expect(schema.properties?.serverType?.enum).toEqual(['cax11', 'cpx11']);
      expect(schema.properties?.location?.enum).toEqual(['fsn1', 'nbg1']);
    });
  });
});
