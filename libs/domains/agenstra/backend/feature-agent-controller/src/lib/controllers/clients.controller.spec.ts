import {
  AgentResponseDto,
  ContainerType,
  CreateAgentDto,
  CreateAgentResponseDto,
  CreateEnvironmentVariableDto,
  CreateFileDto,
  EnvironmentVariableResponseDto,
  FileContentDto,
  FileNodeDto,
  MoveFileDto,
  UpdateAgentDto,
  UpdateEnvironmentVariableDto,
  WriteFileDto,
} from '@forepath/agenstra/backend/feature-agent-manager';
import {
  AddClientUserDto,
  AuthenticationType,
  ClientUserResponseDto,
  ClientUserRole,
  ClientUsersRepository,
  ClientUsersService,
  UserRole,
  WORKSPACE_MANAGEMENT_FORBIDDEN_MESSAGE,
} from '@forepath/identity/backend';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { ClientResponseDto } from '../dto/client-response.dto';
import { CreateClientResponseDto } from '../dto/create-client-response.dto';
import { CreateClientDto } from '../dto/create-client.dto';
import { ProvisionServerDto } from '../dto/provision-server.dto';
import { ProvisionedServerResponseDto } from '../dto/provisioned-server-response.dto';
import { UpdateClientDto } from '../dto/update-client.dto';
import { ProvisioningProviderFactory } from '../providers/provisioning-provider.factory';
import { ProvisioningProvider } from '../providers/provisioning-provider.interface';
import { ClientsRepository } from '../repositories/clients.repository';
import { ClientAgentEnvironmentVariablesProxyService } from '../services/client-agent-environment-variables-proxy.service';
import { ClientAgentFileSystemProxyService } from '../services/client-agent-file-system-proxy.service';
import { ClientAgentProxyService } from '../services/client-agent-proxy.service';
import { ClientsService } from '../services/clients.service';
import { ProvisioningService } from '../services/provisioning.service';

import { ClientsController } from './clients.controller';

describe('ClientsController', () => {
  let controller: ClientsController;
  let service: jest.Mocked<ClientsService>;
  let proxyService: jest.Mocked<ClientAgentProxyService>;
  let fileSystemProxyService: jest.Mocked<ClientAgentFileSystemProxyService>;
  let provisioningService: jest.Mocked<ProvisioningService>;
  let provisioningProviderFactory: jest.Mocked<ProvisioningProviderFactory>;
  let clientUsersService: jest.Mocked<ClientUsersService>;
  let clientsRepository: jest.Mocked<ClientsRepository>;
  let clientUsersRepository: jest.Mocked<ClientUsersRepository>;
  const mockClientResponse: ClientResponseDto = {
    id: 'test-uuid',
    name: 'Test Client',
    description: 'Test Description',
    endpoint: 'https://example.com/api',
    authenticationType: AuthenticationType.API_KEY,
    isAutoProvisioned: false,
    canManageWorkspaceConfiguration: true,
    config: {
      gitRepositoryUrl: 'https://github.com/user/repo.git',
      agentTypes: [{ type: 'cursor', displayName: 'Cursor' }],
    },
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };
  const mockCreateClientResponse: CreateClientResponseDto = {
    ...mockClientResponse,
    apiKey: 'generated-api-key-123',
  };
  const mockAgentResponse: AgentResponseDto = {
    id: 'agent-uuid',
    name: 'Test Agent',
    description: 'Test Agent Description',
    agentType: 'cursor',
    containerType: ContainerType.GENERIC,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };
  const mockCreateAgentResponse: CreateAgentResponseDto = {
    ...mockAgentResponse,
    password: 'generated-password-123',
  };
  const mockService = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };
  const mockProxyService = {
    getClientAgents: jest.fn(),
    listClientAgentModels: jest.fn(),
    getClientAgent: jest.fn(),
    createClientAgent: jest.fn(),
    updateClientAgent: jest.fn(),
    deleteClientAgent: jest.fn(),
    startClientAgent: jest.fn(),
    stopClientAgent: jest.fn(),
    restartClientAgent: jest.fn(),
    getClientConfig: jest.fn(),
  };
  const mockFileSystemProxyService = {
    readFile: jest.fn(),
    writeFile: jest.fn(),
    listDirectory: jest.fn(),
    createFileOrDirectory: jest.fn(),
    deleteFileOrDirectory: jest.fn(),
    moveFileOrDirectory: jest.fn(),
  };
  const mockEnvironmentVariablesProxyService = {
    getEnvironmentVariables: jest.fn(),
    countEnvironmentVariables: jest.fn(),
    createEnvironmentVariable: jest.fn(),
    updateEnvironmentVariable: jest.fn(),
    deleteEnvironmentVariable: jest.fn(),
    deleteAllEnvironmentVariables: jest.fn(),
  };
  const mockProvisioningService = {
    provisionServer: jest.fn(),
    deleteProvisionedServer: jest.fn(),
    getServerInfo: jest.fn(),
  };
  const mockProvisioningProviderFactory = {
    getAllProviders: jest.fn(),
    hasProvider: jest.fn(),
    getProvider: jest.fn(),
    getRegisteredTypes: jest.fn(),
  };
  const mockClientUsersService = {
    addUserToClient: jest.fn(),
    removeUserFromClient: jest.fn(),
    getClientUsers: jest.fn(),
  };
  const mockClientsRepository = {
    findById: jest.fn(),
    findByIdOrThrow: jest.fn(),
  };
  const mockClientUsersRepository = {
    findUserClientAccess: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ClientsController],
      providers: [
        {
          provide: ClientsService,
          useValue: mockService,
        },
        {
          provide: ClientAgentProxyService,
          useValue: mockProxyService,
        },
        {
          provide: ClientAgentFileSystemProxyService,
          useValue: mockFileSystemProxyService,
        },
        {
          provide: ClientAgentEnvironmentVariablesProxyService,
          useValue: mockEnvironmentVariablesProxyService,
        },
        {
          provide: ProvisioningService,
          useValue: mockProvisioningService,
        },
        {
          provide: ProvisioningProviderFactory,
          useValue: mockProvisioningProviderFactory,
        },
        {
          provide: ClientUsersService,
          useValue: mockClientUsersService,
        },
        {
          provide: ClientsRepository,
          useValue: mockClientsRepository,
        },
        {
          provide: ClientUsersRepository,
          useValue: mockClientUsersRepository,
        },
      ],
    }).compile();

    controller = module.get<ClientsController>(ClientsController);
    service = module.get(ClientsService);
    proxyService = module.get(ClientAgentProxyService);
    fileSystemProxyService = module.get(ClientAgentFileSystemProxyService);
    provisioningService = module.get(ProvisioningService);
    provisioningProviderFactory = module.get(ProvisioningProviderFactory);
    clientUsersService = module.get(ClientUsersService);
    clientsRepository = module.get(ClientsRepository);
    clientUsersRepository = module.get(ClientUsersRepository);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getClients', () => {
    it('should return array of clients', async () => {
      const clients = [mockClientResponse];
      const mockReq = { apiKeyAuthenticated: true } as any;

      service.findAll.mockResolvedValue(clients);

      const result = await controller.getClients(10, 0, mockReq);

      expect(result).toEqual(clients);
      expect(service.findAll).toHaveBeenCalledWith(10, 0, undefined, undefined, true);
    });

    it('should use default pagination values', async () => {
      const clients = [mockClientResponse];
      const mockReq = { apiKeyAuthenticated: true } as any;

      service.findAll.mockResolvedValue(clients);

      const result = await controller.getClients(undefined, undefined, mockReq);

      expect(result).toEqual(clients);
      expect(service.findAll).toHaveBeenCalledWith(10, 0, undefined, undefined, true);
    });
  });

  describe('getClient', () => {
    it('should return single client', async () => {
      const mockReq = { apiKeyAuthenticated: true } as any;

      service.findOne.mockResolvedValue(mockClientResponse);

      const result = await controller.getClient('test-uuid', mockReq);

      expect(result).toEqual(mockClientResponse);
      expect(service.findOne).toHaveBeenCalledWith('test-uuid', undefined, undefined, true);
    });
  });

  describe('createClient', () => {
    it('should create new client with auto-generated API key for API_KEY type', async () => {
      const createDto: CreateClientDto = {
        name: 'New Client',
        description: 'New Description',
        endpoint: 'https://example.com/api',
        authenticationType: AuthenticationType.API_KEY,
      };
      const mockReq = { apiKeyAuthenticated: true } as any;

      service.create.mockResolvedValue(mockCreateClientResponse);

      const result = await controller.createClient(createDto, mockReq);

      expect(result).toEqual(mockCreateClientResponse);
      expect(result.apiKey).toBeDefined();
      expect(service.create).toHaveBeenCalledWith(createDto, undefined, undefined, true);
    });

    it('should create new client with Keycloak credentials for KEYCLOAK type', async () => {
      const createDto: CreateClientDto = {
        name: 'New Client',
        endpoint: 'https://example.com/api',
        authenticationType: AuthenticationType.KEYCLOAK,
        keycloakClientId: 'keycloak-client-id',
        keycloakClientSecret: 'keycloak-client-secret',
        keycloakRealm: 'test-realm',
      };
      const responseWithoutApiKey: CreateClientResponseDto = {
        ...mockClientResponse,
        authenticationType: AuthenticationType.KEYCLOAK,
        apiKey: undefined,
      };
      const mockReq = { apiKeyAuthenticated: true } as any;

      service.create.mockResolvedValue(responseWithoutApiKey);

      const result = await controller.createClient(createDto, mockReq);

      expect(result).toEqual(responseWithoutApiKey);
      expect(result.apiKey).toBeUndefined();
      expect(service.create).toHaveBeenCalledWith(createDto, undefined, undefined, true);
    });
  });

  describe('updateClient', () => {
    it('should update client', async () => {
      const updateDto: UpdateClientDto = {
        name: 'Updated Client',
      };
      const mockReq = { apiKeyAuthenticated: true } as any;

      clientsRepository.findByIdOrThrow.mockResolvedValue({ id: 'test-uuid', userId: null } as any);
      clientUsersRepository.findUserClientAccess.mockResolvedValue(null);
      service.update.mockResolvedValue(mockClientResponse);

      const result = await controller.updateClient('test-uuid', updateDto, mockReq);

      expect(result).toEqual(mockClientResponse);
      expect(service.update).toHaveBeenCalledWith('test-uuid', updateDto, undefined, undefined, true);
    });
  });

  describe('deleteClient', () => {
    it('should delete client', async () => {
      const mockReq = { apiKeyAuthenticated: true } as any;

      provisioningService.deleteProvisionedServer.mockRejectedValue(
        new BadRequestException('No provisioning reference for client'),
      );
      service.remove.mockResolvedValue(undefined);

      await controller.deleteClient('test-uuid', mockReq);

      expect(provisioningService.deleteProvisionedServer).toHaveBeenCalledWith('test-uuid');
      expect(service.remove).toHaveBeenCalledWith('test-uuid', undefined, undefined, true);
    });
  });

  describe('getClientAgents', () => {
    it('should return array of agents for a client', async () => {
      const agents = [mockAgentResponse];
      const mockReq = { apiKeyAuthenticated: true } as any;

      clientsRepository.findById.mockResolvedValue({ id: 'client-uuid', userId: null } as any);
      clientUsersRepository.findUserClientAccess.mockResolvedValue(null);
      proxyService.getClientAgents.mockResolvedValue(agents);

      const result = await controller.getClientAgents('client-uuid', 10, 0, mockReq);

      expect(result).toEqual(agents);
      expect(proxyService.getClientAgents).toHaveBeenCalledWith('client-uuid', 10, 0);
    });

    it('should use default pagination values', async () => {
      const agents = [mockAgentResponse];
      const mockReq = { apiKeyAuthenticated: true } as any;

      clientsRepository.findById.mockResolvedValue({ id: 'client-uuid', userId: null } as any);
      clientUsersRepository.findUserClientAccess.mockResolvedValue(null);
      proxyService.getClientAgents.mockResolvedValue(agents);

      const result = await controller.getClientAgents('client-uuid', undefined, undefined, mockReq);

      expect(result).toEqual(agents);
      expect(proxyService.getClientAgents).toHaveBeenCalledWith('client-uuid', 10, 0);
    });
  });

  describe('getClientAgent', () => {
    it('should return single agent for a client', async () => {
      const mockReq = { apiKeyAuthenticated: true } as any;

      clientsRepository.findById.mockResolvedValue({ id: 'client-uuid', userId: null } as any);
      clientUsersRepository.findUserClientAccess.mockResolvedValue(null);
      proxyService.getClientAgent.mockResolvedValue(mockAgentResponse);

      const result = await controller.getClientAgent('client-uuid', 'agent-uuid', mockReq);

      expect(result).toEqual(mockAgentResponse);
      expect(proxyService.getClientAgent).toHaveBeenCalledWith('client-uuid', 'agent-uuid');
    });
  });

  describe('listClientAgentModels', () => {
    it('should return models map from proxy service', async () => {
      const models = { 'model-a': 'Model A' };
      const mockReq = { apiKeyAuthenticated: true } as any;

      clientsRepository.findById.mockResolvedValue({ id: 'client-uuid', userId: null } as any);
      clientUsersRepository.findUserClientAccess.mockResolvedValue(null);
      proxyService.listClientAgentModels.mockResolvedValue(models);

      const result = await controller.listClientAgentModels('client-uuid', 'agent-uuid', mockReq);

      expect(result).toEqual(models);
      expect(proxyService.listClientAgentModels).toHaveBeenCalledWith('client-uuid', 'agent-uuid');
    });
  });

  describe('createClientAgent', () => {
    it('should create new agent for a client', async () => {
      const createDto: CreateAgentDto = {
        name: 'New Agent',
        description: 'New Agent Description',
      };
      const mockReq = { apiKeyAuthenticated: true } as any;

      clientsRepository.findById.mockResolvedValue({ id: 'client-uuid', userId: null } as any);
      clientUsersRepository.findUserClientAccess.mockResolvedValue(null);
      proxyService.createClientAgent.mockResolvedValue(mockCreateAgentResponse);

      const result = await controller.createClientAgent('client-uuid', createDto, mockReq);

      expect(result).toEqual(mockCreateAgentResponse);
      expect(proxyService.createClientAgent).toHaveBeenCalledWith('client-uuid', createDto, undefined);
    });

    it('should reject when user is plain workspace member', async () => {
      const createDto: CreateAgentDto = { name: 'New Agent', description: 'd' };
      const mockReq = { apiKeyAuthenticated: false, user: { id: 'user-1', roles: ['user'] } } as any;

      clientsRepository.findById.mockResolvedValue({ id: 'client-uuid', userId: 'owner-id' } as any);
      clientUsersRepository.findUserClientAccess.mockResolvedValue({
        userId: 'user-1',
        clientId: 'client-uuid',
        role: ClientUserRole.USER,
      } as any);

      await expect(controller.createClientAgent('client-uuid', createDto, mockReq)).rejects.toMatchObject({
        response: { message: WORKSPACE_MANAGEMENT_FORBIDDEN_MESSAGE },
      });
      expect(proxyService.createClientAgent).not.toHaveBeenCalled();
    });
  });

  describe('updateClientAgent', () => {
    it('should update agent for a client', async () => {
      const updateDto: UpdateAgentDto = {
        name: 'Updated Agent',
      };
      const mockReq = { apiKeyAuthenticated: true } as any;

      clientsRepository.findById.mockResolvedValue({ id: 'client-uuid', userId: null } as any);
      clientUsersRepository.findUserClientAccess.mockResolvedValue(null);
      proxyService.updateClientAgent.mockResolvedValue(mockAgentResponse);

      const result = await controller.updateClientAgent('client-uuid', 'agent-uuid', updateDto, mockReq);

      expect(result).toEqual(mockAgentResponse);
      expect(proxyService.updateClientAgent).toHaveBeenCalledWith('client-uuid', 'agent-uuid', updateDto, undefined);
    });
  });

  describe('deleteClientAgent', () => {
    it('should delete agent for a client', async () => {
      const mockReq = { apiKeyAuthenticated: true } as any;

      clientsRepository.findById.mockResolvedValue({ id: 'client-uuid', userId: null } as any);
      clientUsersRepository.findUserClientAccess.mockResolvedValue(null);
      proxyService.deleteClientAgent.mockResolvedValue(undefined);

      await controller.deleteClientAgent('client-uuid', 'agent-uuid', mockReq);

      expect(proxyService.deleteClientAgent).toHaveBeenCalledWith('client-uuid', 'agent-uuid', undefined);
    });
  });

  describe('startClientAgent', () => {
    it('should start agent for a client and return agent response', async () => {
      const mockReq = { apiKeyAuthenticated: true } as any;

      clientsRepository.findById.mockResolvedValue({ id: 'client-uuid', userId: null } as any);
      clientUsersRepository.findUserClientAccess.mockResolvedValue(null);
      proxyService.startClientAgent.mockResolvedValue(mockAgentResponse);

      const result = await controller.startClientAgent('client-uuid', 'agent-uuid', mockReq);

      expect(result).toEqual(mockAgentResponse);
      expect(proxyService.startClientAgent).toHaveBeenCalledWith('client-uuid', 'agent-uuid');
    });
  });

  describe('stopClientAgent', () => {
    it('should stop agent for a client and return agent response', async () => {
      const mockReq = { apiKeyAuthenticated: true } as any;

      clientsRepository.findById.mockResolvedValue({ id: 'client-uuid', userId: null } as any);
      clientUsersRepository.findUserClientAccess.mockResolvedValue(null);
      proxyService.stopClientAgent.mockResolvedValue(mockAgentResponse);

      const result = await controller.stopClientAgent('client-uuid', 'agent-uuid', mockReq);

      expect(result).toEqual(mockAgentResponse);
      expect(proxyService.stopClientAgent).toHaveBeenCalledWith('client-uuid', 'agent-uuid');
    });
  });

  describe('restartClientAgent', () => {
    it('should restart agent for a client and return agent response', async () => {
      const mockReq = { apiKeyAuthenticated: true } as any;

      clientsRepository.findById.mockResolvedValue({ id: 'client-uuid', userId: null } as any);
      clientUsersRepository.findUserClientAccess.mockResolvedValue(null);
      proxyService.restartClientAgent.mockResolvedValue(mockAgentResponse);

      const result = await controller.restartClientAgent('client-uuid', 'agent-uuid', mockReq);

      expect(result).toEqual(mockAgentResponse);
      expect(proxyService.restartClientAgent).toHaveBeenCalledWith('client-uuid', 'agent-uuid');
    });
  });

  describe('readFile', () => {
    it('should proxy read file request', async () => {
      const mockFileContent: FileContentDto = {
        content: Buffer.from('Hello, World!', 'utf-8').toString('base64'),
        encoding: 'utf-8',
      };
      const mockReq = { apiKeyAuthenticated: true } as any;

      clientsRepository.findById.mockResolvedValue({ id: 'client-uuid', userId: null } as any);
      clientUsersRepository.findUserClientAccess.mockResolvedValue(null);
      fileSystemProxyService.readFile.mockResolvedValue(mockFileContent);

      const result = await controller.readFile('client-uuid', 'agent-uuid', 'test.txt', undefined, mockReq);

      expect(result).toEqual(mockFileContent);
      expect(fileSystemProxyService.readFile).toHaveBeenCalledWith('client-uuid', 'agent-uuid', 'test.txt', 'app');
    });

    it('should use workspace management access and forward config context', async () => {
      const mockFileContent: FileContentDto = {
        content: Buffer.from('{}', 'utf-8').toString('base64'),
        encoding: 'utf-8',
      };
      const mockReq = { apiKeyAuthenticated: true } as any;

      clientsRepository.findById.mockResolvedValue({ id: 'client-uuid', userId: null } as any);
      clientUsersRepository.findUserClientAccess.mockResolvedValue(null);
      fileSystemProxyService.readFile.mockResolvedValue(mockFileContent);

      await controller.readFile('client-uuid', 'agent-uuid', 'cfg.json', 'config', mockReq);

      expect(fileSystemProxyService.readFile).toHaveBeenCalledWith('client-uuid', 'agent-uuid', 'cfg.json', 'config');
    });

    it('should reject config context when user cannot manage workspace configuration', async () => {
      const mockReq = { apiKeyAuthenticated: false, user: { id: 'user-1', roles: ['user'] } } as any;

      clientsRepository.findById.mockResolvedValue({ id: 'client-uuid', userId: 'other-user' } as any);
      clientUsersRepository.findUserClientAccess.mockResolvedValue({
        id: 'rel-1',
        clientId: 'client-uuid',
        userId: 'user-1',
        role: ClientUserRole.USER,
      } as any);

      await expect(controller.readFile('client-uuid', 'agent-uuid', 'cfg.json', 'config', mockReq)).rejects.toThrow(
        WORKSPACE_MANAGEMENT_FORBIDDEN_MESSAGE,
      );
    });
  });

  describe('writeFile', () => {
    it('should proxy write file request', async () => {
      const writeDto: WriteFileDto = {
        content: Buffer.from('New content', 'utf-8').toString('base64'),
        encoding: 'utf-8',
      };
      const mockReq = { apiKeyAuthenticated: true } as any;

      clientsRepository.findById.mockResolvedValue({ id: 'client-uuid', userId: null } as any);
      clientUsersRepository.findUserClientAccess.mockResolvedValue(null);
      fileSystemProxyService.writeFile.mockResolvedValue(undefined);

      await controller.writeFile('client-uuid', 'agent-uuid', 'test.txt', writeDto, undefined, mockReq);

      expect(fileSystemProxyService.writeFile).toHaveBeenCalledWith(
        'client-uuid',
        'agent-uuid',
        'test.txt',
        writeDto,
        'app',
      );
    });
  });

  describe('listDirectory', () => {
    it('should proxy list directory request', async () => {
      const mockFileNodes: FileNodeDto[] = [
        {
          name: 'file1.txt',
          type: 'file',
          path: 'file1.txt',
          size: 1024,
          modifiedAt: new Date('2024-01-01'),
        },
      ];
      const mockReq = { apiKeyAuthenticated: true } as any;

      clientsRepository.findById.mockResolvedValue({ id: 'client-uuid', userId: null } as any);
      clientUsersRepository.findUserClientAccess.mockResolvedValue(null);
      fileSystemProxyService.listDirectory.mockResolvedValue(mockFileNodes);

      const result = await controller.listDirectory('client-uuid', 'agent-uuid', 'test-dir', undefined, mockReq);

      expect(result).toEqual(mockFileNodes);
      expect(fileSystemProxyService.listDirectory).toHaveBeenCalledWith('client-uuid', 'agent-uuid', 'test-dir', 'app');
    });

    it('should use default path when not provided', async () => {
      const mockFileNodes: FileNodeDto[] = [];
      const mockReq = { apiKeyAuthenticated: true } as any;

      clientsRepository.findById.mockResolvedValue({ id: 'client-uuid', userId: null } as any);
      clientUsersRepository.findUserClientAccess.mockResolvedValue(null);
      fileSystemProxyService.listDirectory.mockResolvedValue(mockFileNodes);

      await controller.listDirectory('client-uuid', 'agent-uuid', undefined, undefined, mockReq);

      expect(fileSystemProxyService.listDirectory).toHaveBeenCalledWith('client-uuid', 'agent-uuid', '.', 'app');
    });
  });

  describe('createFileOrDirectory', () => {
    it('should proxy create file request', async () => {
      const createDto: CreateFileDto = {
        type: 'file',
        content: Buffer.from('File content', 'utf-8').toString('base64'),
      };
      const mockReq = { apiKeyAuthenticated: true } as any;

      clientsRepository.findById.mockResolvedValue({ id: 'client-uuid', userId: null } as any);
      clientUsersRepository.findUserClientAccess.mockResolvedValue(null);
      fileSystemProxyService.createFileOrDirectory.mockResolvedValue(undefined);

      await controller.createFileOrDirectory(
        'client-uuid',
        'agent-uuid',
        'new-file.txt',
        createDto,
        undefined,
        mockReq,
      );

      expect(fileSystemProxyService.createFileOrDirectory).toHaveBeenCalledWith(
        'client-uuid',
        'agent-uuid',
        'new-file.txt',
        createDto,
        'app',
      );
    });

    it('should proxy create directory request', async () => {
      const createDto: CreateFileDto = {
        type: 'directory',
      };
      const mockReq = { apiKeyAuthenticated: true } as any;

      clientsRepository.findById.mockResolvedValue({ id: 'client-uuid', userId: null } as any);
      clientUsersRepository.findUserClientAccess.mockResolvedValue(null);
      fileSystemProxyService.createFileOrDirectory.mockResolvedValue(undefined);

      await controller.createFileOrDirectory('client-uuid', 'agent-uuid', 'new-dir', createDto, undefined, mockReq);

      expect(fileSystemProxyService.createFileOrDirectory).toHaveBeenCalledWith(
        'client-uuid',
        'agent-uuid',
        'new-dir',
        createDto,
        'app',
      );
    });

    it('should handle array path parameter', async () => {
      const createDto: CreateFileDto = {
        type: 'file',
        content: Buffer.from('File content', 'utf-8').toString('base64'),
      };
      const mockReq = { apiKeyAuthenticated: true } as any;

      clientsRepository.findById.mockResolvedValue({ id: 'client-uuid', userId: null } as any);
      clientUsersRepository.findUserClientAccess.mockResolvedValue(null);
      fileSystemProxyService.createFileOrDirectory.mockResolvedValue(undefined);

      await controller.createFileOrDirectory(
        'client-uuid',
        'agent-uuid',
        ['nested', 'path', 'file.txt'],
        createDto,
        undefined,
        mockReq,
      );

      expect(fileSystemProxyService.createFileOrDirectory).toHaveBeenCalledWith(
        'client-uuid',
        'agent-uuid',
        'nested/path/file.txt',
        createDto,
        'app',
      );
    });

    it('should throw BadRequestException when path is undefined', async () => {
      const createDto: CreateFileDto = {
        type: 'file',
        content: Buffer.from('File content', 'utf-8').toString('base64'),
      };
      const mockReq = { apiKeyAuthenticated: true } as any;

      clientsRepository.findById.mockResolvedValue({ id: 'client-uuid', userId: null } as any);
      clientUsersRepository.findUserClientAccess.mockResolvedValue(null);

      await expect(
        controller.createFileOrDirectory('client-uuid', 'agent-uuid', undefined, createDto, undefined, mockReq),
      ).rejects.toThrow('File path is required');
    });

    it('should throw BadRequestException when path is an object', async () => {
      const createDto: CreateFileDto = {
        type: 'file',
        content: Buffer.from('File content', 'utf-8').toString('base64'),
      };
      const mockReq = { apiKeyAuthenticated: true } as any;

      clientsRepository.findById.mockResolvedValue({ id: 'client-uuid', userId: null } as any);
      clientUsersRepository.findUserClientAccess.mockResolvedValue(null);

      await expect(
        controller.createFileOrDirectory(
          'client-uuid',
          'agent-uuid',
          { invalid: 'path' },
          createDto,
          undefined,
          mockReq,
        ),
      ).rejects.toThrow('File path must be a string or array, got object');
    });
  });

  describe('deleteFileOrDirectory', () => {
    it('should proxy delete file request', async () => {
      const mockReq = { apiKeyAuthenticated: true } as any;

      clientsRepository.findById.mockResolvedValue({ id: 'client-uuid', userId: null } as any);
      clientUsersRepository.findUserClientAccess.mockResolvedValue(null);
      fileSystemProxyService.deleteFileOrDirectory.mockResolvedValue(undefined);

      await controller.deleteFileOrDirectory('client-uuid', 'agent-uuid', 'file-to-delete.txt', undefined, mockReq);

      expect(fileSystemProxyService.deleteFileOrDirectory).toHaveBeenCalledWith(
        'client-uuid',
        'agent-uuid',
        'file-to-delete.txt',
        'app',
      );
    });
  });

  describe('moveFileOrDirectory', () => {
    it('should proxy move file request', async () => {
      const moveDto: MoveFileDto = {
        destination: 'new-location/file.txt',
      };
      const mockReq = { apiKeyAuthenticated: true } as any;

      clientsRepository.findById.mockResolvedValue({ id: 'client-uuid', userId: null } as any);
      clientUsersRepository.findUserClientAccess.mockResolvedValue(null);
      fileSystemProxyService.moveFileOrDirectory.mockResolvedValue(undefined);

      await controller.moveFileOrDirectory('client-uuid', 'agent-uuid', 'source-file.txt', moveDto, undefined, mockReq);

      expect(fileSystemProxyService.moveFileOrDirectory).toHaveBeenCalledWith(
        'client-uuid',
        'agent-uuid',
        'source-file.txt',
        moveDto,
        'app',
      );
    });

    it('should handle array path parameter', async () => {
      const moveDto: MoveFileDto = {
        destination: 'new-location/file.txt',
      };
      const mockReq = { apiKeyAuthenticated: true } as any;

      clientsRepository.findById.mockResolvedValue({ id: 'client-uuid', userId: null } as any);
      clientUsersRepository.findUserClientAccess.mockResolvedValue(null);
      fileSystemProxyService.moveFileOrDirectory.mockResolvedValue(undefined);

      await controller.moveFileOrDirectory(
        'client-uuid',
        'agent-uuid',
        ['nested', 'path', 'file.txt'],
        moveDto,
        undefined,
        mockReq,
      );

      expect(fileSystemProxyService.moveFileOrDirectory).toHaveBeenCalledWith(
        'client-uuid',
        'agent-uuid',
        'nested/path/file.txt',
        moveDto,
        'app',
      );
    });

    it('should throw BadRequestException when path is undefined', async () => {
      const moveDto: MoveFileDto = {
        destination: 'new-location/file.txt',
      };
      const mockReq = { apiKeyAuthenticated: true } as any;

      clientsRepository.findById.mockResolvedValue({ id: 'client-uuid', userId: null } as any);
      clientUsersRepository.findUserClientAccess.mockResolvedValue(null);

      await expect(
        controller.moveFileOrDirectory('client-uuid', 'agent-uuid', undefined, moveDto, undefined, mockReq),
      ).rejects.toThrow('File path is required');
    });

    it('should throw BadRequestException when path is an object', async () => {
      const moveDto: MoveFileDto = {
        destination: 'new-location/file.txt',
      };
      const mockReq = { apiKeyAuthenticated: true } as any;

      clientsRepository.findById.mockResolvedValue({ id: 'client-uuid', userId: null } as any);
      clientUsersRepository.findUserClientAccess.mockResolvedValue(null);

      await expect(
        controller.moveFileOrDirectory('client-uuid', 'agent-uuid', { invalid: 'path' }, moveDto, undefined, mockReq),
      ).rejects.toThrow('File path must be a string or array, got object');
    });

    it('should throw BadRequestException when destination is missing', async () => {
      const moveDto: MoveFileDto = {
        destination: '',
      };
      const mockReq = { apiKeyAuthenticated: true } as any;

      clientsRepository.findById.mockResolvedValue({ id: 'client-uuid', userId: null } as any);
      clientUsersRepository.findUserClientAccess.mockResolvedValue(null);

      await expect(
        controller.moveFileOrDirectory('client-uuid', 'agent-uuid', 'source.txt', moveDto, undefined, mockReq),
      ).rejects.toThrow('Destination path is required');
    });
  });

  describe('getProvisioningProviders', () => {
    it('should return array of provisioning providers', async () => {
      const mockProvider: ProvisioningProvider = {
        getType: jest.fn().mockReturnValue('hetzner'),
        getDisplayName: jest.fn().mockReturnValue('Hetzner Cloud'),
        getServerTypes: jest.fn(),
        getLocations: jest.fn(),
        provisionServer: jest.fn(),
        deleteServer: jest.fn(),
        getServerInfo: jest.fn(),
      };

      provisioningProviderFactory.getAllProviders.mockReturnValue([mockProvider]);

      const result = await controller.getProvisioningProviders();

      expect(result).toEqual([
        {
          type: 'hetzner',
          displayName: 'Hetzner Cloud',
        },
      ]);
      expect(provisioningProviderFactory.getAllProviders).toHaveBeenCalled();
    });
  });

  describe('getServerTypes', () => {
    it('should return server types for a provider', async () => {
      const mockServerTypes = [
        {
          id: 'cx11',
          name: 'CX11',
          cores: 1,
          memory: 2,
          disk: 20,
          priceMonthly: 3.29,
          priceHourly: 0.01,
        },
      ];
      const mockProvider: ProvisioningProvider = {
        getType: jest.fn().mockReturnValue('hetzner'),
        getDisplayName: jest.fn().mockReturnValue('Hetzner Cloud'),
        getServerTypes: jest.fn().mockResolvedValue(mockServerTypes),
        getLocations: jest.fn(),
        provisionServer: jest.fn(),
        deleteServer: jest.fn(),
        getServerInfo: jest.fn(),
      };

      provisioningProviderFactory.hasProvider.mockReturnValue(true);
      provisioningProviderFactory.getProvider.mockReturnValue(mockProvider);

      const result = await controller.getServerTypes('hetzner');

      expect(result).toEqual(mockServerTypes);
      expect(provisioningProviderFactory.hasProvider).toHaveBeenCalledWith('hetzner');
      expect(provisioningProviderFactory.getProvider).toHaveBeenCalledWith('hetzner');
      expect(mockProvider.getServerTypes).toHaveBeenCalled();
    });

    it('should throw BadRequestException when provider is not available', async () => {
      provisioningProviderFactory.hasProvider.mockReturnValue(false);
      provisioningProviderFactory.getRegisteredTypes.mockReturnValue(['hetzner']);

      await expect(controller.getServerTypes('invalid-provider')).rejects.toThrow(BadRequestException);
      expect(provisioningProviderFactory.hasProvider).toHaveBeenCalledWith('invalid-provider');
    });
  });

  describe('getLocations', () => {
    it('should return locations for a provider', async () => {
      const mockLocations = [{ id: 'fsn1', name: 'Falkenstein' }];
      const mockProvider: ProvisioningProvider = {
        getType: jest.fn().mockReturnValue('hetzner'),
        getDisplayName: jest.fn().mockReturnValue('Hetzner Cloud'),
        getServerTypes: jest.fn(),
        getLocations: jest.fn().mockResolvedValue(mockLocations),
        provisionServer: jest.fn(),
        deleteServer: jest.fn(),
        getServerInfo: jest.fn(),
      };

      provisioningProviderFactory.hasProvider.mockReturnValue(true);
      provisioningProviderFactory.getProvider.mockReturnValue(mockProvider);

      const result = await controller.getLocations('hetzner');

      expect(result).toEqual(mockLocations);
      expect(mockProvider.getLocations).toHaveBeenCalled();
    });

    it('should throw BadRequestException when provider is not available', async () => {
      provisioningProviderFactory.hasProvider.mockReturnValue(false);
      provisioningProviderFactory.getRegisteredTypes.mockReturnValue(['hetzner']);

      await expect(controller.getLocations('invalid-provider')).rejects.toThrow(BadRequestException);
    });
  });

  describe('provisionServer', () => {
    it('should provision a server and create a client', async () => {
      const provisionDto: ProvisionServerDto = {
        providerType: 'hetzner',
        serverType: 'cx11',
        name: 'test-server',
        description: 'Test server',
        location: 'fsn1',
        authenticationType: AuthenticationType.API_KEY,
        agentWsPort: 8080,
      };
      const mockResponse: ProvisionedServerResponseDto = {
        ...mockClientResponse,
        isAutoProvisioned: true,
        providerType: 'hetzner',
        serverId: 'server-123',
        serverName: 'test-server',
        publicIp: '1.2.3.4',
        privateIp: '10.0.0.1',
        serverStatus: 'running',
      };

      provisioningService.provisionServer.mockResolvedValue(mockResponse);

      const result = await controller.provisionServer(provisionDto);

      expect(result).toEqual(mockResponse);
      expect(provisioningService.provisionServer).toHaveBeenCalledWith(provisionDto, undefined, undefined, false);
    });
  });

  describe('getServerInfo', () => {
    it('should return server information for a provisioned client', async () => {
      const mockServerInfo = {
        serverId: 'server-123',
        serverName: 'test-server',
        publicIp: '1.2.3.4',
        privateIp: '10.0.0.1',
        serverStatus: 'running',
        providerType: 'hetzner',
      };
      const mockReq = { apiKeyAuthenticated: true } as any;

      clientsRepository.findById.mockResolvedValue({ id: 'client-uuid', userId: null } as any);
      clientUsersRepository.findUserClientAccess.mockResolvedValue(null);
      provisioningService.getServerInfo.mockResolvedValue(mockServerInfo);

      const result = await controller.getServerInfo('client-uuid', mockReq);

      expect(result).toEqual(mockServerInfo);
      expect(provisioningService.getServerInfo).toHaveBeenCalledWith('client-uuid');
    });
  });

  describe('deleteProvisionedServer', () => {
    it('should delete a provisioned server and its client', async () => {
      const mockReq = { apiKeyAuthenticated: true } as any;

      clientsRepository.findById.mockResolvedValue({ id: 'client-uuid', userId: null } as any);
      clientUsersRepository.findUserClientAccess.mockResolvedValue(null);
      provisioningService.deleteProvisionedServer.mockResolvedValue(undefined);

      await controller.deleteProvisionedServer('client-uuid', mockReq);

      expect(provisioningService.deleteProvisionedServer).toHaveBeenCalledWith('client-uuid', undefined);
    });
  });

  describe('Environment Variables Proxy', () => {
    const clientId = 'test-uuid';
    const agentId = 'agent-uuid';
    const envVarId = 'env-var-uuid';
    const mockEnvVar: EnvironmentVariableResponseDto = {
      id: envVarId,
      agentId,
      variable: 'API_KEY',
      content: 'secret-api-key-value',
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
    };

    describe('getClientAgentEnvironmentVariables', () => {
      it('should proxy get environment variables request', async () => {
        const mockReq = { apiKeyAuthenticated: true } as any;

        clientsRepository.findById.mockResolvedValue({ id: clientId, userId: null } as any);
        clientUsersRepository.findUserClientAccess.mockResolvedValue(null);
        mockEnvironmentVariablesProxyService.getEnvironmentVariables.mockResolvedValue([mockEnvVar]);

        const result = await controller.getClientAgentEnvironmentVariables(clientId, agentId, 50, 0, mockReq);

        expect(result).toEqual([mockEnvVar]);
        expect(mockEnvironmentVariablesProxyService.getEnvironmentVariables).toHaveBeenCalledWith(
          clientId,
          agentId,
          50,
          0,
        );
      });

      it('should use default pagination parameters', async () => {
        const mockReq = { apiKeyAuthenticated: true } as any;

        clientsRepository.findById.mockResolvedValue({ id: clientId, userId: null } as any);
        clientUsersRepository.findUserClientAccess.mockResolvedValue(null);
        mockEnvironmentVariablesProxyService.getEnvironmentVariables.mockResolvedValue([]);

        await controller.getClientAgentEnvironmentVariables(clientId, agentId, undefined, undefined, mockReq);

        expect(mockEnvironmentVariablesProxyService.getEnvironmentVariables).toHaveBeenCalledWith(
          clientId,
          agentId,
          50,
          0,
        );
      });
    });

    describe('countClientAgentEnvironmentVariables', () => {
      it('should proxy count environment variables request', async () => {
        const mockReq = { apiKeyAuthenticated: true } as any;

        clientsRepository.findById.mockResolvedValue({ id: clientId, userId: null } as any);
        clientUsersRepository.findUserClientAccess.mockResolvedValue(null);
        mockEnvironmentVariablesProxyService.countEnvironmentVariables.mockResolvedValue({ count: 5 });

        const result = await controller.countClientAgentEnvironmentVariables(clientId, agentId, mockReq);

        expect(result).toEqual({ count: 5 });
        expect(mockEnvironmentVariablesProxyService.countEnvironmentVariables).toHaveBeenCalledWith(clientId, agentId);
      });
    });

    describe('createClientAgentEnvironmentVariable', () => {
      it('should proxy create environment variable request', async () => {
        const createDto: CreateEnvironmentVariableDto = {
          variable: 'API_KEY',
          content: 'secret-api-key-value',
        };
        const mockReq = { apiKeyAuthenticated: true } as any;

        clientsRepository.findById.mockResolvedValue({ id: clientId, userId: null } as any);
        clientUsersRepository.findUserClientAccess.mockResolvedValue(null);
        mockEnvironmentVariablesProxyService.createEnvironmentVariable.mockResolvedValue(mockEnvVar);

        const result = await controller.createClientAgentEnvironmentVariable(clientId, agentId, createDto, mockReq);

        expect(result).toEqual(mockEnvVar);
        expect(mockEnvironmentVariablesProxyService.createEnvironmentVariable).toHaveBeenCalledWith(
          clientId,
          agentId,
          createDto,
        );
      });
    });

    describe('updateClientAgentEnvironmentVariable', () => {
      it('should proxy update environment variable request', async () => {
        const updateDto: UpdateEnvironmentVariableDto = {
          variable: 'UPDATED_API_KEY',
          content: 'updated-secret-value',
        };
        const mockReq = { apiKeyAuthenticated: true } as any;

        clientsRepository.findById.mockResolvedValue({ id: clientId, userId: null } as any);
        clientUsersRepository.findUserClientAccess.mockResolvedValue(null);

        const updatedEnvVar: EnvironmentVariableResponseDto = {
          ...mockEnvVar,
          variable: 'UPDATED_API_KEY',
          content: 'updated-secret-value',
        };

        mockEnvironmentVariablesProxyService.updateEnvironmentVariable.mockResolvedValue(updatedEnvVar);

        const result = await controller.updateClientAgentEnvironmentVariable(
          clientId,
          agentId,
          envVarId,
          updateDto,
          mockReq,
        );

        expect(result).toEqual(updatedEnvVar);
        expect(mockEnvironmentVariablesProxyService.updateEnvironmentVariable).toHaveBeenCalledWith(
          clientId,
          agentId,
          envVarId,
          updateDto,
        );
      });
    });

    describe('deleteClientAgentEnvironmentVariable', () => {
      it('should proxy delete environment variable request', async () => {
        const mockReq = { apiKeyAuthenticated: true } as any;

        clientsRepository.findById.mockResolvedValue({ id: clientId, userId: null } as any);
        clientUsersRepository.findUserClientAccess.mockResolvedValue(null);
        mockEnvironmentVariablesProxyService.deleteEnvironmentVariable.mockResolvedValue(undefined);

        await controller.deleteClientAgentEnvironmentVariable(clientId, agentId, envVarId, mockReq);

        expect(mockEnvironmentVariablesProxyService.deleteEnvironmentVariable).toHaveBeenCalledWith(
          clientId,
          agentId,
          envVarId,
        );
      });
    });

    describe('deleteAllClientAgentEnvironmentVariables', () => {
      it('should proxy delete all environment variables request', async () => {
        const mockReq = { apiKeyAuthenticated: true } as any;

        clientsRepository.findById.mockResolvedValue({ id: clientId, userId: null } as any);
        clientUsersRepository.findUserClientAccess.mockResolvedValue(null);
        mockEnvironmentVariablesProxyService.deleteAllEnvironmentVariables.mockResolvedValue({ deletedCount: 3 });

        const result = await controller.deleteAllClientAgentEnvironmentVariables(clientId, agentId, mockReq);

        expect(result).toEqual({ deletedCount: 3 });
        expect(mockEnvironmentVariablesProxyService.deleteAllEnvironmentVariables).toHaveBeenCalledWith(
          clientId,
          agentId,
        );
      });
    });
  });

  describe('Client User Management', () => {
    const clientId = 'client-uuid';
    const relationshipId = 'relationship-uuid';
    const mockClientUserResponse: ClientUserResponseDto = {
      id: relationshipId,
      userId: 'user-uuid',
      clientId: clientId,
      role: 'user' as ClientUserRole,
      userEmail: 'test@example.com',
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
    };

    describe('getClientUsers', () => {
      it('should return list of client users', async () => {
        const mockReq = { apiKeyAuthenticated: true } as any;

        clientsRepository.findById.mockResolvedValue({ id: clientId, userId: null } as any);
        clientUsersRepository.findUserClientAccess.mockResolvedValue(null);
        clientUsersService.getClientUsers.mockResolvedValue([mockClientUserResponse]);

        const result = await controller.getClientUsers(clientId, mockReq);

        expect(result).toEqual([mockClientUserResponse]);
        expect(clientUsersService.getClientUsers).toHaveBeenCalledWith(clientId);
      });

      it('should throw ForbiddenException when user does not have access', async () => {
        const mockReq = { apiKeyAuthenticated: false, user: { id: 'user-uuid', role: 'user' } } as any;

        clientsRepository.findById.mockResolvedValue({ id: clientId, userId: 'other-user-id' } as any);
        clientUsersRepository.findUserClientAccess.mockResolvedValue(null);

        await expect(controller.getClientUsers(clientId, mockReq)).rejects.toThrow(ForbiddenException);
        expect(clientUsersService.getClientUsers).not.toHaveBeenCalled();
      });
    });

    describe('addClientUser', () => {
      it('should add a user to a client', async () => {
        const addClientUserDto: AddClientUserDto = {
          email: 'newuser@example.com',
          role: 'user' as ClientUserRole,
        };
        const mockReq = { apiKeyAuthenticated: true } as any;

        clientsRepository.findById.mockResolvedValue({ id: clientId, userId: null } as any);
        clientsRepository.findByIdOrThrow.mockResolvedValue({ id: clientId, userId: null } as any);
        clientUsersRepository.findUserClientAccess.mockResolvedValue(null);
        clientUsersService.addUserToClient.mockResolvedValue(mockClientUserResponse);

        const result = await controller.addClientUser(clientId, addClientUserDto, mockReq);

        expect(result).toEqual(mockClientUserResponse);
        expect(clientUsersService.addUserToClient).toHaveBeenCalledWith(
          clientId,
          addClientUserDto,
          '',
          UserRole.USER,
          false,
          undefined,
        );
      });

      it('should throw ForbiddenException when user does not have access', async () => {
        const addClientUserDto: AddClientUserDto = {
          email: 'newuser@example.com',
          role: 'user' as ClientUserRole,
        };
        const mockReq = { apiKeyAuthenticated: false, user: { id: 'user-uuid', role: 'user' } } as any;

        clientsRepository.findById.mockResolvedValue({ id: clientId, userId: 'other-user-id' } as any);
        clientUsersRepository.findUserClientAccess.mockResolvedValue(null);

        await expect(controller.addClientUser(clientId, addClientUserDto, mockReq)).rejects.toThrow(ForbiddenException);
        expect(clientUsersService.addUserToClient).not.toHaveBeenCalled();
      });
    });

    describe('removeClientUser', () => {
      it('should remove a user from a client', async () => {
        const mockReq = { apiKeyAuthenticated: true } as any;

        clientsRepository.findById.mockResolvedValue({ id: clientId, userId: null } as any);
        clientsRepository.findByIdOrThrow.mockResolvedValue({ id: clientId, userId: null } as any);
        clientUsersRepository.findUserClientAccess.mockResolvedValue(null);
        clientUsersService.removeUserFromClient.mockResolvedValue(undefined);

        await controller.removeClientUser(clientId, relationshipId, mockReq);

        expect(clientUsersService.removeUserFromClient).toHaveBeenCalledWith(
          clientId,
          relationshipId,
          '',
          UserRole.USER,
          false,
          undefined,
        );
      });

      it('should throw ForbiddenException when user does not have access', async () => {
        const mockReq = { apiKeyAuthenticated: false, user: { id: 'user-uuid', role: 'user' } } as any;

        clientsRepository.findById.mockResolvedValue({ id: clientId, userId: 'other-user-id' } as any);
        clientUsersRepository.findUserClientAccess.mockResolvedValue(null);

        await expect(controller.removeClientUser(clientId, relationshipId, mockReq)).rejects.toThrow(
          ForbiddenException,
        );
        expect(clientUsersService.removeUserFromClient).not.toHaveBeenCalled();
      });
    });
  });
});
