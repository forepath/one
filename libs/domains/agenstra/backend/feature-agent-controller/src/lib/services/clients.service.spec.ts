import { ConfigResponseDto } from '@forepath/agenstra/backend/feature-agent-manager';
import {
  AuthenticationType,
  ClientEntity,
  ClientUserRole,
  ClientUsersRepository,
  KeycloakTokenService,
  UserRole,
} from '@forepath/identity/backend';
import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { CreateClientDto } from '../dto/create-client.dto';
import { UpdateClientDto } from '../dto/update-client.dto';
import { ProvisioningReferenceEntity } from '../entities/provisioning-reference.entity';
import { ClientsRepository } from '../repositories/clients.repository';
import { ProvisioningReferencesRepository } from '../repositories/provisioning-references.repository';

import { ClientAgentProxyService } from './client-agent-proxy.service';
import { ClientsService } from './clients.service';
import { StatisticsService } from './statistics.service';

describe('ClientsService', () => {
  let service: ClientsService;
  let repository: jest.Mocked<ClientsRepository>;
  let keycloakTokenService: jest.Mocked<KeycloakTokenService>;
  let clientAgentProxyService: jest.Mocked<ClientAgentProxyService>;
  let provisioningReferencesRepository: jest.Mocked<ProvisioningReferencesRepository>;
  let clientUsersRepository: jest.Mocked<ClientUsersRepository>;
  const mockClient: ClientEntity = {
    id: 'test-uuid',
    name: 'Test Client',
    description: 'Test Description',
    endpoint: 'https://example.com/api',
    authenticationType: AuthenticationType.API_KEY,
    apiKey: 'test-api-key-123',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };
  const mockKeycloakClient: ClientEntity = {
    id: 'keycloak-client-uuid',
    name: 'Keycloak Client',
    description: 'Keycloak Client Description',
    endpoint: 'https://example.com/api',
    authenticationType: AuthenticationType.KEYCLOAK,
    keycloakClientId: 'keycloak-client-id',
    keycloakClientSecret: 'keycloak-client-secret',
    keycloakRealm: 'test-realm',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };
  const mockRepository = {
    findByIdOrThrow: jest.fn(),
    findById: jest.fn(),
    findByName: jest.fn(),
    findAll: jest.fn(),
    findAllIds: jest.fn(),
    findIdsByCreatorId: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  const mockKeycloakTokenService = {
    getAccessToken: jest.fn(),
    clearCache: jest.fn(),
    clearAllCache: jest.fn(),
  };
  const mockClientAgentProxyService = {
    getClientConfig: jest.fn(),
  };
  const mockProvisioningReferencesRepository = {
    findByClientId: jest.fn(),
  };
  const mockClientUsersRepository = {
    findUserClientAccess: jest.fn(),
    findByUserId: jest.fn(),
  };
  const mockStatisticsService = {
    recordEntityCreated: jest.fn().mockResolvedValue(undefined),
    recordEntityUpdated: jest.fn().mockResolvedValue(undefined),
    recordEntityDeleted: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientsService,
        {
          provide: ClientsRepository,
          useValue: mockRepository,
        },
        {
          provide: KeycloakTokenService,
          useValue: mockKeycloakTokenService,
        },
        {
          provide: ClientAgentProxyService,
          useValue: mockClientAgentProxyService,
        },
        {
          provide: ProvisioningReferencesRepository,
          useValue: mockProvisioningReferencesRepository,
        },
        {
          provide: ClientUsersRepository,
          useValue: mockClientUsersRepository,
        },
        {
          provide: StatisticsService,
          useValue: mockStatisticsService,
        },
      ],
    }).compile();

    service = module.get<ClientsService>(ClientsService);
    repository = module.get(ClientsRepository);
    keycloakTokenService = module.get(KeycloakTokenService);
    clientAgentProxyService = module.get(ClientAgentProxyService);
    provisioningReferencesRepository = module.get(ProvisioningReferencesRepository);
    clientUsersRepository = module.get(ClientUsersRepository);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create new client with auto-generated API key for API_KEY type', async () => {
      const createDto: CreateClientDto = {
        name: 'New Client',
        description: 'New Description',
        endpoint: 'https://example.com/api',
        authenticationType: AuthenticationType.API_KEY,
      };
      const createdClient: ClientEntity = {
        ...mockClient,
        name: createDto.name,
        description: createDto.description,
        endpoint: createDto.endpoint,
        authenticationType: createDto.authenticationType,
        apiKey: 'generated-api-key',
      };

      mockRepository.findByName.mockResolvedValue(null);
      repository.create.mockResolvedValue(createdClient);

      const result = await service.create(createDto);

      expect(result.id).toBe(mockClient.id);
      expect(result.name).toBe(createDto.name);
      expect(result.description).toBe(createDto.description);
      expect(result.endpoint).toBe(createDto.endpoint);
      expect(result.authenticationType).toBe(AuthenticationType.API_KEY);
      expect(result.apiKey).toBeDefined();
      expect(result.apiKey?.length).toBeGreaterThan(0);
      expect(typeof result.apiKey).toBe('string');
      expect(repository.findByName).toHaveBeenCalledWith(createDto.name);
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: createDto.name,
          description: createDto.description,
          endpoint: createDto.endpoint,
          authenticationType: createDto.authenticationType,
          apiKey: expect.any(String),
          userId: null,
        }),
      );
      expect(mockStatisticsService.recordEntityCreated).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(String),
        {},
        undefined,
      );
    });

    it('should create client with Keycloak credentials for KEYCLOAK type', async () => {
      const createDto: CreateClientDto = {
        name: 'New Client',
        endpoint: 'https://example.com/api',
        authenticationType: AuthenticationType.KEYCLOAK,
        keycloakClientId: 'keycloak-client-id',
        keycloakClientSecret: 'keycloak-client-secret',
        keycloakRealm: 'test-realm',
      };
      const createdClient: ClientEntity = {
        ...mockKeycloakClient,
        name: createDto.name,
        endpoint: createDto.endpoint,
        authenticationType: createDto.authenticationType,
        keycloakClientId: createDto.keycloakClientId,
        keycloakClientSecret: createDto.keycloakClientSecret,
        keycloakRealm: createDto.keycloakRealm,
      };

      mockRepository.findByName.mockResolvedValue(null);
      repository.create.mockResolvedValue(createdClient);

      const result = await service.create(createDto);

      expect(result.name).toBe(createDto.name);
      expect(result.authenticationType).toBe(AuthenticationType.KEYCLOAK);
      expect(result.apiKey).toBeUndefined();
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: createDto.name,
          description: undefined,
          endpoint: createDto.endpoint,
          authenticationType: createDto.authenticationType,
          apiKey: undefined,
          keycloakClientId: createDto.keycloakClientId,
          keycloakClientSecret: createDto.keycloakClientSecret,
          keycloakRealm: createDto.keycloakRealm,
          userId: null,
        }),
      );
    });

    it('should throw BadRequestException when KEYCLOAK type is missing credentials', async () => {
      const createDto: CreateClientDto = {
        name: 'New Client',
        endpoint: 'https://example.com/api',
        authenticationType: AuthenticationType.KEYCLOAK,
      };

      mockRepository.findByName.mockResolvedValue(null);

      await expect(service.create(createDto)).rejects.toThrow(BadRequestException);
      await expect(service.create(createDto)).rejects.toThrow(
        'Keycloak client ID and client secret are required for KEYCLOAK authentication type',
      );
    });

    it('should create client without description', async () => {
      const createDto: CreateClientDto = {
        name: 'New Client',
        endpoint: 'https://example.com/api',
        authenticationType: AuthenticationType.API_KEY,
      };
      const createdClient: ClientEntity = {
        ...mockClient,
        name: createDto.name,
        endpoint: createDto.endpoint,
        authenticationType: createDto.authenticationType,
        description: undefined,
      };

      mockRepository.findByName.mockResolvedValue(null);
      repository.create.mockResolvedValue(createdClient);

      const result = await service.create(createDto);

      expect(result.name).toBe(createDto.name);
      expect(result.description).toBeUndefined();
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: createDto.name,
          description: undefined,
          endpoint: createDto.endpoint,
          authenticationType: createDto.authenticationType,
          apiKey: expect.any(String),
          userId: null,
        }),
      );
    });

    it('should create client with provided API key', async () => {
      const providedApiKey = 'custom-api-key-12345';
      const createDto: CreateClientDto = {
        name: 'New Client',
        endpoint: 'https://example.com/api',
        authenticationType: AuthenticationType.API_KEY,
        apiKey: providedApiKey,
      };
      const createdClient: ClientEntity = {
        ...mockClient,
        name: createDto.name,
        endpoint: createDto.endpoint,
        authenticationType: createDto.authenticationType,
        apiKey: providedApiKey,
      };

      mockRepository.findByName.mockResolvedValue(null);
      repository.create.mockResolvedValue(createdClient);

      const result = await service.create(createDto);

      expect(result.apiKey).toBe(providedApiKey);
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: createDto.name,
          description: undefined,
          endpoint: createDto.endpoint,
          authenticationType: createDto.authenticationType,
          apiKey: providedApiKey,
          userId: null,
        }),
      );
    });

    it('should throw BadRequestException when client name already exists', async () => {
      const createDto: CreateClientDto = {
        name: 'Existing Client',
        endpoint: 'https://example.com/api',
        authenticationType: AuthenticationType.API_KEY,
      };

      mockRepository.findByName.mockResolvedValue(mockClient);

      await expect(service.create(createDto)).rejects.toThrow(BadRequestException);
      await expect(service.create(createDto)).rejects.toThrow("Client with name 'Existing Client' already exists");
    });
  });

  describe('findAll', () => {
    it('should return array of clients with config and isAutoProvisioned set correctly', async () => {
      const clients = [mockClient];
      const mockConfig: ConfigResponseDto = {
        gitRepositoryUrl: 'https://github.com/user/repo.git',
        agentTypes: [{ type: 'cursor', displayName: 'Cursor' }],
      };
      const mockProvisioningReference: ProvisioningReferenceEntity = {
        id: 'ref-uuid',
        clientId: mockClient.id,
        providerType: 'hetzner',
        serverId: 'server-123',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as ProvisioningReferenceEntity;

      mockRepository.findAll.mockResolvedValue(clients);
      clientAgentProxyService.getClientConfig.mockResolvedValue(mockConfig);
      provisioningReferencesRepository.findByClientId.mockResolvedValue(mockProvisioningReference);

      const result = await service.findAll(10, 0, undefined, undefined, true);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(mockClient.id);
      expect(result[0]).not.toHaveProperty('apiKey');
      expect(result[0].config).toEqual(mockConfig);
      expect(result[0].isAutoProvisioned).toBe(true);
      expect(repository.findAll).toHaveBeenCalledWith(10, 0);
      expect(clientAgentProxyService.getClientConfig).toHaveBeenCalledWith(mockClient.id);
      expect(provisioningReferencesRepository.findByClientId).toHaveBeenCalledWith(mockClient.id);
    });

    it('should set isAutoProvisioned to false when no provisioning reference exists', async () => {
      const clients = [mockClient];

      mockRepository.findAll.mockResolvedValue(clients);
      clientAgentProxyService.getClientConfig.mockResolvedValue(undefined);
      provisioningReferencesRepository.findByClientId.mockResolvedValue(null);

      const result = await service.findAll(10, 0, undefined, undefined, true);

      expect(result).toHaveLength(1);
      expect(result[0].isAutoProvisioned).toBe(false);
      expect(provisioningReferencesRepository.findByClientId).toHaveBeenCalledWith(mockClient.id);
    });

    it('should return clients without config if fetch fails', async () => {
      const clients = [mockClient];

      mockRepository.findAll.mockResolvedValue(clients);
      clientAgentProxyService.getClientConfig.mockResolvedValue(undefined);
      provisioningReferencesRepository.findByClientId.mockResolvedValue(null);

      const result = await service.findAll(10, 0, undefined, undefined, true);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(mockClient.id);
      expect(result[0].config).toBeUndefined();
      expect(result[0].isAutoProvisioned).toBe(false);
      expect(repository.findAll).toHaveBeenCalledWith(10, 0);
    });

    it('should use default pagination values', async () => {
      const clients = [mockClient];

      mockRepository.findAll.mockResolvedValue(clients);
      clientAgentProxyService.getClientConfig.mockResolvedValue(undefined);
      provisioningReferencesRepository.findByClientId.mockResolvedValue(null);

      await service.findAll(10, 0, undefined, undefined, true);

      expect(repository.findAll).toHaveBeenCalledWith(10, 0);
    });

    it('should set canManageWorkspaceConfiguration to false for plain client_users user', async () => {
      const clientForList: ClientEntity = { ...mockClient, userId: 'other-creator' };

      mockRepository.findAll.mockResolvedValue([clientForList]);
      mockRepository.findById.mockResolvedValue(clientForList);
      clientUsersRepository.findByUserId.mockResolvedValue([
        { clientId: clientForList.id, userId: 'member-1', role: ClientUserRole.USER } as any,
      ]);
      mockClientUsersRepository.findUserClientAccess.mockResolvedValue({
        userId: 'member-1',
        clientId: clientForList.id,
        role: ClientUserRole.USER,
      } as any);
      clientAgentProxyService.getClientConfig.mockResolvedValue(undefined);
      provisioningReferencesRepository.findByClientId.mockResolvedValue(null);

      const result = await service.findAll(10, 0, 'member-1', UserRole.USER, false);

      expect(result).toHaveLength(1);
      expect(result[0].canManageWorkspaceConfiguration).toBe(false);
    });
  });

  describe('findOne', () => {
    it('should return client by id with config and isAutoProvisioned set correctly', async () => {
      const mockConfig: ConfigResponseDto = {
        gitRepositoryUrl: 'https://github.com/user/repo.git',
        agentTypes: [{ type: 'cursor', displayName: 'Cursor' }],
      };
      const mockProvisioningReference: ProvisioningReferenceEntity = {
        id: 'ref-uuid',
        clientId: mockClient.id,
        providerType: 'hetzner',
        serverId: 'server-123',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as ProvisioningReferenceEntity;

      mockRepository.findByIdOrThrow.mockResolvedValue(mockClient);
      clientAgentProxyService.getClientConfig.mockResolvedValue(mockConfig);
      mockProvisioningReferencesRepository.findByClientId.mockResolvedValue(mockProvisioningReference);

      const result = await service.findOne('test-uuid', undefined, undefined, true);

      expect(result.id).toBe(mockClient.id);
      expect(result).not.toHaveProperty('apiKey');
      expect(result.config).toEqual(mockConfig);
      expect(result.isAutoProvisioned).toBe(true);
      expect(repository.findByIdOrThrow).toHaveBeenCalledWith('test-uuid');
      expect(clientAgentProxyService.getClientConfig).toHaveBeenCalledWith('test-uuid');
      expect(provisioningReferencesRepository.findByClientId).toHaveBeenCalledWith('test-uuid');
    });

    it('should set isAutoProvisioned to false when no provisioning reference exists', async () => {
      mockRepository.findByIdOrThrow.mockResolvedValue(mockClient);
      clientAgentProxyService.getClientConfig.mockResolvedValue(undefined);
      provisioningReferencesRepository.findByClientId.mockResolvedValue(null);

      const result = await service.findOne('test-uuid', undefined, undefined, true);

      expect(result.id).toBe(mockClient.id);
      expect(result.config).toBeUndefined();
      expect(result.isAutoProvisioned).toBe(false);
      expect(repository.findByIdOrThrow).toHaveBeenCalledWith('test-uuid');
      expect(provisioningReferencesRepository.findByClientId).toHaveBeenCalledWith('test-uuid');
    });
  });

  describe('update', () => {
    it('should update client with config', async () => {
      const updateDto: UpdateClientDto = {
        name: 'Updated Client',
        description: 'Updated Description',
      };
      const updatedClient = { ...mockClient, ...updateDto };
      const mockConfig: ConfigResponseDto = {
        gitRepositoryUrl: 'https://github.com/user/repo.git',
        agentTypes: [{ type: 'cursor', displayName: 'Cursor' }],
      };

      mockRepository.findByIdOrThrow.mockResolvedValue(mockClient);
      mockRepository.findByName.mockResolvedValue(null);
      repository.update.mockResolvedValue(updatedClient);
      clientAgentProxyService.getClientConfig.mockResolvedValue(mockConfig);

      const result = await service.update('test-uuid', updateDto, undefined, undefined, true);

      expect(result.name).toBe(updateDto.name);
      expect(result.description).toBe(updateDto.description);
      expect(result.config).toEqual(mockConfig);
      expect(repository.update).toHaveBeenCalled();
      expect(clientAgentProxyService.getClientConfig).toHaveBeenCalledWith('test-uuid');
    });

    it('should update endpoint', async () => {
      const updateDto: UpdateClientDto = {
        endpoint: 'https://new-example.com/api',
      };
      const updatedClient = { ...mockClient, endpoint: updateDto.endpoint };

      mockRepository.findByIdOrThrow.mockResolvedValue(mockClient);
      mockRepository.findByName.mockResolvedValue(null);
      repository.update.mockResolvedValue(updatedClient);

      const result = await service.update('test-uuid', updateDto, undefined, undefined, true);

      expect(result.endpoint).toBe(updateDto.endpoint);
    });

    it('should update authentication type to KEYCLOAK with credentials', async () => {
      const updateDto: UpdateClientDto = {
        authenticationType: AuthenticationType.KEYCLOAK,
        keycloakClientId: 'keycloak-client-id',
        keycloakClientSecret: 'keycloak-client-secret',
        keycloakRealm: 'test-realm',
      };
      const updatedClient = {
        ...mockClient,
        authenticationType: updateDto.authenticationType,
        keycloakClientId: updateDto.keycloakClientId,
        keycloakClientSecret: updateDto.keycloakClientSecret,
        keycloakRealm: updateDto.keycloakRealm,
      };

      mockRepository.findByIdOrThrow.mockResolvedValue(mockClient);
      mockRepository.findByName.mockResolvedValue(null);
      mockRepository.findById.mockResolvedValue(mockClient);
      repository.update.mockResolvedValue(updatedClient);

      const result = await service.update('test-uuid', updateDto, undefined, undefined, true);

      expect(result.authenticationType).toBe(AuthenticationType.KEYCLOAK);
    });

    it('should throw BadRequestException when changing to KEYCLOAK without credentials', async () => {
      const updateDto: UpdateClientDto = {
        authenticationType: AuthenticationType.KEYCLOAK,
      };

      mockRepository.findByIdOrThrow.mockResolvedValue(mockClient);
      mockRepository.findByName.mockResolvedValue(null);
      mockRepository.findById.mockResolvedValue(mockClient);

      await expect(service.update('test-uuid', updateDto, undefined, undefined, true)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.update('test-uuid', updateDto)).rejects.toThrow(
        'Keycloak client ID and client secret are required when changing authentication type to KEYCLOAK',
      );
    });

    it('should update Keycloak credentials and clear cache', async () => {
      const updateDto: UpdateClientDto = {
        keycloakClientId: 'new-client-id',
        keycloakClientSecret: 'new-client-secret',
        keycloakRealm: 'new-realm',
      };
      const updatedClient = {
        ...mockKeycloakClient,
        ...updateDto,
      };

      process.env.KEYCLOAK_AUTH_SERVER_URL = 'https://keycloak.example.com';
      mockRepository.findByIdOrThrow.mockResolvedValue(mockKeycloakClient);
      mockRepository.findByName.mockResolvedValue(null);
      mockRepository.findById.mockResolvedValue(mockKeycloakClient);
      repository.update.mockResolvedValue(updatedClient);

      await service.update('keycloak-client-uuid', updateDto, undefined, undefined, true);

      expect(keycloakTokenService.clearCache).toHaveBeenCalledWith(
        'https://keycloak.example.com',
        'new-realm',
        'new-client-id',
      );
      delete process.env.KEYCLOAK_AUTH_SERVER_URL;
    });

    it('should throw BadRequestException when new name conflicts', async () => {
      const updateDto: UpdateClientDto = {
        name: 'Conflicting Name',
      };
      const conflictingClient = { ...mockClient, id: 'different-id' };

      mockRepository.findByIdOrThrow.mockResolvedValue(mockClient);
      mockRepository.findByName.mockResolvedValue(conflictingClient);

      await expect(service.update('test-uuid', updateDto, undefined, undefined, true)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should allow updating to same name', async () => {
      const updateDto: UpdateClientDto = {
        name: 'Test Client',
      };
      const updatedClient = { ...mockClient, name: updateDto.name };

      mockRepository.findByIdOrThrow.mockResolvedValue(mockClient);
      mockRepository.findByName.mockResolvedValue(mockClient);
      repository.update.mockResolvedValue(updatedClient);

      const result = await service.update('test-uuid', updateDto, undefined, undefined, true);

      expect(result.name).toBe(updateDto.name);
    });

    it('should remove undefined fields from update', async () => {
      const updateDto: UpdateClientDto = {
        name: 'Updated Client',
      };
      const updatedClient = { ...mockClient, name: updateDto.name };

      mockRepository.findByIdOrThrow.mockResolvedValue(mockClient);
      mockRepository.findByName.mockResolvedValue(null);
      repository.update.mockResolvedValue(updatedClient);

      await service.update('test-uuid', updateDto, undefined, undefined, true);

      expect(repository.update).toHaveBeenCalledWith('test-uuid', {
        name: updateDto.name,
      });
    });

    it('should update API key', async () => {
      const newApiKey = 'new-api-key-12345';
      const updateDto: UpdateClientDto = {
        apiKey: newApiKey,
      };
      const updatedClient = { ...mockClient, apiKey: newApiKey };

      mockRepository.findByIdOrThrow.mockResolvedValue(mockClient);
      mockRepository.findByName.mockResolvedValue(null);
      repository.update.mockResolvedValue(updatedClient);

      const result = await service.update('test-uuid', updateDto, undefined, undefined, true);

      expect(result).not.toHaveProperty('apiKey');
      expect(repository.update).toHaveBeenCalledWith('test-uuid', {
        apiKey: newApiKey,
      });
    });

    it('should update API key along with other fields', async () => {
      const newApiKey = 'new-api-key-12345';
      const updateDto: UpdateClientDto = {
        name: 'Updated Client',
        apiKey: newApiKey,
      };
      const updatedClient = { ...mockClient, name: updateDto.name, apiKey: newApiKey };

      mockRepository.findByIdOrThrow.mockResolvedValue(mockClient);
      mockRepository.findByName.mockResolvedValue(null);
      repository.update.mockResolvedValue(updatedClient);

      const result = await service.update('test-uuid', updateDto, undefined, undefined, true);

      expect(result.name).toBe(updateDto.name);
      expect(result).not.toHaveProperty('apiKey');
      expect(repository.update).toHaveBeenCalledWith('test-uuid', {
        name: updateDto.name,
        apiKey: newApiKey,
      });
    });
  });

  describe('remove', () => {
    it('should delete client', async () => {
      mockRepository.findByIdOrThrow.mockResolvedValue(mockClient);
      repository.delete.mockResolvedValue(undefined);

      await service.remove('test-uuid', undefined, undefined, true);

      expect(repository.findByIdOrThrow).toHaveBeenCalledWith('test-uuid');
      expect(repository.delete).toHaveBeenCalledWith('test-uuid');
      expect(mockStatisticsService.recordEntityDeleted).toHaveBeenCalledWith(expect.anything(), 'test-uuid', undefined);
    });

    it('should clear token cache when deleting Keycloak client', async () => {
      process.env.KEYCLOAK_AUTH_SERVER_URL = 'https://keycloak.example.com';
      mockRepository.findByIdOrThrow.mockResolvedValue(mockKeycloakClient);
      repository.delete.mockResolvedValue(undefined);

      await service.remove('keycloak-client-uuid', undefined, undefined, true);

      expect(keycloakTokenService.clearCache).toHaveBeenCalledWith(
        'https://keycloak.example.com',
        'test-realm',
        'keycloak-client-id',
      );
      expect(repository.delete).toHaveBeenCalledWith('keycloak-client-uuid');
      delete process.env.KEYCLOAK_AUTH_SERVER_URL;
    });
  });

  describe('getAccessToken', () => {
    beforeEach(() => {
      process.env.KEYCLOAK_AUTH_SERVER_URL = 'https://keycloak.example.com';
      process.env.KEYCLOAK_REALM = 'default-realm';
    });

    afterEach(() => {
      delete process.env.KEYCLOAK_AUTH_SERVER_URL;
      delete process.env.KEYCLOAK_REALM;
    });

    it('should get access token for Keycloak client', async () => {
      const expectedToken = 'jwt-access-token-123';

      mockRepository.findByIdOrThrow.mockResolvedValue(mockKeycloakClient);
      keycloakTokenService.getAccessToken.mockResolvedValue(expectedToken);

      const result = await service.getAccessToken('keycloak-client-uuid');

      expect(result).toBe(expectedToken);
      expect(keycloakTokenService.getAccessToken).toHaveBeenCalledWith(
        'https://keycloak.example.com',
        'test-realm',
        'keycloak-client-id',
        'keycloak-client-secret',
      );
    });

    it('should use environment realm when client realm is not set', async () => {
      const clientWithoutRealm = {
        ...mockKeycloakClient,
        keycloakRealm: undefined,
      };
      const expectedToken = 'jwt-access-token-123';

      mockRepository.findByIdOrThrow.mockResolvedValue(clientWithoutRealm);
      keycloakTokenService.getAccessToken.mockResolvedValue(expectedToken);

      const result = await service.getAccessToken('keycloak-client-uuid');

      expect(result).toBe(expectedToken);
      expect(keycloakTokenService.getAccessToken).toHaveBeenCalledWith(
        'https://keycloak.example.com',
        'default-realm',
        'keycloak-client-id',
        'keycloak-client-secret',
      );
    });

    it('should throw BadRequestException when client is not KEYCLOAK type', async () => {
      mockRepository.findByIdOrThrow.mockResolvedValue(mockClient);

      await expect(service.getAccessToken('test-uuid')).rejects.toThrow(BadRequestException);
      await expect(service.getAccessToken('test-uuid')).rejects.toThrow(
        'Client is not configured for Keycloak authentication',
      );
    });

    it('should throw BadRequestException when Keycloak credentials are missing', async () => {
      const clientWithoutCredentials = {
        ...mockKeycloakClient,
        keycloakClientId: undefined,
        keycloakClientSecret: undefined,
      };

      mockRepository.findByIdOrThrow.mockResolvedValue(clientWithoutCredentials);

      await expect(service.getAccessToken('keycloak-client-uuid')).rejects.toThrow(BadRequestException);
      await expect(service.getAccessToken('keycloak-client-uuid')).rejects.toThrow(
        'Keycloak client credentials are not configured for this client',
      );
    });

    it('should throw BadRequestException when KEYCLOAK_AUTH_SERVER_URL is not set', async () => {
      delete process.env.KEYCLOAK_AUTH_SERVER_URL;
      mockRepository.findByIdOrThrow.mockResolvedValue(mockKeycloakClient);

      await expect(service.getAccessToken('keycloak-client-uuid')).rejects.toThrow(BadRequestException);
      await expect(service.getAccessToken('keycloak-client-uuid')).rejects.toThrow(
        'KEYCLOAK_AUTH_SERVER_URL environment variable is not set',
      );
    });

    it('should throw BadRequestException when realm is not configured', async () => {
      delete process.env.KEYCLOAK_REALM;
      const clientWithoutRealm = {
        ...mockKeycloakClient,
        keycloakRealm: undefined,
      };

      mockRepository.findByIdOrThrow.mockResolvedValue(clientWithoutRealm);

      await expect(service.getAccessToken('keycloak-client-uuid')).rejects.toThrow(BadRequestException);
      await expect(service.getAccessToken('keycloak-client-uuid')).rejects.toThrow(
        'Keycloak realm is not configured for this client and KEYCLOAK_REALM is not set',
      );
    });
  });

  describe('generateRandomApiKey', () => {
    it('should generate API keys of correct length', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const apiKey1 = (service as any).generateRandomApiKey();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const apiKey2 = (service as any).generateRandomApiKey();

      expect(apiKey1).toHaveLength(32);
      expect(apiKey2).toHaveLength(32);
      expect(apiKey1).not.toBe(apiKey2); // Should be random
    });

    it('should generate API keys with alphanumeric characters', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const apiKey = (service as any).generateRandomApiKey();
      const alphanumericRegex = /^[a-zA-Z0-9]+$/;

      expect(apiKey).toMatch(alphanumericRegex);
    });
  });

  describe('mapToResponseDto', () => {
    it('should exclude apiKey from response and set isAutoProvisioned correctly', async () => {
      const mockProvisioningReference: ProvisioningReferenceEntity = {
        id: 'ref-uuid',
        clientId: mockClient.id,
        providerType: 'hetzner',
        serverId: 'server-123',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as ProvisioningReferenceEntity;

      mockProvisioningReferencesRepository.findByClientId.mockResolvedValue(mockProvisioningReference);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (service as any).mapToResponseDto(mockClient);

      expect(result).not.toHaveProperty('apiKey');
      expect(result.id).toBe(mockClient.id);
      expect(result.name).toBe(mockClient.name);
      expect(result.description).toBe(mockClient.description);
      expect(result.endpoint).toBe(mockClient.endpoint);
      expect(result.authenticationType).toBe(mockClient.authenticationType);
      expect(result.isAutoProvisioned).toBe(true);
      expect(result.createdAt).toBe(mockClient.createdAt);
      expect(result.updatedAt).toBe(mockClient.updatedAt);
      expect(provisioningReferencesRepository.findByClientId).toHaveBeenCalledWith(mockClient.id);
    });

    it('should set isAutoProvisioned to false when no provisioning reference exists', async () => {
      provisioningReferencesRepository.findByClientId.mockResolvedValue(null);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (service as any).mapToResponseDto(mockClient);

      expect(result.isAutoProvisioned).toBe(false);
      expect(provisioningReferencesRepository.findByClientId).toHaveBeenCalledWith(mockClient.id);
    });
  });

  describe('getAccessibleClientIds', () => {
    it('should return all client IDs when API key auth', async () => {
      mockRepository.findAllIds.mockResolvedValue(['c1', 'c2', 'c3']);

      const result = await service.getAccessibleClientIds(undefined, undefined, true);

      expect(result).toEqual(['c1', 'c2', 'c3']);
      expect(mockRepository.findAllIds).toHaveBeenCalled();
      expect(mockClientUsersRepository.findByUserId).not.toHaveBeenCalled();
      expect(mockRepository.findIdsByCreatorId).not.toHaveBeenCalled();
    });

    it('should return all client IDs when user is admin', async () => {
      mockRepository.findAllIds.mockResolvedValue(['c1', 'c2']);

      const result = await service.getAccessibleClientIds('user-1', UserRole.ADMIN, false);

      expect(result).toEqual(['c1', 'c2']);
      expect(mockRepository.findAllIds).toHaveBeenCalled();
    });

    it('should return union of client_users and creator clients for regular user', async () => {
      mockClientUsersRepository.findByUserId.mockResolvedValue([
        { clientId: 'c1' } as never,
        { clientId: 'c2' } as never,
      ]);
      mockRepository.findIdsByCreatorId.mockResolvedValue(['c2', 'c3']);

      const result = await service.getAccessibleClientIds('user-1', UserRole.USER, false);

      expect(result).toContain('c1');
      expect(result).toContain('c2');
      expect(result).toContain('c3');
      expect(result).toHaveLength(3);
      expect(mockClientUsersRepository.findByUserId).toHaveBeenCalledWith('user-1');
      expect(mockRepository.findIdsByCreatorId).toHaveBeenCalledWith('user-1');
    });

    it('should return empty array when no userId or userRole', async () => {
      const result = await service.getAccessibleClientIds(undefined, undefined, false);

      expect(result).toEqual([]);
      expect(mockRepository.findAllIds).not.toHaveBeenCalled();
      expect(mockClientUsersRepository.findByUserId).not.toHaveBeenCalled();
    });
  });
});
