import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ProvisioningReferenceEntity } from '../entities/provisioning-reference.entity';

import { ProvisioningReferencesRepository } from './provisioning-references.repository';

describe('ProvisioningReferencesRepository', () => {
  let repository: ProvisioningReferencesRepository;
  const mockProvisioningReference: ProvisioningReferenceEntity = {
    id: 'ref-uuid',
    clientId: 'client-uuid',
    providerType: 'hetzner',
    serverId: '123456',
    serverName: 'test-server',
    publicIp: '1.2.3.4',
    privateIp: '10.0.0.1',
    providerMetadata: '{"location":"fsn1"}',
    createdAt: new Date(),
    updatedAt: new Date(),
    client: {} as any,
  };
  const mockTypeOrmRepository = {
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProvisioningReferencesRepository,
        {
          provide: getRepositoryToken(ProvisioningReferenceEntity),
          useValue: mockTypeOrmRepository,
        },
      ],
    }).compile();

    repository = module.get<ProvisioningReferencesRepository>(ProvisioningReferencesRepository);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findByIdOrThrow', () => {
    it('should return provisioning reference when found', async () => {
      mockTypeOrmRepository.findOne.mockResolvedValue(mockProvisioningReference);

      const result = await repository.findByIdOrThrow('ref-uuid');

      expect(result).toEqual(mockProvisioningReference);
      expect(mockTypeOrmRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'ref-uuid' },
      });
    });

    it('should throw NotFoundException when provisioning reference not found', async () => {
      mockTypeOrmRepository.findOne.mockResolvedValue(null);

      await expect(repository.findByIdOrThrow('non-existent')).rejects.toThrow(NotFoundException);
      await expect(repository.findByIdOrThrow('non-existent')).rejects.toThrow(
        "Provisioning reference with id 'non-existent' not found",
      );
    });
  });

  describe('findById', () => {
    it('should return provisioning reference when found', async () => {
      mockTypeOrmRepository.findOne.mockResolvedValue(mockProvisioningReference);

      const result = await repository.findById('ref-uuid');

      expect(result).toEqual(mockProvisioningReference);
      expect(mockTypeOrmRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'ref-uuid' },
      });
    });

    it('should return null when provisioning reference not found', async () => {
      mockTypeOrmRepository.findOne.mockResolvedValue(null);

      const result = await repository.findById('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('findByClientId', () => {
    it('should return provisioning reference when found', async () => {
      mockTypeOrmRepository.findOne.mockResolvedValue(mockProvisioningReference);

      const result = await repository.findByClientId('client-uuid');

      expect(result).toEqual(mockProvisioningReference);
      expect(mockTypeOrmRepository.findOne).toHaveBeenCalledWith({
        where: { clientId: 'client-uuid' },
      });
    });

    it('should return null when provisioning reference not found', async () => {
      mockTypeOrmRepository.findOne.mockResolvedValue(null);

      const result = await repository.findByClientId('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('findByProviderServerId', () => {
    it('should return provisioning reference when found', async () => {
      mockTypeOrmRepository.findOne.mockResolvedValue(mockProvisioningReference);

      const result = await repository.findByProviderServerId('hetzner', '123456');

      expect(result).toEqual(mockProvisioningReference);
      expect(mockTypeOrmRepository.findOne).toHaveBeenCalledWith({
        where: { providerType: 'hetzner', serverId: '123456' },
      });
    });

    it('should return null when provisioning reference not found', async () => {
      mockTypeOrmRepository.findOne.mockResolvedValue(null);

      const result = await repository.findByProviderServerId('hetzner', 'non-existent');

      expect(result).toBeNull();
    });
  });

  describe('findAll', () => {
    it('should return array of provisioning references with pagination', async () => {
      const references = [mockProvisioningReference];

      mockTypeOrmRepository.find.mockResolvedValue(references);

      const result = await repository.findAll(10, 0);

      expect(result).toEqual(references);
      expect(mockTypeOrmRepository.find).toHaveBeenCalledWith({
        take: 10,
        skip: 0,
        order: { createdAt: 'DESC' },
      });
    });

    it('should use default pagination values', async () => {
      const references = [mockProvisioningReference];

      mockTypeOrmRepository.find.mockResolvedValue(references);

      await repository.findAll();

      expect(mockTypeOrmRepository.find).toHaveBeenCalledWith({
        take: 10,
        skip: 0,
        order: { createdAt: 'DESC' },
      });
    });

    it('should handle custom pagination values', async () => {
      const references = [mockProvisioningReference];

      mockTypeOrmRepository.find.mockResolvedValue(references);

      await repository.findAll(20, 5);

      expect(mockTypeOrmRepository.find).toHaveBeenCalledWith({
        take: 20,
        skip: 5,
        order: { createdAt: 'DESC' },
      });
    });
  });

  describe('findByProviderType', () => {
    it('should return array of provisioning references for provider type with pagination', async () => {
      const references = [mockProvisioningReference];

      mockTypeOrmRepository.find.mockResolvedValue(references);

      const result = await repository.findByProviderType('hetzner', 10, 0);

      expect(result).toEqual(references);
      expect(mockTypeOrmRepository.find).toHaveBeenCalledWith({
        where: { providerType: 'hetzner' },
        take: 10,
        skip: 0,
        order: { createdAt: 'DESC' },
      });
    });

    it('should use default pagination values', async () => {
      const references = [mockProvisioningReference];

      mockTypeOrmRepository.find.mockResolvedValue(references);

      await repository.findByProviderType('hetzner');

      expect(mockTypeOrmRepository.find).toHaveBeenCalledWith({
        where: { providerType: 'hetzner' },
        take: 10,
        skip: 0,
        order: { createdAt: 'DESC' },
      });
    });

    it('should handle different provider types', async () => {
      const references = [mockProvisioningReference];

      mockTypeOrmRepository.find.mockResolvedValue(references);

      await repository.findByProviderType('aws', 5, 10);

      expect(mockTypeOrmRepository.find).toHaveBeenCalledWith({
        where: { providerType: 'aws' },
        take: 5,
        skip: 10,
        order: { createdAt: 'DESC' },
      });
    });
  });

  describe('create', () => {
    it('should create and save new provisioning reference', async () => {
      const createData = {
        clientId: 'client-uuid',
        providerType: 'hetzner',
        serverId: '123456',
        serverName: 'new-server',
        publicIp: '5.6.7.8',
        privateIp: '10.0.0.2',
        providerMetadata: '{"location":"nbg1"}',
      };
      const createdReference = { ...mockProvisioningReference, ...createData };

      mockTypeOrmRepository.create.mockReturnValue(createdReference);
      mockTypeOrmRepository.save.mockResolvedValue(createdReference);

      const result = await repository.create(createData);

      expect(result).toEqual(createdReference);
      expect(mockTypeOrmRepository.create).toHaveBeenCalledWith(createData);
      expect(mockTypeOrmRepository.save).toHaveBeenCalledWith(createdReference);
    });

    it('should create provisioning reference with minimal data', async () => {
      const createData = {
        clientId: 'client-uuid',
        providerType: 'hetzner',
        serverId: '123456',
      };
      const createdReference = { ...mockProvisioningReference, ...createData };

      mockTypeOrmRepository.create.mockReturnValue(createdReference);
      mockTypeOrmRepository.save.mockResolvedValue(createdReference);

      const result = await repository.create(createData);

      expect(result).toEqual(createdReference);
      expect(mockTypeOrmRepository.create).toHaveBeenCalledWith(createData);
      expect(mockTypeOrmRepository.save).toHaveBeenCalledWith(createdReference);
    });
  });

  describe('update', () => {
    it('should update existing provisioning reference', async () => {
      const updateData = {
        serverName: 'updated-server',
        publicIp: '9.10.11.12',
      };
      const updatedReference = { ...mockProvisioningReference, ...updateData };

      // First call: findByIdOrThrow check, second call: return updated entity
      mockTypeOrmRepository.findOne
        .mockResolvedValueOnce(mockProvisioningReference)
        .mockResolvedValueOnce(updatedReference);
      mockTypeOrmRepository.update.mockResolvedValue({ affected: 1 });

      const result = await repository.update('ref-uuid', updateData);

      expect(result).toEqual(updatedReference);
      expect(mockTypeOrmRepository.findOne).toHaveBeenCalledTimes(2);
      expect(mockTypeOrmRepository.update).toHaveBeenCalledWith('ref-uuid', updateData);
    });

    it('should throw NotFoundException when provisioning reference not found', async () => {
      mockTypeOrmRepository.findOne.mockResolvedValue(null);

      await expect(repository.update('non-existent', { serverName: 'updated' })).rejects.toThrow(NotFoundException);
      expect(mockTypeOrmRepository.update).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('should delete provisioning reference by ID', async () => {
      mockTypeOrmRepository.findOne.mockResolvedValue(mockProvisioningReference);
      mockTypeOrmRepository.delete.mockResolvedValue({ affected: 1 });

      await repository.delete('ref-uuid');

      expect(mockTypeOrmRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'ref-uuid' },
      });
      expect(mockTypeOrmRepository.delete).toHaveBeenCalledWith('ref-uuid');
    });

    it('should throw NotFoundException when provisioning reference not found', async () => {
      mockTypeOrmRepository.findOne.mockResolvedValue(null);

      await expect(repository.delete('non-existent')).rejects.toThrow(NotFoundException);
      expect(mockTypeOrmRepository.delete).not.toHaveBeenCalled();
    });
  });

  describe('deleteByClientId', () => {
    it('should delete provisioning reference by client ID', async () => {
      mockTypeOrmRepository.delete.mockResolvedValue({ affected: 1 });

      await repository.deleteByClientId('client-uuid');

      expect(mockTypeOrmRepository.delete).toHaveBeenCalledWith({ clientId: 'client-uuid' });
    });

    it('should handle deletion when no reference exists', async () => {
      mockTypeOrmRepository.delete.mockResolvedValue({ affected: 0 });

      await repository.deleteByClientId('non-existent');

      expect(mockTypeOrmRepository.delete).toHaveBeenCalledWith({ clientId: 'non-existent' });
    });
  });
});
