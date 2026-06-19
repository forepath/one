import { GitRepositorySetupMode } from '@forepath/agenstra/backend/feature-agent-manager';
import { AuthenticationType, ClientEntity } from '@forepath/identity/backend';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { ProvisionServerDto } from '../dto/provision-server.dto';
import { ProvisioningReferenceEntity } from '../entities/provisioning-reference.entity';
import {
  PROVISIONING_PROVIDER_REGISTRY,
  ProvisionedServer,
  ProvisioningProvider,
  ServerInfo,
} from '@forepath/agenstra/backend/util-plugin-host';
import { ProvisioningReferencesRepository } from '../repositories/provisioning-references.repository';

import { ClientsService } from './clients.service';
import { ProvisioningService } from './provisioning.service';
import { StatisticsService } from './statistics.service';

describe('ProvisioningService', () => {
  let service: ProvisioningService;
  const mockProvider: ProvisioningProvider = {
    getType: jest.fn().mockReturnValue('hetzner'),
    getDisplayName: jest.fn().mockReturnValue('Hetzner Cloud'),
    getServerTypes: jest.fn(),
    provisionServer: jest.fn(),
    deleteServer: jest.fn(),
    getServerInfo: jest.fn(),
  };
  const mockClient: ClientEntity = {
    id: 'client-uuid',
    name: 'test-server',
    description: 'Provisioned via hetzner',
    endpoint: 'http://1.2.3.4:3100',
    authenticationType: AuthenticationType.API_KEY,
    apiKey: 'generated-api-key',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };
  const mockProvisionedServer: ProvisionedServer = {
    serverId: 'server-123',
    name: 'test-server',
    publicIp: '1.2.3.4',
    privateIp: '10.0.0.1',
    endpoint: 'http://1.2.3.4:3100',
    status: 'running',
    metadata: {
      location: 'fsn1',
      datacenter: 'fsn1-dc8',
    },
  };
  const mockServerInfo: ServerInfo = {
    serverId: 'server-123',
    name: 'test-server',
    publicIp: '1.2.3.4',
    privateIp: '10.0.0.1',
    status: 'running',
    metadata: {
      location: 'fsn1',
      datacenter: 'fsn1-dc8',
    },
  };
  const mockProvisioningReference: ProvisioningReferenceEntity = {
    id: 'ref-uuid',
    clientId: 'client-uuid',
    providerType: 'hetzner',
    serverId: 'server-123',
    serverName: 'test-server',
    publicIp: '1.2.3.4',
    privateIp: '10.0.0.1',
    providerMetadata: JSON.stringify({ location: 'fsn1', datacenter: 'fsn1-dc8' }),
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    client: mockClient,
  };
  const mockPROVISIONING_PROVIDER_REGISTRY = {
    hasProvider: jest.fn(),
    getProvider: jest.fn(),
    getRegisteredIds: jest.fn(),
  };
  const mockClientsService = {
    create: jest.fn(),
    remove: jest.fn(),
  };
  const mockProvisioningReferencesRepository = {
    create: jest.fn(),
    findByClientId: jest.fn(),
    update: jest.fn(),
  };
  const mockStatisticsService = {
    recordEntityCreated: jest.fn().mockResolvedValue(undefined),
    recordEntityDeleted: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProvisioningService,
        {
          provide: PROVISIONING_PROVIDER_REGISTRY,
          useValue: mockPROVISIONING_PROVIDER_REGISTRY,
        },
        {
          provide: ClientsService,
          useValue: mockClientsService,
        },
        {
          provide: 'ClientUsersRepository',
          useValue: {},
        },
        {
          provide: 'ClientUsersService',
          useValue: {},
        },
        {
          provide: ProvisioningReferencesRepository,
          useValue: mockProvisioningReferencesRepository,
        },
        {
          provide: StatisticsService,
          useValue: mockStatisticsService,
        },
      ],
    }).compile();

    service = module.get<ProvisioningService>(ProvisioningService);

    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('provisionServer', () => {
    const provisionDto: ProvisionServerDto = {
      providerType: 'hetzner',
      serverType: 'cx11',
      name: 'test-server',
      description: 'Test server',
      location: 'fsn1',
      authenticationType: AuthenticationType.API_KEY,
      agentWsPort: 8080,
    };

    it('should provision a server with API_KEY authentication and create client', async () => {
      mockPROVISIONING_PROVIDER_REGISTRY.hasProvider.mockReturnValue(true);
      mockPROVISIONING_PROVIDER_REGISTRY.getProvider.mockReturnValue(mockProvider);
      (mockProvider.provisionServer as jest.Mock).mockResolvedValue(mockProvisionedServer);
      mockClientsService.create.mockResolvedValue(mockClient);
      mockProvisioningReferencesRepository.create.mockResolvedValue(mockProvisioningReference);

      const result = await service.provisionServer(provisionDto);

      expect(result).toEqual({
        ...mockClient,
        isAutoProvisioned: true,
        providerType: 'hetzner',
        serverId: 'server-123',
        serverName: 'test-server',
        publicIp: '1.2.3.4',
        privateIp: '10.0.0.1',
        serverStatus: 'running',
      });
      expect(result.isAutoProvisioned).toBe(true);

      expect(mockPROVISIONING_PROVIDER_REGISTRY.hasProvider).toHaveBeenCalledWith('hetzner');
      expect(mockPROVISIONING_PROVIDER_REGISTRY.getProvider).toHaveBeenCalledWith('hetzner');
      expect(mockProvider.provisionServer).toHaveBeenCalledWith(
        expect.objectContaining({
          serverType: 'cx11',
          name: 'test-server',
          description: 'Test server',
          location: 'fsn1',
          userData: expect.any(String),
        }),
      );
      expect(mockClientsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'test-server',
          description: 'Test server', // Uses provided description
          endpoint: 'http://1.2.3.4:3100',
          authenticationType: AuthenticationType.API_KEY,
          apiKey: expect.any(String),
          agentWsPort: 8080,
        }),
        undefined, // userId
        undefined, // userRole
        false, // isApiKeyAuth
      );
      expect(mockProvisioningReferencesRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          clientId: 'client-uuid',
          providerType: 'hetzner',
          serverId: 'server-123',
          serverName: 'test-server',
          publicIp: '1.2.3.4',
          privateIp: '10.0.0.1',
        }),
      );
    });

    it('should provision a server with KEYCLOAK authentication', async () => {
      const keycloakDto: ProvisionServerDto = {
        ...provisionDto,
        authenticationType: AuthenticationType.KEYCLOAK,
        keycloakClientId: 'keycloak-client-id',
        keycloakClientSecret: 'keycloak-client-secret',
        keycloakRealm: 'test-realm',
      };
      const keycloakClient: ClientEntity = {
        ...mockClient,
        authenticationType: AuthenticationType.KEYCLOAK,
        keycloakClientId: 'keycloak-client-id',
        keycloakClientSecret: 'keycloak-client-secret',
        keycloakRealm: 'test-realm',
        apiKey: undefined,
      };

      mockPROVISIONING_PROVIDER_REGISTRY.hasProvider.mockReturnValue(true);
      mockPROVISIONING_PROVIDER_REGISTRY.getProvider.mockReturnValue(mockProvider);
      (mockProvider.provisionServer as jest.Mock).mockResolvedValue(mockProvisionedServer);
      mockClientsService.create.mockResolvedValue(keycloakClient);
      mockProvisioningReferencesRepository.create.mockResolvedValue(mockProvisioningReference);

      const result = await service.provisionServer(keycloakDto);

      expect(result.authenticationType).toBe(AuthenticationType.KEYCLOAK);
      expect(mockClientsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          authenticationType: AuthenticationType.KEYCLOAK,
          keycloakClientId: 'keycloak-client-id',
          keycloakClientSecret: 'keycloak-client-secret',
          keycloakRealm: 'test-realm',
        }),
        undefined,
        undefined,
        false,
      );
    });

    it('should emit GIT_REPOSITORY_SETUP_MODE for empty git provisioning and omit clone credentials', async () => {
      const emptyGitDto: ProvisionServerDto = {
        ...provisionDto,
        gitRepositorySetupMode: GitRepositorySetupMode.EMPTY,
        gitRepositoryUrl: 'https://github.com/user/repo.git',
        gitUsername: 'user',
        gitToken: 'token',
      };

      mockPROVISIONING_PROVIDER_REGISTRY.hasProvider.mockReturnValue(true);
      mockPROVISIONING_PROVIDER_REGISTRY.getProvider.mockReturnValue(mockProvider);
      (mockProvider.provisionServer as jest.Mock).mockResolvedValue(mockProvisionedServer);
      mockClientsService.create.mockResolvedValue(mockClient);
      mockProvisioningReferencesRepository.create.mockResolvedValue(mockProvisioningReference);

      await service.provisionServer(emptyGitDto);

      const provisionCall = (mockProvider.provisionServer as jest.Mock).mock.calls[0][0];
      const userData = Buffer.from(provisionCall.userData, 'base64').toString('utf-8');

      expect(userData).toContain('GIT_REPOSITORY_SETUP_MODE: empty');
      expect(userData).not.toContain('GIT_REPOSITORY_URL:');
      expect(userData).not.toContain('GIT_USERNAME:');
      expect(userData).not.toContain('GIT_TOKEN:');
    });

    it('should use provided API key if given', async () => {
      const dtoWithApiKey: ProvisionServerDto = {
        ...provisionDto,
        apiKey: 'custom-api-key-123',
      };

      mockPROVISIONING_PROVIDER_REGISTRY.hasProvider.mockReturnValue(true);
      mockPROVISIONING_PROVIDER_REGISTRY.getProvider.mockReturnValue(mockProvider);
      (mockProvider.provisionServer as jest.Mock).mockResolvedValue(mockProvisionedServer);
      mockClientsService.create.mockResolvedValue(mockClient);
      mockProvisioningReferencesRepository.create.mockResolvedValue(mockProvisioningReference);

      await service.provisionServer(dtoWithApiKey);

      expect(mockClientsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: 'custom-api-key-123',
        }),
        undefined,
        undefined,
        false,
      );
    });

    it('should generate API key if not provided for API_KEY authentication', async () => {
      mockPROVISIONING_PROVIDER_REGISTRY.hasProvider.mockReturnValue(true);
      mockPROVISIONING_PROVIDER_REGISTRY.getProvider.mockReturnValue(mockProvider);
      (mockProvider.provisionServer as jest.Mock).mockResolvedValue(mockProvisionedServer);
      mockClientsService.create.mockResolvedValue(mockClient);
      mockProvisioningReferencesRepository.create.mockResolvedValue(mockProvisioningReference);

      await service.provisionServer(provisionDto);

      const createCall = mockClientsService.create.mock.calls[0][0];

      expect(createCall.apiKey).toBeDefined();
      expect(createCall.apiKey).toHaveLength(32); // API_KEY_LENGTH
      expect(typeof createCall.apiKey).toBe('string');
    });

    it('should throw BadRequestException when provider is not available', async () => {
      mockPROVISIONING_PROVIDER_REGISTRY.hasProvider.mockReturnValue(false);
      mockPROVISIONING_PROVIDER_REGISTRY.getRegisteredIds.mockReturnValue(['aws']);

      await expect(service.provisionServer(provisionDto)).rejects.toThrow(BadRequestException);
      await expect(service.provisionServer(provisionDto)).rejects.toThrow("Provider type 'hetzner' is not available");
    });

    it('should include authentication configuration in user data', async () => {
      mockPROVISIONING_PROVIDER_REGISTRY.hasProvider.mockReturnValue(true);
      mockPROVISIONING_PROVIDER_REGISTRY.getProvider.mockReturnValue(mockProvider);
      (mockProvider.provisionServer as jest.Mock).mockResolvedValue(mockProvisionedServer);
      mockClientsService.create.mockResolvedValue(mockClient);
      mockProvisioningReferencesRepository.create.mockResolvedValue(mockProvisioningReference);

      await service.provisionServer(provisionDto);

      const provisionCall = (mockProvider.provisionServer as jest.Mock).mock.calls[0][0];

      expect(provisionCall.userData).toBeDefined();
      const decodedUserData = Buffer.from(provisionCall.userData, 'base64').toString('utf-8');

      expect(decodedUserData).toContain('agent-manager');
      expect(decodedUserData).toContain('docker-compose.yml');
    });

    it('should embed AUTO_ENRICH_ENABLED_GLOBAL in user data when provided', async () => {
      mockPROVISIONING_PROVIDER_REGISTRY.hasProvider.mockReturnValue(true);
      mockPROVISIONING_PROVIDER_REGISTRY.getProvider.mockReturnValue(mockProvider);
      (mockProvider.provisionServer as jest.Mock).mockResolvedValue(mockProvisionedServer);
      mockClientsService.create.mockResolvedValue(mockClient);
      mockProvisioningReferencesRepository.create.mockResolvedValue(mockProvisioningReference);

      await service.provisionServer({ ...provisionDto, autoEnrichEnabledGlobal: 'false' });

      const provisionCall = (mockProvider.provisionServer as jest.Mock).mock.calls[0][0];
      const decodedUserData = Buffer.from(provisionCall.userData, 'base64').toString('utf-8');

      expect(decodedUserData).toContain('AUTO_ENRICH_ENABLED_GLOBAL: false');
    });

    it('should embed AUTO_ENRICH_VECTOR_MAX_COSINE_DISTANCE in user data when provided', async () => {
      mockPROVISIONING_PROVIDER_REGISTRY.hasProvider.mockReturnValue(true);
      mockPROVISIONING_PROVIDER_REGISTRY.getProvider.mockReturnValue(mockProvider);
      (mockProvider.provisionServer as jest.Mock).mockResolvedValue(mockProvisionedServer);
      mockClientsService.create.mockResolvedValue(mockClient);
      mockProvisioningReferencesRepository.create.mockResolvedValue(mockProvisioningReference);

      await service.provisionServer({ ...provisionDto, autoEnrichVectorMaxCosineDistance: 0.45 });

      const provisionCall = (mockProvider.provisionServer as jest.Mock).mock.calls[0][0];
      const decodedUserData = Buffer.from(provisionCall.userData, 'base64').toString('utf-8');

      expect(decodedUserData).toContain('AUTO_ENRICH_VECTOR_MAX_COSINE_DISTANCE: 0.45');
    });
  });

  describe('deleteProvisionedServer', () => {
    it('should delete server from provider and remove client', async () => {
      mockProvisioningReferencesRepository.findByClientId.mockResolvedValue(mockProvisioningReference);
      mockPROVISIONING_PROVIDER_REGISTRY.hasProvider.mockReturnValue(true);
      mockPROVISIONING_PROVIDER_REGISTRY.getProvider.mockReturnValue(mockProvider);
      (mockProvider.deleteServer as jest.Mock).mockResolvedValue(undefined);
      mockClientsService.remove.mockResolvedValue(undefined);

      await service.deleteProvisionedServer('client-uuid');

      expect(mockProvisioningReferencesRepository.findByClientId).toHaveBeenCalledWith('client-uuid');
      expect(mockPROVISIONING_PROVIDER_REGISTRY.hasProvider).toHaveBeenCalledWith('hetzner');
      expect(mockProvider.deleteServer).toHaveBeenCalledWith('server-123');
      expect(mockClientsService.remove).toHaveBeenCalledWith('client-uuid', undefined, undefined, true);
    });

    it('should continue with client deletion even if server deletion fails', async () => {
      mockProvisioningReferencesRepository.findByClientId.mockResolvedValue(mockProvisioningReference);
      mockPROVISIONING_PROVIDER_REGISTRY.hasProvider.mockReturnValue(true);
      mockPROVISIONING_PROVIDER_REGISTRY.getProvider.mockReturnValue(mockProvider);
      (mockProvider.deleteServer as jest.Mock).mockRejectedValue(new Error('Server deletion failed'));
      mockClientsService.remove.mockResolvedValue(undefined);

      await service.deleteProvisionedServer('client-uuid');

      expect(mockProvider.deleteServer).toHaveBeenCalled();
      expect(mockClientsService.remove).toHaveBeenCalledWith('client-uuid', undefined, undefined, true);
    });

    it('should skip server deletion if provider is not available', async () => {
      mockProvisioningReferencesRepository.findByClientId.mockResolvedValue(mockProvisioningReference);
      mockPROVISIONING_PROVIDER_REGISTRY.hasProvider.mockReturnValue(false);
      mockClientsService.remove.mockResolvedValue(undefined);

      await service.deleteProvisionedServer('client-uuid');

      expect(mockProvider.deleteServer).not.toHaveBeenCalled();
      expect(mockClientsService.remove).toHaveBeenCalledWith('client-uuid', undefined, undefined, true);
    });

    it('should throw BadRequestException when provisioning reference is not found', async () => {
      mockProvisioningReferencesRepository.findByClientId.mockResolvedValue(null);

      await expect(service.deleteProvisionedServer('client-uuid')).rejects.toThrow(BadRequestException);
      await expect(service.deleteProvisionedServer('client-uuid')).rejects.toThrow(
        'No provisioning reference found for client client-uuid',
      );
    });
  });

  describe('getServerInfo', () => {
    it('should return fresh server information from provider', async () => {
      mockProvisioningReferencesRepository.findByClientId.mockResolvedValue(mockProvisioningReference);
      mockPROVISIONING_PROVIDER_REGISTRY.hasProvider.mockReturnValue(true);
      mockPROVISIONING_PROVIDER_REGISTRY.getProvider.mockReturnValue(mockProvider);
      (mockProvider.getServerInfo as jest.Mock).mockResolvedValue(mockServerInfo);
      mockProvisioningReferencesRepository.update.mockResolvedValue(mockProvisioningReference);

      const result = await service.getServerInfo('client-uuid');

      expect(result).toEqual({
        serverId: 'server-123',
        serverName: 'test-server',
        publicIp: '1.2.3.4',
        privateIp: '10.0.0.1',
        serverStatus: 'running',
        providerType: 'hetzner',
      });

      expect(mockProvider.getServerInfo).toHaveBeenCalledWith('server-123');
      expect(mockProvisioningReferencesRepository.update).toHaveBeenCalledWith('ref-uuid', {
        publicIp: '1.2.3.4',
        privateIp: '10.0.0.1',
        serverName: 'test-server',
      });
    });

    it('should return stored information when provider is not available', async () => {
      mockProvisioningReferencesRepository.findByClientId.mockResolvedValue(mockProvisioningReference);
      mockPROVISIONING_PROVIDER_REGISTRY.hasProvider.mockReturnValue(false);

      const result = await service.getServerInfo('client-uuid');

      expect(result).toEqual({
        serverId: 'server-123',
        serverName: 'test-server',
        publicIp: '1.2.3.4',
        privateIp: '10.0.0.1',
        providerType: 'hetzner',
      });

      expect(mockProvider.getServerInfo).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when provisioning reference is not found', async () => {
      mockProvisioningReferencesRepository.findByClientId.mockResolvedValue(null);

      await expect(service.getServerInfo('client-uuid')).rejects.toThrow(NotFoundException);
      await expect(service.getServerInfo('client-uuid')).rejects.toThrow(
        'No provisioning reference found for client client-uuid',
      );
    });

    it('should handle server without private IP', async () => {
      const referenceWithoutPrivateIp = {
        ...mockProvisioningReference,
        privateIp: undefined,
      };
      const serverInfoWithoutPrivateIp = {
        ...mockServerInfo,
        privateIp: undefined,
      };

      mockProvisioningReferencesRepository.findByClientId.mockResolvedValue(referenceWithoutPrivateIp);
      mockPROVISIONING_PROVIDER_REGISTRY.hasProvider.mockReturnValue(true);
      mockPROVISIONING_PROVIDER_REGISTRY.getProvider.mockReturnValue(mockProvider);
      (mockProvider.getServerInfo as jest.Mock).mockResolvedValue(serverInfoWithoutPrivateIp);
      mockProvisioningReferencesRepository.update.mockResolvedValue(referenceWithoutPrivateIp);

      const result = await service.getServerInfo('client-uuid');

      expect(result.privateIp).toBeUndefined();
    });
  });
});
