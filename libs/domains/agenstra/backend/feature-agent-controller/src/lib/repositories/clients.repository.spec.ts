import { AuthenticationType, ClientEntity } from '@forepath/identity/backend';
import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ClientsRepository } from './clients.repository';

describe('ClientsRepository', () => {
  let repository: ClientsRepository;
  const mockClient: ClientEntity = {
    id: 'test-uuid',
    name: 'Test Client',
    description: 'Test Description',
    endpoint: 'https://example.com/api',
    authenticationType: AuthenticationType.API_KEY,
    apiKey: 'test-api-key-123',
    keycloakClientId: undefined,
    keycloakClientSecret: undefined,
    keycloakRealm: undefined,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const mockTypeOrmRepository = {
    findOne: jest.fn(),
    find: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    remove: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientsRepository,
        {
          provide: getRepositoryToken(ClientEntity),
          useValue: mockTypeOrmRepository,
        },
      ],
    }).compile();

    repository = module.get<ClientsRepository>(ClientsRepository);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findByIdOrThrow', () => {
    it('should return client when found', async () => {
      mockTypeOrmRepository.findOne.mockResolvedValue(mockClient);

      const result = await repository.findByIdOrThrow('test-uuid');

      expect(result).toEqual(mockClient);
      expect(mockTypeOrmRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'test-uuid' },
      });
    });

    it('should throw NotFoundException when client not found', async () => {
      mockTypeOrmRepository.findOne.mockResolvedValue(null);

      await expect(repository.findByIdOrThrow('non-existent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findById', () => {
    it('should return client when found', async () => {
      mockTypeOrmRepository.findOne.mockResolvedValue(mockClient);

      const result = await repository.findById('test-uuid');

      expect(result).toEqual(mockClient);
    });

    it('should return null when client not found', async () => {
      mockTypeOrmRepository.findOne.mockResolvedValue(null);

      const result = await repository.findById('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('findByName', () => {
    it('should return client when found', async () => {
      mockTypeOrmRepository.findOne.mockResolvedValue(mockClient);

      const result = await repository.findByName('Test Client');

      expect(result).toEqual(mockClient);
      expect(mockTypeOrmRepository.findOne).toHaveBeenCalledWith({
        where: { name: 'Test Client' },
      });
    });
  });

  describe('findAll', () => {
    it('should return array of clients with pagination', async () => {
      const clients = [mockClient];

      mockTypeOrmRepository.find.mockResolvedValue(clients);

      const result = await repository.findAll(10, 0);

      expect(result).toEqual(clients);
      expect(mockTypeOrmRepository.find).toHaveBeenCalledWith({
        take: 10,
        skip: 0,
        order: { createdAt: 'DESC' },
      });
    });

    it('should use default pagination values', async () => {
      const clients = [mockClient];

      mockTypeOrmRepository.find.mockResolvedValue(clients);

      await repository.findAll();

      expect(mockTypeOrmRepository.find).toHaveBeenCalledWith({
        take: 10,
        skip: 0,
        order: { createdAt: 'DESC' },
      });
    });
  });

  describe('count', () => {
    it('should return total count', async () => {
      mockTypeOrmRepository.count.mockResolvedValue(5);

      const result = await repository.count();

      expect(result).toBe(5);
    });
  });

  describe('findAllIds', () => {
    it('should return array of client IDs', async () => {
      mockTypeOrmRepository.find.mockResolvedValue([{ id: 'id-1' }, { id: 'id-2' }]);

      const result = await repository.findAllIds();

      expect(result).toEqual(['id-1', 'id-2']);
      expect(mockTypeOrmRepository.find).toHaveBeenCalledWith({ select: ['id'] });
    });

    it('should return empty array when no clients', async () => {
      mockTypeOrmRepository.find.mockResolvedValue([]);

      const result = await repository.findAllIds();

      expect(result).toEqual([]);
    });
  });

  describe('findIdsByCreatorId', () => {
    it('should return client IDs where user is creator', async () => {
      mockTypeOrmRepository.find.mockResolvedValue([{ id: 'client-a' }, { id: 'client-b' }]);

      const result = await repository.findIdsByCreatorId('user-123');

      expect(result).toEqual(['client-a', 'client-b']);
      expect(mockTypeOrmRepository.find).toHaveBeenCalledWith({
        where: { userId: 'user-123' },
        select: ['id'],
      });
    });

    it('should return empty array when user has no clients', async () => {
      mockTypeOrmRepository.find.mockResolvedValue([]);

      const result = await repository.findIdsByCreatorId('user-orphan');

      expect(result).toEqual([]);
    });
  });

  describe('create', () => {
    it('should create and save new client with API_KEY type', async () => {
      const createData = {
        name: 'New Client',
        description: 'New Description',
        endpoint: 'https://example.com/api',
        authenticationType: AuthenticationType.API_KEY,
        apiKey: 'new-api-key',
      };
      const createdClient = { ...mockClient, ...createData };

      mockTypeOrmRepository.create.mockReturnValue(createdClient);
      mockTypeOrmRepository.save.mockResolvedValue(createdClient);

      const result = await repository.create(createData);

      expect(result).toEqual(createdClient);
      expect(mockTypeOrmRepository.create).toHaveBeenCalledWith(createData);
      expect(mockTypeOrmRepository.save).toHaveBeenCalledWith(createdClient);
    });

    it('should create and save new client with KEYCLOAK type', async () => {
      const createData = {
        name: 'New Keycloak Client',
        description: 'New Description',
        endpoint: 'https://example.com/api',
        authenticationType: AuthenticationType.KEYCLOAK,
        keycloakClientId: 'keycloak-client-id',
        keycloakClientSecret: 'keycloak-client-secret',
        keycloakRealm: 'test-realm',
      };
      const createdClient = {
        ...mockClient,
        ...createData,
        apiKey: undefined,
      };

      mockTypeOrmRepository.create.mockReturnValue(createdClient);
      mockTypeOrmRepository.save.mockResolvedValue(createdClient);

      const result = await repository.create(createData);

      expect(result).toEqual(createdClient);
      expect(mockTypeOrmRepository.create).toHaveBeenCalledWith(createData);
      expect(mockTypeOrmRepository.save).toHaveBeenCalledWith(createdClient);
    });
  });

  describe('update', () => {
    it('should update existing client', async () => {
      const updateData = { name: 'Updated Client' };
      const updatedClient = { ...mockClient, ...updateData };

      mockTypeOrmRepository.findOne.mockResolvedValue(mockClient);
      mockTypeOrmRepository.save.mockResolvedValue(updatedClient);

      const result = await repository.update('test-uuid', updateData);

      expect(result.name).toBe('Updated Client');
      expect(result.updatedAt).toBeInstanceOf(Date);
      expect(mockTypeOrmRepository.save).toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('should delete client', async () => {
      mockTypeOrmRepository.findOne.mockResolvedValue(mockClient);
      mockTypeOrmRepository.remove.mockResolvedValue(mockClient);

      await repository.delete('test-uuid');

      expect(mockTypeOrmRepository.remove).toHaveBeenCalledWith(mockClient);
    });
  });
});
