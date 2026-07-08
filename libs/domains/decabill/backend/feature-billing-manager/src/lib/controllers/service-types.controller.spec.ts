import { Test } from '@nestjs/testing';

import { ServiceTypeEntity } from '../entities/service-type.entity';
import { ServiceTypesRepository } from '../repositories/service-types.repository';
import { ProviderRegistryService } from '../services/provider-registry.service';
import { ProviderServerTypesService } from '../services/provider-server-types.service';

import { ServiceTypesController } from './service-types.controller';

describe('ServiceTypesController', () => {
  const mockProviderServerTypes = {
    getServerTypes: jest.fn().mockResolvedValue([]),
  };

  const mockServiceTypeRow: ServiceTypeEntity = {
    id: '11111111-1111-4111-8111-111111111111',
    key: 'hetzner-default',
    tenantId: 'default',
    name: 'Hetzner',
    provider: 'hetzner',
    configSchema: {},
    isActive: true,
    disallowStatutoryWithdrawal: false,
    providerDefaults: { HETZNER_API_TOKEN: 'stored-secret' },
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
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
      expect(serverTypesService.getServerTypes).toHaveBeenCalledWith('hetzner', undefined);
    });

    it('should resolve credentials from service type when serviceTypeId query is set', async () => {
      const serverTypesService = {
        getServerTypes: jest.fn().mockResolvedValue([]),
      };
      const serviceTypesRepository = {
        findByIdOrThrow: jest.fn().mockResolvedValue(mockServiceTypeRow),
      };
      const moduleRef = await Test.createTestingModule({
        controllers: [ServiceTypesController],
        providers: [
          { provide: ServiceTypesRepository, useValue: serviceTypesRepository },
          { provide: ProviderRegistryService, useValue: { getProviders: jest.fn() } },
          { provide: ProviderServerTypesService, useValue: serverTypesService },
        ],
      }).compile();
      const controller = moduleRef.get(ServiceTypesController);

      await controller.getProviderServerTypes('hetzner', mockServiceTypeRow.id);

      expect(serverTypesService.getServerTypes).toHaveBeenCalledWith('hetzner', {
        HETZNER_API_TOKEN: 'stored-secret',
      });
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

  describe('create and update', () => {
    it('should persist sanitized providerDefaults on create and mask secrets in response', async () => {
      const createdRow = {
        ...mockServiceTypeRow,
        providerDefaults: { HETZNER_API_TOKEN: 'new-secret' },
      };
      const serviceTypesRepository = {
        create: jest.fn().mockResolvedValue(createdRow),
      };
      const moduleRef = await Test.createTestingModule({
        controllers: [ServiceTypesController],
        providers: [
          { provide: ServiceTypesRepository, useValue: serviceTypesRepository },
          { provide: ProviderRegistryService, useValue: { getProviders: jest.fn() } },
          { provide: ProviderServerTypesService, useValue: mockProviderServerTypes },
        ],
      }).compile();
      const controller = moduleRef.get(ServiceTypesController);
      const response = await controller.create({
        key: 'hetzner-default',
        name: 'Hetzner',
        provider: 'hetzner',
        providerDefaults: { HETZNER_API_TOKEN: '  new-secret  ' },
      });

      expect(serviceTypesRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          providerDefaults: { HETZNER_API_TOKEN: 'new-secret' },
        }),
      );
      expect(response.providerDefaultsConfigured).toEqual({ HETZNER_API_TOKEN: true });
      expect(response).not.toHaveProperty('providerDefaults');
    });

    it('should replace providerDefaults on update without returning secret values', async () => {
      const updatedRow = {
        ...mockServiceTypeRow,
        providerDefaults: {},
      };
      const serviceTypesRepository = {
        findByIdOrThrow: jest.fn().mockResolvedValue(mockServiceTypeRow),
        update: jest.fn().mockResolvedValue(updatedRow),
      };
      const moduleRef = await Test.createTestingModule({
        controllers: [ServiceTypesController],
        providers: [
          { provide: ServiceTypesRepository, useValue: serviceTypesRepository },
          { provide: ProviderRegistryService, useValue: { getProviders: jest.fn() } },
          { provide: ProviderServerTypesService, useValue: mockProviderServerTypes },
        ],
      }).compile();
      const controller = moduleRef.get(ServiceTypesController);
      const response = await controller.update(mockServiceTypeRow.id, {
        providerDefaults: { HETZNER_API_TOKEN: '' },
      });

      expect(serviceTypesRepository.update).toHaveBeenCalledWith(
        mockServiceTypeRow.id,
        expect.objectContaining({ providerDefaults: {} }),
      );
      expect(response.providerDefaultsConfigured).toEqual({ HETZNER_API_TOKEN: false });
      expect(response).not.toHaveProperty('providerDefaults');
    });
  });
});
