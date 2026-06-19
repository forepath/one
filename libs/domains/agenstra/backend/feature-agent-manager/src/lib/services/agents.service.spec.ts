import { PasswordService } from '@forepath/identity/backend';
import { BadRequestException, Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as sshpk from 'sshpk';

import { GitRepositorySetupMode } from '../constants/git-repository-setup-mode';
import { CreateAgentDto } from '../dto/create-agent.dto';
import { UpdateAgentDto } from '../dto/update-agent.dto';
import { AgentEntity, ContainerType } from '../entities/agent.entity';
import {
  AGENT_PROVIDER_REGISTRY,
  AgentProvider,
  AgentProviderModels,
  ProviderRegistry,
} from '@forepath/agenstra/backend/util-plugin-host';
import { AgentsRepository } from '../repositories/agents.repository';

import { AgentsService } from './agents.service';
import { DeploymentsService } from './deployments.service';
import { DockerService } from './docker.service';

describe('AgentsService', () => {
  let service: AgentsService;
  let repository: jest.Mocked<AgentsRepository>;
  let passwordService: jest.Mocked<PasswordService>;
  let dockerService: jest.Mocked<DockerService>;
  let agentProviderRegistry: jest.Mocked<ProviderRegistry<AgentProvider>>;
  let deploymentsService: jest.Mocked<DeploymentsService>;
  const mockAgent: AgentEntity = {
    id: 'test-uuid',
    name: 'Test Agent',
    description: 'Test Description',
    hashedPassword: 'hashed-password',
    containerId: 'container-id-123',
    volumePath: '/opt/agents/test-volume-uuid',
    agentType: 'cursor',
    containerType: ContainerType.GENERIC,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };
  const mockRepository = {
    findByIdOrThrow: jest.fn(),
    findById: jest.fn(),
    findByName: jest.fn(),
    findAll: jest.fn(),
    findPortInUse: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  const mockPasswordService = {
    hashPassword: jest.fn(),
    verifyPassword: jest.fn(),
  };
  const mockDockerService = {
    createContainer: jest.fn(),
    deleteContainer: jest.fn(),
    createNetwork: jest.fn(),
    deleteNetwork: jest.fn(),
    sendCommandToContainer: jest.fn(),
    getContainerHomeDirectory: jest.fn().mockResolvedValue('/home/agenstra'),
    ensureImageExists: jest.fn().mockResolvedValue(undefined),
    startContainer: jest.fn(),
    stopContainer: jest.fn(),
    restartContainer: jest.fn(),
  };
  const mockAgentProvider: jest.Mocked<AgentProvider> = {
    getType: jest.fn().mockReturnValue('cursor'),
    getDisplayName: jest.fn().mockReturnValue('Cursor'),
    getCapabilities: jest.fn().mockReturnValue({
      supportsChat: true,
      supportsStreaming: false,
      supportsToolEvents: false,
      supportsQuestions: false,
    }),
    getDockerImage: jest.fn().mockReturnValue('ghcr.io/forepath/agenstra-manager-worker:latest'),
    getVirtualWorkspaceDockerImage: jest.fn().mockReturnValue('ghcr.io/forepath/agenstra-manager-vnc:latest'),
    getSshConnectionDockerImage: jest.fn().mockReturnValue('ghcr.io/forepath/agenstra-manager-ssh:latest'),
    sendMessage: jest.fn(),
    sendInitialization: jest.fn(),
    toParseableStrings: jest.fn(),
    toUnifiedResponse: jest.fn(),
    getModelsListCommand: jest.fn().mockReturnValue('cursor-agent --list-models'),
    toModelsList: jest.fn().mockReturnValue({}),
    getBasePath: jest.fn().mockReturnValue('/app'),
    getConfigBasePath: jest.fn().mockReturnValue('~/.cursor'),
  };
  const mockAgentProviderRegistry = {
    getProvider: jest.fn().mockReturnValue(mockAgentProvider),
    register: jest.fn(),
    hasProvider: jest.fn(),
    getRegisteredIds: jest.fn(),
    getAll: jest.fn(),
  } as unknown as jest.Mocked<ProviderRegistry<AgentProvider>>;
  const mockDeploymentsService = {
    upsertConfiguration: jest.fn(),
    deleteConfiguration: jest.fn(),
    getConfiguration: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentsService,
        {
          provide: AgentsRepository,
          useValue: mockRepository,
        },
        {
          provide: PasswordService,
          useValue: mockPasswordService,
        },
        {
          provide: DockerService,
          useValue: mockDockerService,
        },
        {
          provide: AGENT_PROVIDER_REGISTRY,
          useValue: mockAgentProviderRegistry,
        },
        {
          provide: DeploymentsService,
          useValue: mockDeploymentsService,
        },
      ],
    }).compile();

    service = module.get<AgentsService>(AgentsService);
    repository = module.get(AgentsRepository);
    passwordService = module.get(PasswordService);
    dockerService = module.get(DockerService);
    agentProviderRegistry = module.get(AGENT_PROVIDER_REGISTRY);
    deploymentsService = module.get(DeploymentsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    // Reset environment variables
    delete process.env.GIT_USERNAME;
    delete process.env.GIT_TOKEN;
    delete process.env.GIT_PASSWORD;
    delete process.env.GIT_REPOSITORY_URL;
    delete process.env.GIT_REPOSITORY_SETUP_MODE;
    delete process.env.GIT_PRIVATE_KEY;
    delete process.env.CURSOR_API_KEY;
  });

  describe('create', () => {
    beforeEach(() => {
      // Set up required environment variables for git operations
      process.env.GIT_USERNAME = 'testuser';
      process.env.GIT_TOKEN = 'test-token-123';
      process.env.GIT_REPOSITORY_URL = 'https://github.com/user/repo.git';
      process.env.GIT_REPOSITORY_URL = 'https://github.com/user/repo.git';
    });

    afterEach(() => {
      // Tests may delete optional provider methods; restore defaults for isolation
      mockAgentProvider.getBasePath = jest.fn().mockReturnValue('/app');
      mockAgentProvider.getConfigBasePath = jest.fn().mockReturnValue('~/.cursor');
      delete (mockAgentProvider as { getRepositoryPath?: () => string }).getRepositoryPath;
    });

    it('should create new agent with auto-generated password and container', async () => {
      const createDto: CreateAgentDto = {
        name: 'New Agent',
        description: 'New Description',
        containerType: ContainerType.GENERIC,
      };
      const hashedPassword = 'hashed-password';
      const containerId = 'container-id-123';
      const volumePath = '/opt/agents/test-volume-uuid';
      const createdAgent = {
        ...mockAgent,
        name: createDto.name,
        description: createDto.description,
        hashedPassword,
        containerId,
        volumePath,
      };

      // Disable VNC for this test
      mockAgentProvider.getVirtualWorkspaceDockerImage.mockReturnValueOnce(undefined);
      mockAgentProvider.getSshConnectionDockerImage.mockReturnValueOnce(undefined);
      mockRepository.findByName.mockResolvedValue(null);
      passwordService.hashPassword.mockResolvedValue(hashedPassword);
      dockerService.createContainer.mockResolvedValue(containerId);
      dockerService.sendCommandToContainer.mockResolvedValue(undefined);
      repository.create.mockResolvedValue(createdAgent);

      const result = await service.create(createDto);

      expect(result.id).toBe(mockAgent.id);
      expect(result.name).toBe(createDto.name);
      expect(result.description).toBe(createDto.description);
      expect(result.password).toBeDefined();
      expect(result.password.length).toBeGreaterThan(0);
      expect(typeof result.password).toBe('string');
      expect(repository.findByName).toHaveBeenCalledWith(createDto.name);
      expect(passwordService.hashPassword).toHaveBeenCalled();
      expect(agentProviderRegistry.getProvider).toHaveBeenCalledWith('cursor');
      expect(mockAgentProvider.getDockerImage).toHaveBeenCalled();
      expect(dockerService.ensureImageExists).toHaveBeenCalledTimes(1);
      expect(dockerService.ensureImageExists).toHaveBeenCalledWith('ghcr.io/forepath/agenstra-manager-worker:latest');
      expect(dockerService.createContainer).toHaveBeenNthCalledWith(1, {
        image: 'ghcr.io/forepath/agenstra-manager-worker:latest',
        env: expect.objectContaining({
          AGENT_NAME: createDto.name,
          CURSOR_API_KEY: process.env.CURSOR_API_KEY,
          GIT_REPOSITORY_URL: process.env.GIT_REPOSITORY_URL,
          GIT_USERNAME: process.env.GIT_USERNAME,
          GIT_TOKEN: process.env.GIT_TOKEN,
          GIT_PASSWORD: process.env.GIT_PASSWORD,
          GIT_PRIVATE_KEY: process.env.GIT_PRIVATE_KEY,
        }),
        volumes: [
          {
            hostPath: expect.stringMatching(/^\/opt\/agents\/[a-f0-9-]+$/),
            containerPath: '/app',
            readOnly: false,
          },
          {
            hostPath: '/opt/agents',
            containerPath: '/opt/workspace',
            readOnly: true,
          },
        ],
      });
      // Verify .netrc file creation commands were called (2 commands: base64 write + chmod), then config dir, chown, then git clone
      expect(dockerService.sendCommandToContainer).toHaveBeenCalledTimes(5); // 2 for .netrc + config mkdir + config chown + git clone
      expect(dockerService.sendCommandToContainer).toHaveBeenNthCalledWith(
        1,
        containerId,
        expect.stringMatching(/sh -c "base64 -d > '\/home\/agenstra\/\.netrc'"/),
        expect.any(String), // base64 content
      );
      expect(dockerService.sendCommandToContainer).toHaveBeenNthCalledWith(
        2,
        containerId,
        "chmod 600 '/home/agenstra/.netrc'",
      );
      expect(dockerService.sendCommandToContainer).toHaveBeenNthCalledWith(
        3,
        containerId,
        `sh -c "mkdir -p -- '/home/agenstra/.cursor'"`,
        undefined,
        true,
      );
      expect(dockerService.sendCommandToContainer).toHaveBeenNthCalledWith(
        4,
        containerId,
        `sh -c "sudo chown -R agenstra:agenstra -- '/home/agenstra/.cursor'"`,
        undefined,
        true,
      );
      expect(dockerService.getContainerHomeDirectory).toHaveBeenCalledWith(containerId);
      expect(dockerService.sendCommandToContainer).toHaveBeenNthCalledWith(
        5,
        containerId,
        expect.stringMatching(/sh -c "git clone '[^']+' '\/app'"/),
      );
      expect(repository.create).toHaveBeenCalledWith({
        name: createDto.name,
        description: createDto.description,
        hashedPassword,
        containerId,
        volumePath: expect.stringMatching(/^\/opt\/agents\/[a-f0-9-]+$/),
        agentType: 'cursor',
        containerType: ContainerType.GENERIC,
        gitRepositoryUrl: undefined,
      });
    });

    it('should mount agent workspace at /home/agenstra/environment on VNC container', async () => {
      const createDto: CreateAgentDto = {
        name: 'VNC Agent',
        createVirtualWorkspace: true,
        createSshConnection: false,
        containerType: ContainerType.GENERIC,
      };
      const hashedPassword = 'hashed-password';
      const workerContainerId = 'worker-container-id';
      const vncContainerId = 'vnc-container-id';
      const createdAgent = {
        ...mockAgent,
        name: createDto.name,
        hashedPassword,
        containerId: workerContainerId,
        volumePath: '/opt/agents/test-volume-uuid',
        vncContainerId,
        vncHostPort: 50000,
        vncNetworkId: 'network-id',
        vncPassword: 'vnc-password',
      };

      repository.findByName.mockResolvedValue(null);
      repository.findPortInUse.mockResolvedValue(null);
      passwordService.hashPassword.mockResolvedValue(hashedPassword);
      dockerService.createContainer.mockResolvedValueOnce(workerContainerId).mockResolvedValueOnce(vncContainerId);
      dockerService.sendCommandToContainer.mockResolvedValue(undefined);
      dockerService.createNetwork.mockResolvedValue('network-id');
      repository.create.mockResolvedValue(createdAgent);

      await service.create(createDto);

      expect(dockerService.ensureImageExists).toHaveBeenCalledTimes(2);
      expect(dockerService.ensureImageExists).toHaveBeenNthCalledWith(
        1,
        'ghcr.io/forepath/agenstra-manager-worker:latest',
      );
      expect(dockerService.ensureImageExists).toHaveBeenNthCalledWith(
        2,
        'ghcr.io/forepath/agenstra-manager-vnc:latest',
      );
      expect(dockerService.createContainer).toHaveBeenCalledTimes(2);
      expect(dockerService.createContainer).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          image: 'ghcr.io/forepath/agenstra-manager-vnc:latest',
          env: expect.objectContaining({
            AGENT_NAME: createDto.name,
            VNC_PASSWORD: expect.any(String),
          }),
          volumes: [
            {
              hostPath: expect.stringMatching(/^\/opt\/agents\/[a-f0-9-]+$/),
              containerPath: '/home/agenstra/environment',
              readOnly: false,
            },
            {
              hostPath: '/opt/agents',
              containerPath: '/opt/workspace',
              readOnly: true,
            },
          ],
          ports: [
            {
              containerPort: 6080,
              hostPort: expect.any(Number),
            },
          ],
        }),
      );
      expect(dockerService.createNetwork).toHaveBeenCalledWith(
        expect.objectContaining({
          containerIds: [workerContainerId, vncContainerId],
        }),
      );
    });

    it('should ensure docker images exist before creating SSH connection container', async () => {
      const createDto: CreateAgentDto = {
        name: 'SSH Agent',
        createSshConnection: true,
        createVirtualWorkspace: false,
        containerType: ContainerType.GENERIC,
      };
      const hashedPassword = 'hashed-password';
      const workerContainerId = 'worker-container-id';
      const sshContainerId = 'ssh-container-id';
      const createdAgent = {
        ...mockAgent,
        name: createDto.name,
        hashedPassword,
        containerId: workerContainerId,
        volumePath: '/opt/agents/test-volume-uuid',
        sshContainerId,
        sshHostPort: 40000,
        sshPassword: 'ssh-password',
      };

      mockAgentProvider.getVirtualWorkspaceDockerImage.mockReturnValueOnce(undefined);
      mockRepository.findByName.mockResolvedValue(null);
      mockRepository.findPortInUse.mockResolvedValue(null);
      passwordService.hashPassword.mockResolvedValue(hashedPassword);
      dockerService.createContainer.mockResolvedValueOnce(workerContainerId).mockResolvedValueOnce(sshContainerId);
      dockerService.sendCommandToContainer.mockResolvedValue(undefined);
      repository.create.mockResolvedValue(createdAgent);

      await service.create(createDto);

      expect(dockerService.ensureImageExists).toHaveBeenCalledTimes(2);
      expect(dockerService.ensureImageExists).toHaveBeenNthCalledWith(
        1,
        'ghcr.io/forepath/agenstra-manager-worker:latest',
      );
      expect(dockerService.ensureImageExists).toHaveBeenNthCalledWith(
        2,
        'ghcr.io/forepath/agenstra-manager-ssh:latest',
      );
      expect(dockerService.createContainer).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          image: 'ghcr.io/forepath/agenstra-manager-ssh:latest',
          env: expect.objectContaining({
            AGENT_NAME: createDto.name,
            SSH_PASSWORD: expect.any(String),
          }),
          ports: [
            {
              containerPort: 22,
              hostPort: expect.any(Number),
            },
          ],
        }),
      );
    });

    it('should create agent without description', async () => {
      const createDto: CreateAgentDto = {
        name: 'New Agent',
        containerType: ContainerType.GENERIC,
      };
      const hashedPassword = 'hashed-password';
      const containerId = 'container-id-123';
      const volumePath = '/opt/agents/test-volume-uuid';
      const createdAgent: AgentEntity = {
        id: mockAgent.id,
        name: createDto.name,
        hashedPassword,
        containerId,
        volumePath,
        agentType: 'cursor',
        containerType: ContainerType.GENERIC,
        createdAt: mockAgent.createdAt,
        updatedAt: mockAgent.updatedAt,
      };

      // Disable VNC for this test
      mockAgentProvider.getVirtualWorkspaceDockerImage.mockReturnValueOnce(undefined);
      mockAgentProvider.getSshConnectionDockerImage.mockReturnValueOnce(undefined);
      mockRepository.findByName.mockResolvedValue(null);
      passwordService.hashPassword.mockResolvedValue(hashedPassword);
      dockerService.createContainer.mockResolvedValue(containerId);
      dockerService.sendCommandToContainer.mockResolvedValue(undefined);
      repository.create.mockResolvedValue(createdAgent);

      const result = await service.create(createDto);

      expect(result.name).toBe(createDto.name);
      expect(result.description).toBeUndefined();
      expect(agentProviderRegistry.getProvider).toHaveBeenCalledWith('cursor');
      expect(mockAgentProvider.getDockerImage).toHaveBeenCalled();
      expect(dockerService.createContainer).toHaveBeenNthCalledWith(1, {
        image: 'ghcr.io/forepath/agenstra-manager-worker:latest',
        env: expect.objectContaining({
          AGENT_NAME: createDto.name,
          CURSOR_API_KEY: process.env.CURSOR_API_KEY,
          GIT_REPOSITORY_URL: process.env.GIT_REPOSITORY_URL,
          GIT_USERNAME: process.env.GIT_USERNAME,
          GIT_TOKEN: process.env.GIT_TOKEN,
          GIT_PASSWORD: process.env.GIT_PASSWORD,
          GIT_PRIVATE_KEY: process.env.GIT_PRIVATE_KEY,
        }),
        volumes: [
          {
            hostPath: expect.stringMatching(/^\/opt\/agents\/[a-f0-9-]+$/),
            containerPath: '/app',
            readOnly: false,
          },
          {
            hostPath: '/opt/agents',
            containerPath: '/opt/workspace',
            readOnly: true,
          },
        ],
      });
      // Verify .netrc file creation was called
      expect(dockerService.sendCommandToContainer).toHaveBeenCalledTimes(5); // 2 for .netrc + config mkdir + config chown + git clone
      expect(repository.create).toHaveBeenCalledWith({
        name: createDto.name,
        description: undefined,
        agentType: 'cursor',
        containerType: ContainerType.GENERIC,
        hashedPassword,
        containerId,
        volumePath: expect.stringMatching(/^\/opt\/agents\/[a-f0-9-]+$/),
        gitRepositoryUrl: undefined,
      });
    });

    it('should throw BadRequestException when git credentials are missing', async () => {
      const createDto: CreateAgentDto = {
        name: 'New Agent',
      };

      // Clear git credentials but set repository URL (for HTTPS repo)
      delete process.env.GIT_USERNAME;
      delete process.env.GIT_TOKEN;
      delete process.env.GIT_PASSWORD;
      process.env.GIT_REPOSITORY_URL = 'https://github.com/user/repo.git';

      mockRepository.findByName.mockResolvedValue(null);
      passwordService.hashPassword.mockResolvedValue('hashed-password');
      dockerService.createContainer.mockResolvedValue('container-id-123');

      await expect(service.create(createDto)).rejects.toThrow(BadRequestException);
      await expect(service.create(createDto)).rejects.toThrow(
        'Git credentials not configured. Please set GIT_USERNAME, GIT_TOKEN (or GIT_PASSWORD), and provide a repositoryUrl in the createNetrcFile.',
      );
    });

    it('should throw BadRequestException when GIT_USERNAME is missing', async () => {
      const createDto: CreateAgentDto = {
        name: 'New Agent',
      };

      delete process.env.GIT_USERNAME;
      process.env.GIT_TOKEN = 'test-token';
      process.env.GIT_REPOSITORY_URL = 'https://github.com/user/repo.git';

      mockRepository.findByName.mockResolvedValue(null);
      passwordService.hashPassword.mockResolvedValue('hashed-password');
      dockerService.createContainer.mockResolvedValue('container-id-123');

      await expect(service.create(createDto)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when GIT_TOKEN and GIT_PASSWORD are missing', async () => {
      const createDto: CreateAgentDto = {
        name: 'New Agent',
      };

      process.env.GIT_USERNAME = 'testuser';
      delete process.env.GIT_TOKEN;
      delete process.env.GIT_PASSWORD;
      process.env.GIT_REPOSITORY_URL = 'https://github.com/user/repo.git';

      mockRepository.findByName.mockResolvedValue(null);
      passwordService.hashPassword.mockResolvedValue('hashed-password');
      dockerService.createContainer.mockResolvedValue('container-id-123');

      await expect(service.create(createDto)).rejects.toThrow(BadRequestException);
    });

    it('should use GIT_PASSWORD when GIT_TOKEN is not available', async () => {
      const createDto: CreateAgentDto = {
        name: 'New Agent',
      };
      const hashedPassword = 'hashed-password';
      const containerId = 'container-id-123';
      const createdAgent = {
        ...mockAgent,
        name: createDto.name,
        hashedPassword,
        containerId,
      };

      process.env.GIT_USERNAME = 'testuser';
      delete process.env.GIT_TOKEN;
      process.env.GIT_PASSWORD = 'test-password';
      process.env.GIT_REPOSITORY_URL = 'https://github.com/user/repo.git';
      process.env.GIT_REPOSITORY_URL = 'https://github.com/user/repo.git';

      mockRepository.findByName.mockResolvedValue(null);
      passwordService.hashPassword.mockResolvedValue(hashedPassword);
      dockerService.createContainer.mockResolvedValue(containerId);
      dockerService.sendCommandToContainer.mockResolvedValue(undefined);
      repository.create.mockResolvedValue(createdAgent);

      await service.create(createDto);

      // Verify .netrc creation was called (should use GIT_PASSWORD)
      expect(dockerService.sendCommandToContainer).toHaveBeenCalledTimes(5); // 2 for .netrc + config mkdir + config chown + git clone
    });

    it('should throw BadRequestException when agent name already exists', async () => {
      const createDto: CreateAgentDto = {
        name: 'Existing Agent',
      };

      mockRepository.findByName.mockResolvedValue(mockAgent);

      await expect(service.create(createDto)).rejects.toThrow(BadRequestException);
    });

    it('should clean up container when createNetrcFile fails', async () => {
      const createDto: CreateAgentDto = {
        name: 'New Agent',
      };
      const containerId = 'container-id-123';

      mockRepository.findByName.mockResolvedValue(null);
      passwordService.hashPassword.mockResolvedValue('hashed-password');
      dockerService.createContainer.mockResolvedValue(containerId);
      // Set repository URL but clear git credentials to cause createNetrcFile to fail
      process.env.GIT_REPOSITORY_URL = 'https://github.com/user/repo.git';
      delete process.env.GIT_USERNAME;
      delete process.env.GIT_TOKEN;
      delete process.env.GIT_PASSWORD;
      dockerService.deleteContainer.mockResolvedValue(undefined);

      await expect(service.create(createDto)).rejects.toThrow(BadRequestException);

      // Verify container was created
      expect(dockerService.createContainer).toHaveBeenCalled();
      // Verify container cleanup was attempted
      expect(dockerService.deleteContainer).toHaveBeenCalledWith(containerId);
      // Verify repository.create was never called
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('should clean up container when git clone fails', async () => {
      const createDto: CreateAgentDto = {
        name: 'New Agent',
      };
      const containerId = 'container-id-123';
      const gitCloneError = new Error('Git clone failed');

      mockRepository.findByName.mockResolvedValue(null);
      passwordService.hashPassword.mockResolvedValue('hashed-password');
      dockerService.createContainer.mockResolvedValue(containerId);
      dockerService.sendCommandToContainer
        .mockResolvedValueOnce(undefined) // First call for .netrc base64 write succeeds
        .mockResolvedValueOnce(undefined) // Second call for chmod succeeds
        .mockResolvedValueOnce(undefined) // mkdir provider config dir
        .mockResolvedValueOnce(undefined) // chown provider config dir
        .mockRejectedValueOnce(gitCloneError); // Git clone fails
      dockerService.deleteContainer.mockResolvedValue(undefined);

      await expect(service.create(createDto)).rejects.toThrow('Git clone failed');

      // Verify container was created
      expect(dockerService.createContainer).toHaveBeenCalled();
      // Verify .netrc creation (2 commands), config mkdir, config chown, and git clone (1 attempt) were called
      expect(dockerService.sendCommandToContainer).toHaveBeenCalledTimes(5);
      // Verify container cleanup was attempted
      expect(dockerService.deleteContainer).toHaveBeenCalledWith(containerId);
      // Verify repository.create was never called
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('should clean up container when repository.create fails', async () => {
      const createDto: CreateAgentDto = {
        name: 'New Agent',
      };
      const containerId = 'container-id-123';
      const repositoryError = new Error('Database error');

      mockRepository.findByName.mockResolvedValue(null);
      passwordService.hashPassword.mockResolvedValue('hashed-password');
      dockerService.createContainer.mockResolvedValue(containerId);
      dockerService.sendCommandToContainer.mockResolvedValue(undefined);
      repository.create.mockRejectedValue(repositoryError);
      dockerService.deleteContainer.mockResolvedValue(undefined);

      await expect(service.create(createDto)).rejects.toThrow('Database error');

      // Verify container was created
      expect(dockerService.createContainer).toHaveBeenCalled();
      // Verify .netrc creation (2 commands), config mkdir, config chown, and git clone (1 command) were attempted
      expect(dockerService.sendCommandToContainer).toHaveBeenCalledTimes(5);
      // Verify repository.create was attempted
      expect(repository.create).toHaveBeenCalled();
      // Verify container cleanup was attempted
      expect(dockerService.deleteContainer).toHaveBeenCalledWith(containerId);
    });

    it('should still throw original error if container cleanup fails', async () => {
      const createDto: CreateAgentDto = {
        name: 'New Agent',
      };
      const containerId = 'container-id-123';
      const originalError = new Error('Git clone failed');
      const cleanupError = new Error('Cleanup failed');

      mockRepository.findByName.mockResolvedValue(null);
      passwordService.hashPassword.mockResolvedValue('hashed-password');
      dockerService.createContainer.mockResolvedValue(containerId);
      dockerService.sendCommandToContainer
        .mockResolvedValueOnce(undefined) // First call for .netrc base64 write succeeds
        .mockResolvedValueOnce(undefined) // Second call for chmod succeeds
        .mockResolvedValueOnce(undefined) // mkdir provider config dir
        .mockResolvedValueOnce(undefined) // chown provider config dir
        .mockRejectedValueOnce(originalError); // Git clone fails
      dockerService.deleteContainer.mockRejectedValue(cleanupError);

      // Should throw the original error, not the cleanup error
      await expect(service.create(createDto)).rejects.toThrow('Git clone failed');

      // Verify cleanup was attempted
      expect(dockerService.deleteContainer).toHaveBeenCalledWith(containerId);
    });

    it('should create agent with SSH repository using provided private key', async () => {
      const createDto: CreateAgentDto = {
        name: 'SSH Agent',
        description: 'SSH Description',
      };
      const hashedPassword = 'hashed-password';
      const containerId = 'container-id-123';
      const volumePath = '/opt/agents/test-volume-uuid';
      const createdAgent = {
        ...mockAgent,
        name: createDto.name,
        description: createDto.description,
        hashedPassword,
        containerId,
        volumePath,
      };
      // Generate a test SSH key using sshpk (Ed25519 is supported for generation)
      const key = sshpk.generatePrivateKey('ed25519');
      const privateKeyPem = key.toString('openssh');

      process.env.GIT_REPOSITORY_URL = 'git@github.com:user/repo.git';
      process.env.GIT_PRIVATE_KEY = privateKeyPem;

      // Disable VNC for this test
      mockAgentProvider.getVirtualWorkspaceDockerImage.mockReturnValueOnce(undefined);
      mockAgentProvider.getSshConnectionDockerImage.mockReturnValueOnce(undefined);
      mockRepository.findByName.mockResolvedValue(null);
      passwordService.hashPassword.mockResolvedValue(hashedPassword);
      dockerService.createContainer.mockResolvedValue(containerId);
      dockerService.sendCommandToContainer.mockResolvedValue(undefined);
      repository.create.mockResolvedValue(createdAgent);

      const result = await service.create(createDto);

      expect(result.id).toBe(mockAgent.id);
      expect(result.name).toBe(createDto.name);
      expect(result.description).toBe(createDto.description);
      expect(result.password).toBeDefined();
      expect(agentProviderRegistry.getProvider).toHaveBeenCalledWith('cursor');
      expect(mockAgentProvider.getDockerImage).toHaveBeenCalled();
      expect(dockerService.createContainer).toHaveBeenNthCalledWith(1, {
        image: 'ghcr.io/forepath/agenstra-manager-worker:latest',
        env: expect.objectContaining({
          AGENT_NAME: createDto.name,
          CURSOR_API_KEY: process.env.CURSOR_API_KEY,
          GIT_REPOSITORY_URL: process.env.GIT_REPOSITORY_URL,
          GIT_USERNAME: process.env.GIT_USERNAME,
          GIT_TOKEN: process.env.GIT_TOKEN,
          GIT_PASSWORD: process.env.GIT_PASSWORD,
          GIT_PRIVATE_KEY: process.env.GIT_PRIVATE_KEY,
        }),
        volumes: [
          {
            hostPath: expect.stringMatching(/^\/opt\/agents\/[a-f0-9-]+$/),
            containerPath: '/app',
            readOnly: false,
          },
          {
            hostPath: '/opt/agents',
            containerPath: '/opt/workspace',
            readOnly: true,
          },
        ],
      });
      // Verify SSH setup commands, provider config mkdir, config chown, then git clone
      expect(dockerService.sendCommandToContainer).toHaveBeenCalledTimes(9);
      expect(dockerService.sendCommandToContainer).toHaveBeenNthCalledWith(
        1,
        containerId,
        "mkdir -p '/home/agenstra/.ssh'",
      );
      expect(dockerService.sendCommandToContainer).toHaveBeenNthCalledWith(
        2,
        containerId,
        "chmod 700 '/home/agenstra/.ssh'",
      );
      expect(dockerService.sendCommandToContainer).toHaveBeenNthCalledWith(
        3,
        containerId,
        expect.stringMatching(/echo .* \| base64 -d > \/home\/agenstra\/\.ssh\/id_ed25519/),
      );
      expect(dockerService.sendCommandToContainer).toHaveBeenNthCalledWith(
        4,
        containerId,
        "chmod 600 '/home/agenstra/.ssh/id_ed25519'",
      );
      expect(dockerService.sendCommandToContainer).toHaveBeenNthCalledWith(
        5,
        containerId,
        expect.stringMatching(/ssh-keyscan.*github\.com.*>> '\/home\/agenstra\/\.ssh\/known_hosts'/),
      );
      expect(dockerService.sendCommandToContainer).toHaveBeenNthCalledWith(
        6,
        containerId,
        "chmod 600 '/home/agenstra/.ssh/known_hosts' || true",
      );
      expect(dockerService.sendCommandToContainer).toHaveBeenNthCalledWith(
        7,
        containerId,
        `sh -c "mkdir -p -- '/home/agenstra/.cursor'"`,
        undefined,
        true,
      );
      expect(dockerService.sendCommandToContainer).toHaveBeenNthCalledWith(
        8,
        containerId,
        `sh -c "sudo chown -R agenstra:agenstra -- '/home/agenstra/.cursor'"`,
        undefined,
        true,
      );
      expect(dockerService.sendCommandToContainer).toHaveBeenNthCalledWith(
        9,
        containerId,
        expect.stringMatching(/sh -c "git clone .*git@github\.com:user\/repo\.git.*'\/app'"/),
      );
      expect(repository.create).toHaveBeenCalled();
    });

    it('should create agent with SSH repository using getRepositoryPath', async () => {
      const createDto: CreateAgentDto = {
        name: 'SSH Agent',
        description: 'SSH Description',
      };
      const hashedPassword = 'hashed-password';
      const containerId = 'container-id-123';
      const volumePath = '/opt/agents/test-volume-uuid';
      const createdAgent = {
        ...mockAgent,
        name: createDto.name,
        description: createDto.description,
        hashedPassword,
        containerId,
        volumePath,
      };
      // Generate a test SSH key using sshpk (Ed25519 is supported for generation)
      const key = sshpk.generatePrivateKey('ed25519');
      const privateKeyPem = key.toString('openssh');

      process.env.GIT_REPOSITORY_URL = 'git@github.com:user/repo.git';
      process.env.GIT_PRIVATE_KEY = privateKeyPem;

      const basePath = '/app';
      const repositoryPath = '/workspace';

      mockAgentProvider.getBasePath = jest.fn().mockReturnValue(basePath);
      mockAgentProvider.getRepositoryPath = jest.fn().mockReturnValue(repositoryPath);
      mockAgentProvider.getVirtualWorkspaceDockerImage.mockReturnValueOnce(undefined);
      mockAgentProvider.getSshConnectionDockerImage.mockReturnValueOnce(undefined);
      mockRepository.findByName.mockResolvedValue(null);
      passwordService.hashPassword.mockResolvedValue(hashedPassword);
      dockerService.createContainer.mockResolvedValue(containerId);
      dockerService.sendCommandToContainer.mockResolvedValue(undefined);
      repository.create.mockResolvedValue(createdAgent);

      await service.create(createDto);

      expect(mockAgentProvider.getBasePath).toHaveBeenCalled();
      expect(mockAgentProvider.getRepositoryPath).toHaveBeenCalled();
      // Verify git clone uses basePath + repositoryPath for SSH repository
      const expectedPath = basePath + repositoryPath;

      expect(dockerService.sendCommandToContainer).toHaveBeenNthCalledWith(
        9,
        containerId,
        expect.stringMatching(
          new RegExp(`sh -c "git clone .*git@github\\.com:user/repo\\.git.*'${expectedPath.replace(/'/g, "'\\''")}'"`),
        ),
      );
    });

    it('should throw BadRequestException when SSH repository URL is missing private key', async () => {
      const createDto: CreateAgentDto = {
        name: 'SSH Agent',
      };

      process.env.GIT_REPOSITORY_URL = 'git@github.com:user/repo.git';
      delete process.env.GIT_PRIVATE_KEY;

      mockRepository.findByName.mockResolvedValue(null);
      passwordService.hashPassword.mockResolvedValue('hashed-password');
      dockerService.createContainer.mockResolvedValue('container-id-123');

      await expect(service.create(createDto)).rejects.toThrow(BadRequestException);
      await expect(service.create(createDto)).rejects.toThrow(
        'Invalid SSH private key. Ensure it is in PEM or OpenSSH format without a passphrase.',
      );
    });

    it('should throw BadRequestException when SSH private key is invalid', async () => {
      const createDto: CreateAgentDto = {
        name: 'SSH Agent',
      };

      process.env.GIT_REPOSITORY_URL = 'git@github.com:user/repo.git';
      process.env.GIT_PRIVATE_KEY = 'invalid-key-content';

      mockRepository.findByName.mockResolvedValue(null);
      passwordService.hashPassword.mockResolvedValue('hashed-password');
      dockerService.createContainer.mockResolvedValue('container-id-123');

      await expect(service.create(createDto)).rejects.toThrow(BadRequestException);
      await expect(service.create(createDto)).rejects.toThrow(
        'Invalid SSH private key. Ensure it is in PEM or OpenSSH format without a passphrase.',
      );
    });

    it('should throw BadRequestException when GIT_REPOSITORY_URL is missing', async () => {
      const createDto: CreateAgentDto = {
        name: 'New Agent',
      };

      delete process.env.GIT_REPOSITORY_URL;

      mockRepository.findByName.mockResolvedValue(null);
      passwordService.hashPassword.mockResolvedValue('hashed-password');

      await expect(service.create(createDto)).rejects.toThrow(BadRequestException);
      await expect(service.create(createDto)).rejects.toThrow(
        'Git repository URL not configured. Please set GIT_REPOSITORY_URL or provide a gitRepositoryUrl in the createAgentDto.',
      );
    });

    it('should initialize empty repository with git init when mode is empty', async () => {
      delete process.env.GIT_REPOSITORY_URL;
      delete process.env.GIT_REPOSITORY_SETUP_MODE;

      const createDto: CreateAgentDto = {
        name: 'Empty Agent',
        gitRepositorySetupMode: GitRepositorySetupMode.EMPTY,
        createVirtualWorkspace: false,
        createSshConnection: false,
      };
      const hashedPassword = 'hashed-password';
      const containerId = 'container-id-empty';
      const createdAgent = {
        ...mockAgent,
        name: createDto.name,
        hashedPassword,
        containerId,
        gitRepositorySetupMode: GitRepositorySetupMode.EMPTY,
      };

      mockAgentProvider.getVirtualWorkspaceDockerImage.mockReturnValueOnce(undefined);
      mockAgentProvider.getSshConnectionDockerImage.mockReturnValueOnce(undefined);
      mockRepository.findByName.mockResolvedValue(null);
      passwordService.hashPassword.mockResolvedValue(hashedPassword);
      dockerService.createContainer.mockResolvedValue(containerId);
      dockerService.sendCommandToContainer.mockResolvedValue(undefined);
      repository.create.mockResolvedValue(createdAgent);

      const result = await service.create(createDto);

      expect(result.git).toEqual({ setupMode: GitRepositorySetupMode.EMPTY });
      expect(dockerService.createContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          env: expect.objectContaining({
            GIT_REPOSITORY_SETUP_MODE: GitRepositorySetupMode.EMPTY,
          }),
        }),
      );
      expect(dockerService.createContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          env: expect.not.objectContaining({
            GIT_REPOSITORY_URL: expect.anything(),
          }),
        }),
      );
      expect(dockerService.sendCommandToContainer).toHaveBeenCalledWith(
        containerId,
        expect.stringMatching(/sh -c "git init -- '\/app'"/),
      );
      expect(dockerService.sendCommandToContainer).not.toHaveBeenCalledWith(
        containerId,
        expect.stringMatching(/git clone/),
      );
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          gitRepositorySetupMode: GitRepositorySetupMode.EMPTY,
          gitRepositoryUrl: undefined,
        }),
      );
    });

    it('should throw BadRequestException when gitRepositoryUrl is set in empty mode', async () => {
      const createDto: CreateAgentDto = {
        name: 'Invalid Empty Agent',
        gitRepositorySetupMode: GitRepositorySetupMode.EMPTY,
        gitRepositoryUrl: 'https://github.com/user/repo.git',
      };

      mockRepository.findByName.mockResolvedValue(null);
      passwordService.hashPassword.mockResolvedValue('hashed-password');

      await expect(service.create(createDto)).rejects.toThrow(BadRequestException);
      await expect(service.create(createDto)).rejects.toThrow(
        'Git repository URL must not be set when git repository setup mode is empty',
      );
    });

    it('should use GIT_REPOSITORY_SETUP_MODE env default for empty repository', async () => {
      delete process.env.GIT_REPOSITORY_URL;
      process.env.GIT_REPOSITORY_SETUP_MODE = GitRepositorySetupMode.EMPTY;

      const createDto: CreateAgentDto = {
        name: 'Empty Agent Env Default',
        createVirtualWorkspace: false,
        createSshConnection: false,
      };

      mockAgentProvider.getVirtualWorkspaceDockerImage.mockReturnValueOnce(undefined);
      mockAgentProvider.getSshConnectionDockerImage.mockReturnValueOnce(undefined);
      mockRepository.findByName.mockResolvedValue(null);
      passwordService.hashPassword.mockResolvedValue('hashed-password');
      dockerService.createContainer.mockResolvedValue('container-id-empty-env');
      dockerService.sendCommandToContainer.mockResolvedValue(undefined);
      repository.create.mockResolvedValue({
        ...mockAgent,
        name: createDto.name,
        gitRepositorySetupMode: GitRepositorySetupMode.EMPTY,
      });

      await service.create(createDto);

      expect(dockerService.sendCommandToContainer).toHaveBeenCalledWith(
        'container-id-empty-env',
        expect.stringMatching(/git init/),
      );
      expect(dockerService.sendCommandToContainer).not.toHaveBeenCalledWith(
        'container-id-empty-env',
        expect.stringMatching(/git clone/),
      );
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          gitRepositorySetupMode: GitRepositorySetupMode.EMPTY,
        }),
      );
    });

    it('should clean up container when git init fails', async () => {
      const createDto: CreateAgentDto = {
        name: 'Empty Agent Failure',
        gitRepositorySetupMode: GitRepositorySetupMode.EMPTY,
        createVirtualWorkspace: false,
        createSshConnection: false,
      };
      const containerId = 'container-id-init-fail';

      mockAgentProvider.getVirtualWorkspaceDockerImage.mockReturnValueOnce(undefined);
      mockAgentProvider.getSshConnectionDockerImage.mockReturnValueOnce(undefined);
      mockRepository.findByName.mockResolvedValue(null);
      passwordService.hashPassword.mockResolvedValue('hashed-password');
      dockerService.createContainer.mockResolvedValue(containerId);
      dockerService.sendCommandToContainer
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('Git init failed'));
      dockerService.deleteContainer.mockResolvedValue(undefined);

      await expect(service.create(createDto)).rejects.toThrow('Git init failed');
      expect(dockerService.deleteContainer).toHaveBeenCalledWith(containerId);
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('should clean up container when SSH configuration fails', async () => {
      const createDto: CreateAgentDto = {
        name: 'SSH Agent',
      };
      const containerId = 'container-id-123';

      process.env.GIT_REPOSITORY_URL = 'git@github.com:user/repo.git';
      delete process.env.GIT_PRIVATE_KEY;

      mockRepository.findByName.mockResolvedValue(null);
      passwordService.hashPassword.mockResolvedValue('hashed-password');
      dockerService.createContainer.mockResolvedValue(containerId);
      dockerService.deleteContainer.mockResolvedValue(undefined);

      await expect(service.create(createDto)).rejects.toThrow(BadRequestException);

      expect(dockerService.createContainer).toHaveBeenCalled();
      expect(dockerService.deleteContainer).toHaveBeenCalledWith(containerId);
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('should create agent with deployment configuration', async () => {
      const createDto: CreateAgentDto = {
        name: 'New Agent',
        description: 'New Description',
        containerType: ContainerType.GENERIC,
        deploymentConfiguration: {
          providerType: 'github',
          repositoryId: 'owner/repo',
          defaultBranch: 'main',
          workflowId: 'workflow.yml',
          providerToken: 'ghp_token123',
        },
      };
      const hashedPassword = 'hashed-password';
      const containerId = 'container-id-123';
      const volumePath = '/opt/agents/test-volume-uuid';
      const createdAgent = {
        ...mockAgent,
        name: createDto.name,
        description: createDto.description,
        hashedPassword,
        containerId,
        volumePath,
      };

      mockAgentProvider.getVirtualWorkspaceDockerImage.mockReturnValueOnce(undefined);
      mockAgentProvider.getSshConnectionDockerImage.mockReturnValueOnce(undefined);
      mockRepository.findByName.mockResolvedValue(null);
      passwordService.hashPassword.mockResolvedValue(hashedPassword);
      dockerService.createContainer.mockResolvedValue(containerId);
      dockerService.sendCommandToContainer.mockResolvedValue(undefined);
      repository.create.mockResolvedValue(createdAgent);
      deploymentsService.upsertConfiguration.mockResolvedValue({
        id: 'config-uuid',
        agentId: createdAgent.id,
        providerType: 'github',
        repositoryId: 'owner/repo',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.create(createDto);

      expect(result.id).toBe(mockAgent.id);
      expect(deploymentsService.upsertConfiguration).toHaveBeenCalledWith(createdAgent.id, {
        providerType: 'github',
        repositoryId: 'owner/repo',
        defaultBranch: 'main',
        workflowId: 'workflow.yml',
        providerToken: 'ghp_token123',
        providerBaseUrl: undefined,
      });
    });

    it('should use provider base path when getBasePath is defined', async () => {
      const createDto: CreateAgentDto = {
        name: 'New Agent',
        description: 'New Description',
        containerType: ContainerType.GENERIC,
      };
      const hashedPassword = 'hashed-password';
      const containerId = 'container-id-123';
      const volumePath = '/opt/agents/test-volume-uuid';
      const createdAgent = {
        ...mockAgent,
        name: createDto.name,
        description: createDto.description,
        hashedPassword,
        containerId,
        volumePath,
      };
      const customBasePath = '/custom/path';

      mockAgentProvider.getBasePath = jest.fn().mockReturnValue(customBasePath);
      // Remove getRepositoryPath to ensure it's not defined from previous tests
      delete (mockAgentProvider as { getRepositoryPath?: () => string }).getRepositoryPath;
      mockAgentProvider.getVirtualWorkspaceDockerImage.mockReturnValueOnce(undefined);
      mockAgentProvider.getSshConnectionDockerImage.mockReturnValueOnce(undefined);
      mockRepository.findByName.mockResolvedValue(null);
      passwordService.hashPassword.mockResolvedValue(hashedPassword);
      dockerService.createContainer.mockResolvedValue(containerId);
      dockerService.sendCommandToContainer.mockResolvedValue(undefined);
      repository.create.mockResolvedValue(createdAgent);

      await service.create(createDto);

      expect(mockAgentProvider.getBasePath).toHaveBeenCalled();
      expect(dockerService.createContainer).toHaveBeenNthCalledWith(1, {
        image: 'ghcr.io/forepath/agenstra-manager-worker:latest',
        env: expect.objectContaining({
          AGENT_NAME: createDto.name,
          CURSOR_API_KEY: process.env.CURSOR_API_KEY,
          GIT_REPOSITORY_URL: process.env.GIT_REPOSITORY_URL,
          GIT_USERNAME: process.env.GIT_USERNAME,
          GIT_TOKEN: process.env.GIT_TOKEN,
          GIT_PASSWORD: process.env.GIT_PASSWORD,
          GIT_PRIVATE_KEY: process.env.GIT_PRIVATE_KEY,
        }),
        volumes: [
          {
            hostPath: expect.stringMatching(/^\/opt\/agents\/[a-f0-9-]+$/),
            containerPath: customBasePath,
            readOnly: false,
          },
          {
            hostPath: '/opt/agents',
            containerPath: '/opt/workspace',
            readOnly: true,
          },
        ],
      });
      // Verify git clone uses the custom base path (escaped for shell)
      // Since getRepositoryPath is not defined, it should use just basePath
      expect(dockerService.sendCommandToContainer).toHaveBeenNthCalledWith(
        5,
        containerId,
        expect.stringMatching(new RegExp(`sh -c "git clone '[^']+' '${customBasePath.replace(/'/g, "'\\''")}'"`)),
      );
    });

    it('should use provider repository path when getRepositoryPath is defined', async () => {
      const createDto: CreateAgentDto = {
        name: 'New Agent',
        description: 'New Description',
        containerType: ContainerType.GENERIC,
      };
      const hashedPassword = 'hashed-password';
      const containerId = 'container-id-123';
      const volumePath = '/opt/agents/test-volume-uuid';
      const createdAgent = {
        ...mockAgent,
        name: createDto.name,
        description: createDto.description,
        hashedPassword,
        containerId,
        volumePath,
      };
      const basePath = '/app';
      const repositoryPath = '/repository';

      mockAgentProvider.getBasePath = jest.fn().mockReturnValue(basePath);
      mockAgentProvider.getRepositoryPath = jest.fn().mockReturnValue(repositoryPath);
      mockAgentProvider.getVirtualWorkspaceDockerImage.mockReturnValueOnce(undefined);
      mockAgentProvider.getSshConnectionDockerImage.mockReturnValueOnce(undefined);
      mockRepository.findByName.mockResolvedValue(null);
      passwordService.hashPassword.mockResolvedValue(hashedPassword);
      dockerService.createContainer.mockResolvedValue(containerId);
      dockerService.sendCommandToContainer.mockResolvedValue(undefined);
      repository.create.mockResolvedValue(createdAgent);

      await service.create(createDto);

      expect(mockAgentProvider.getBasePath).toHaveBeenCalled();
      expect(mockAgentProvider.getRepositoryPath).toHaveBeenCalled();
      // Verify git clone uses basePath + repositoryPath
      const expectedPath = basePath + repositoryPath;

      expect(dockerService.sendCommandToContainer).toHaveBeenNthCalledWith(
        5,
        containerId,
        expect.stringMatching(new RegExp(`sh -c "git clone '[^']+' '${expectedPath.replace(/'/g, "'\\''")}'"`)),
      );
    });

    it('should combine custom base path and repository path when both are defined', async () => {
      const createDto: CreateAgentDto = {
        name: 'New Agent',
        description: 'New Description',
        containerType: ContainerType.GENERIC,
      };
      const hashedPassword = 'hashed-password';
      const containerId = 'container-id-123';
      const volumePath = '/opt/agents/test-volume-uuid';
      const createdAgent = {
        ...mockAgent,
        name: createDto.name,
        description: createDto.description,
        hashedPassword,
        containerId,
        volumePath,
      };
      const customBasePath = '/custom/base';
      const repositoryPath = '/repo';

      mockAgentProvider.getBasePath = jest.fn().mockReturnValue(customBasePath);
      mockAgentProvider.getRepositoryPath = jest.fn().mockReturnValue(repositoryPath);
      mockAgentProvider.getVirtualWorkspaceDockerImage.mockReturnValueOnce(undefined);
      mockAgentProvider.getSshConnectionDockerImage.mockReturnValueOnce(undefined);
      mockRepository.findByName.mockResolvedValue(null);
      passwordService.hashPassword.mockResolvedValue(hashedPassword);
      dockerService.createContainer.mockResolvedValue(containerId);
      dockerService.sendCommandToContainer.mockResolvedValue(undefined);
      repository.create.mockResolvedValue(createdAgent);

      await service.create(createDto);

      expect(mockAgentProvider.getBasePath).toHaveBeenCalled();
      expect(mockAgentProvider.getRepositoryPath).toHaveBeenCalled();
      // Verify volume mount uses custom base path
      expect(dockerService.createContainer).toHaveBeenNthCalledWith(1, {
        image: 'ghcr.io/forepath/agenstra-manager-worker:latest',
        env: expect.objectContaining({
          AGENT_NAME: createDto.name,
          CURSOR_API_KEY: process.env.CURSOR_API_KEY,
          GIT_REPOSITORY_URL: process.env.GIT_REPOSITORY_URL,
          GIT_USERNAME: process.env.GIT_USERNAME,
          GIT_TOKEN: process.env.GIT_TOKEN,
          GIT_PASSWORD: process.env.GIT_PASSWORD,
          GIT_PRIVATE_KEY: process.env.GIT_PRIVATE_KEY,
        }),
        volumes: [
          {
            hostPath: expect.stringMatching(/^\/opt\/agents\/[a-f0-9-]+$/),
            containerPath: customBasePath,
            readOnly: false,
          },
          {
            hostPath: '/opt/agents',
            containerPath: '/opt/workspace',
            readOnly: true,
          },
        ],
      });
      // Verify git clone uses basePath + repositoryPath
      const expectedPath = customBasePath + repositoryPath;

      expect(dockerService.sendCommandToContainer).toHaveBeenNthCalledWith(
        5,
        containerId,
        expect.stringMatching(new RegExp(`sh -c "git clone '[^']+' '${expectedPath.replace(/'/g, "'\\''")}'"`)),
      );
    });

    it('should use only base path when getRepositoryPath is not defined', async () => {
      const createDto: CreateAgentDto = {
        name: 'New Agent',
        description: 'New Description',
        containerType: ContainerType.GENERIC,
      };
      const hashedPassword = 'hashed-password';
      const containerId = 'container-id-123';
      const volumePath = '/opt/agents/test-volume-uuid';
      const createdAgent = {
        ...mockAgent,
        name: createDto.name,
        description: createDto.description,
        hashedPassword,
        containerId,
        volumePath,
      };
      const customBasePath = '/custom/path';

      mockAgentProvider.getBasePath = jest.fn().mockReturnValue(customBasePath);
      // Remove getRepositoryPath to simulate provider without the method
      delete (mockAgentProvider as { getRepositoryPath?: () => string }).getRepositoryPath;
      mockAgentProvider.getVirtualWorkspaceDockerImage.mockReturnValueOnce(undefined);
      mockAgentProvider.getSshConnectionDockerImage.mockReturnValueOnce(undefined);
      mockRepository.findByName.mockResolvedValue(null);
      passwordService.hashPassword.mockResolvedValue(hashedPassword);
      dockerService.createContainer.mockResolvedValue(containerId);
      dockerService.sendCommandToContainer.mockResolvedValue(undefined);
      repository.create.mockResolvedValue(createdAgent);

      await service.create(createDto);

      expect(mockAgentProvider.getBasePath).toHaveBeenCalled();
      // Verify git clone uses only basePath when getRepositoryPath is not defined
      expect(dockerService.sendCommandToContainer).toHaveBeenNthCalledWith(
        5,
        containerId,
        expect.stringMatching(new RegExp(`sh -c "git clone '[^']+' '${customBasePath.replace(/'/g, "'\\''")}'"`)),
      );
    });

    it('should fall back to /app when getBasePath is not defined', async () => {
      const createDto: CreateAgentDto = {
        name: 'New Agent',
        description: 'New Description',
        containerType: ContainerType.GENERIC,
      };
      const hashedPassword = 'hashed-password';
      const containerId = 'container-id-123';
      const volumePath = '/opt/agents/test-volume-uuid';
      const createdAgent = {
        ...mockAgent,
        name: createDto.name,
        description: createDto.description,
        hashedPassword,
        containerId,
        volumePath,
      };

      // Remove getBasePath from mock provider to simulate provider without the method
      delete (mockAgentProvider as { getBasePath?: () => string }).getBasePath;
      // Also remove getRepositoryPath to ensure it's not defined from previous tests
      delete (mockAgentProvider as { getRepositoryPath?: () => string }).getRepositoryPath;
      mockAgentProvider.getVirtualWorkspaceDockerImage.mockReturnValueOnce(undefined);
      mockAgentProvider.getSshConnectionDockerImage.mockReturnValueOnce(undefined);
      mockRepository.findByName.mockResolvedValue(null);
      passwordService.hashPassword.mockResolvedValue(hashedPassword);
      dockerService.createContainer.mockResolvedValue(containerId);
      dockerService.sendCommandToContainer.mockResolvedValue(undefined);
      repository.create.mockResolvedValue(createdAgent);

      await service.create(createDto);

      expect(dockerService.createContainer).toHaveBeenNthCalledWith(1, {
        image: 'ghcr.io/forepath/agenstra-manager-worker:latest',
        env: expect.objectContaining({
          AGENT_NAME: createDto.name,
          CURSOR_API_KEY: process.env.CURSOR_API_KEY,
          GIT_REPOSITORY_URL: process.env.GIT_REPOSITORY_URL,
          GIT_USERNAME: process.env.GIT_USERNAME,
          GIT_TOKEN: process.env.GIT_TOKEN,
          GIT_PASSWORD: process.env.GIT_PASSWORD,
          GIT_PRIVATE_KEY: process.env.GIT_PRIVATE_KEY,
        }),
        volumes: [
          {
            hostPath: expect.stringMatching(/^\/opt\/agents\/[a-f0-9-]+$/),
            containerPath: '/app',
            readOnly: false,
          },
          {
            hostPath: '/opt/agents',
            containerPath: '/opt/workspace',
            readOnly: true,
          },
        ],
      });
      // Verify git clone uses '/app' (escaped) when getRepositoryPath is not defined
      expect(dockerService.sendCommandToContainer).toHaveBeenNthCalledWith(
        5,
        containerId,
        expect.stringMatching(/sh -c "git clone '[^']+' '\/app'"/),
      );
    });

    it('should fall back to /app when getBasePath returns undefined', async () => {
      const createDto: CreateAgentDto = {
        name: 'New Agent',
        description: 'New Description',
        containerType: ContainerType.GENERIC,
      };
      const hashedPassword = 'hashed-password';
      const containerId = 'container-id-123';
      const volumePath = '/opt/agents/test-volume-uuid';
      const createdAgent = {
        ...mockAgent,
        name: createDto.name,
        description: createDto.description,
        hashedPassword,
        containerId,
        volumePath,
      };

      mockAgentProvider.getBasePath = jest.fn().mockReturnValue(undefined);
      // Remove getRepositoryPath to ensure it's not defined from previous tests
      delete (mockAgentProvider as { getRepositoryPath?: () => string }).getRepositoryPath;
      mockAgentProvider.getVirtualWorkspaceDockerImage.mockReturnValueOnce(undefined);
      mockAgentProvider.getSshConnectionDockerImage.mockReturnValueOnce(undefined);
      mockRepository.findByName.mockResolvedValue(null);
      passwordService.hashPassword.mockResolvedValue(hashedPassword);
      dockerService.createContainer.mockResolvedValue(containerId);
      dockerService.sendCommandToContainer.mockResolvedValue(undefined);
      repository.create.mockResolvedValue(createdAgent);

      await service.create(createDto);

      expect(mockAgentProvider.getBasePath).toHaveBeenCalled();
      expect(dockerService.createContainer).toHaveBeenNthCalledWith(1, {
        image: 'ghcr.io/forepath/agenstra-manager-worker:latest',
        env: expect.objectContaining({
          AGENT_NAME: createDto.name,
          CURSOR_API_KEY: process.env.CURSOR_API_KEY,
          GIT_REPOSITORY_URL: process.env.GIT_REPOSITORY_URL,
          GIT_USERNAME: process.env.GIT_USERNAME,
          GIT_TOKEN: process.env.GIT_TOKEN,
          GIT_PASSWORD: process.env.GIT_PASSWORD,
          GIT_PRIVATE_KEY: process.env.GIT_PRIVATE_KEY,
        }),
        volumes: [
          {
            hostPath: expect.stringMatching(/^\/opt\/agents\/[a-f0-9-]+$/),
            containerPath: '/app',
            readOnly: false,
          },
          {
            hostPath: '/opt/agents',
            containerPath: '/opt/workspace',
            readOnly: true,
          },
        ],
      });
      // Verify git clone uses '/app' (escaped) when getRepositoryPath is not defined
      expect(dockerService.sendCommandToContainer).toHaveBeenNthCalledWith(
        5,
        containerId,
        expect.stringMatching(/sh -c "git clone '[^']+' '\/app'"/),
      );
    });

    it('should include provider environment variables when getEnvironmentVariables is defined', async () => {
      const createDto: CreateAgentDto = {
        name: 'New Agent',
        description: 'New Description',
        containerType: ContainerType.GENERIC,
      };
      const hashedPassword = 'hashed-password';
      const containerId = 'container-id-123';
      const volumePath = '/opt/agents/test-volume-uuid';
      const createdAgent = {
        ...mockAgent,
        name: createDto.name,
        description: createDto.description,
        hashedPassword,
        containerId,
        volumePath,
      };
      const customEnvVars = {
        CUSTOM_VAR_1: 'value1',
        CUSTOM_VAR_2: 'value2',
        API_ENDPOINT: 'https://api.example.com',
      };

      mockAgentProvider.getEnvironmentVariables = jest.fn().mockReturnValue(customEnvVars);
      // Remove getRepositoryPath to ensure it's not defined from previous tests
      delete (mockAgentProvider as { getRepositoryPath?: () => string }).getRepositoryPath;
      mockAgentProvider.getVirtualWorkspaceDockerImage.mockReturnValueOnce(undefined);
      mockAgentProvider.getSshConnectionDockerImage.mockReturnValueOnce(undefined);
      mockRepository.findByName.mockResolvedValue(null);
      passwordService.hashPassword.mockResolvedValue(hashedPassword);
      dockerService.createContainer.mockResolvedValue(containerId);
      dockerService.sendCommandToContainer.mockResolvedValue(undefined);
      repository.create.mockResolvedValue(createdAgent);

      await service.create(createDto);

      expect(mockAgentProvider.getEnvironmentVariables).toHaveBeenCalled();
      expect(dockerService.createContainer).toHaveBeenNthCalledWith(1, {
        image: 'ghcr.io/forepath/agenstra-manager-worker:latest',
        env: expect.objectContaining({
          AGENT_NAME: createDto.name,
          CURSOR_API_KEY: process.env.CURSOR_API_KEY,
          GIT_REPOSITORY_URL: process.env.GIT_REPOSITORY_URL,
          GIT_USERNAME: process.env.GIT_USERNAME,
          GIT_TOKEN: process.env.GIT_TOKEN,
          GIT_PASSWORD: process.env.GIT_PASSWORD,
          GIT_PRIVATE_KEY: process.env.GIT_PRIVATE_KEY,
          ...customEnvVars,
        }),
        volumes: [
          {
            hostPath: expect.stringMatching(/^\/opt\/agents\/[a-f0-9-]+$/),
            containerPath: '/app',
            readOnly: false,
          },
          {
            hostPath: '/opt/agents',
            containerPath: '/opt/workspace',
            readOnly: true,
          },
        ],
      });
    });

    it('should not include provider environment variables when getEnvironmentVariables is not defined', async () => {
      const createDto: CreateAgentDto = {
        name: 'New Agent',
        description: 'New Description',
        containerType: ContainerType.GENERIC,
      };
      const hashedPassword = 'hashed-password';
      const containerId = 'container-id-123';
      const volumePath = '/opt/agents/test-volume-uuid';
      const createdAgent = {
        ...mockAgent,
        name: createDto.name,
        description: createDto.description,
        hashedPassword,
        containerId,
        volumePath,
      };

      // Remove getEnvironmentVariables to ensure it's not defined from previous tests
      delete (mockAgentProvider as { getEnvironmentVariables?: () => Record<string, string> }).getEnvironmentVariables;
      // Remove getRepositoryPath to ensure it's not defined from previous tests
      delete (mockAgentProvider as { getRepositoryPath?: () => string }).getRepositoryPath;
      mockAgentProvider.getVirtualWorkspaceDockerImage.mockReturnValueOnce(undefined);
      mockAgentProvider.getSshConnectionDockerImage.mockReturnValueOnce(undefined);
      mockRepository.findByName.mockResolvedValue(null);
      passwordService.hashPassword.mockResolvedValue(hashedPassword);
      dockerService.createContainer.mockResolvedValue(containerId);
      dockerService.sendCommandToContainer.mockResolvedValue(undefined);
      repository.create.mockResolvedValue(createdAgent);

      await service.create(createDto);

      // Verify that getEnvironmentVariables was not called (since it doesn't exist)
      expect(mockAgentProvider.getEnvironmentVariables).toBeUndefined();
      expect(dockerService.createContainer).toHaveBeenNthCalledWith(1, {
        image: 'ghcr.io/forepath/agenstra-manager-worker:latest',
        env: {
          AGENT_NAME: createDto.name,
          CURSOR_API_KEY: process.env.CURSOR_API_KEY,
          GIT_REPOSITORY_URL: process.env.GIT_REPOSITORY_URL,
          GIT_USERNAME: process.env.GIT_USERNAME,
          GIT_TOKEN: process.env.GIT_TOKEN,
          GIT_PASSWORD: process.env.GIT_PASSWORD,
          GIT_PRIVATE_KEY: process.env.GIT_PRIVATE_KEY,
        },
        volumes: [
          {
            hostPath: expect.stringMatching(/^\/opt\/agents\/[a-f0-9-]+$/),
            containerPath: '/app',
            readOnly: false,
          },
          {
            hostPath: '/opt/agents',
            containerPath: '/opt/workspace',
            readOnly: true,
          },
        ],
      });
    });

    it('should create agent successfully even if deployment configuration fails', async () => {
      const createDto: CreateAgentDto = {
        name: 'New Agent',
        deploymentConfiguration: {
          providerType: 'github',
          repositoryId: 'owner/repo',
          providerToken: 'ghp_token123',
        },
      };
      const hashedPassword = 'hashed-password';
      const containerId = 'container-id-123';
      const volumePath = '/opt/agents/test-volume-uuid';
      const createdAgent = {
        ...mockAgent,
        name: createDto.name,
        hashedPassword,
        containerId,
        volumePath,
      };

      mockAgentProvider.getVirtualWorkspaceDockerImage.mockReturnValueOnce(undefined);
      mockAgentProvider.getSshConnectionDockerImage.mockReturnValueOnce(undefined);
      mockRepository.findByName.mockResolvedValue(null);
      passwordService.hashPassword.mockResolvedValue(hashedPassword);
      dockerService.createContainer.mockResolvedValue(containerId);
      dockerService.sendCommandToContainer.mockResolvedValue(undefined);
      repository.create.mockResolvedValue(createdAgent);
      deploymentsService.upsertConfiguration.mockRejectedValue(new Error('Deployment config error'));

      const result = await service.create(createDto);

      expect(result.id).toBe(mockAgent.id);
      expect(result.name).toBe(createDto.name);
      expect(deploymentsService.upsertConfiguration).toHaveBeenCalled();
      // Agent creation should succeed even if deployment config fails
      expect(repository.create).toHaveBeenCalled();
    });

    it('should not create deployment configuration when not provided', async () => {
      const createDto: CreateAgentDto = {
        name: 'New Agent',
      };
      const hashedPassword = 'hashed-password';
      const containerId = 'container-id-123';
      const volumePath = '/opt/agents/test-volume-uuid';
      const createdAgent = {
        ...mockAgent,
        name: createDto.name,
        hashedPassword,
        containerId,
        volumePath,
      };

      mockAgentProvider.getVirtualWorkspaceDockerImage.mockReturnValueOnce(undefined);
      mockAgentProvider.getSshConnectionDockerImage.mockReturnValueOnce(undefined);
      mockRepository.findByName.mockResolvedValue(null);
      passwordService.hashPassword.mockResolvedValue(hashedPassword);
      dockerService.createContainer.mockResolvedValue(containerId);
      dockerService.sendCommandToContainer.mockResolvedValue(undefined);
      repository.create.mockResolvedValue(createdAgent);

      const result = await service.create(createDto);

      expect(result.id).toBe(mockAgent.id);
      expect(deploymentsService.upsertConfiguration).not.toHaveBeenCalled();
    });

    it('should create agent successfully when DeploymentsService is not available', async () => {
      // Create a new module without DeploymentsService
      const moduleWithoutDeployments: TestingModule = await Test.createTestingModule({
        providers: [
          AgentsService,
          {
            provide: AgentsRepository,
            useValue: mockRepository,
          },
          {
            provide: PasswordService,
            useValue: mockPasswordService,
          },
          {
            provide: DockerService,
            useValue: mockDockerService,
          },
          {
            provide: AGENT_PROVIDER_REGISTRY,
            useValue: mockAgentProviderRegistry,
          },
          {
            provide: DeploymentsService,
            useValue: undefined,
          },
        ],
      }).compile();
      const serviceWithoutDeployments = moduleWithoutDeployments.get<AgentsService>(AgentsService);
      const createDto: CreateAgentDto = {
        name: 'New Agent',
        deploymentConfiguration: {
          providerType: 'github',
          repositoryId: 'owner/repo',
          providerToken: 'ghp_token123',
        },
      };
      const hashedPassword = 'hashed-password';
      const containerId = 'container-id-123';
      const volumePath = '/opt/agents/test-volume-uuid';
      const createdAgent = {
        ...mockAgent,
        name: createDto.name,
        hashedPassword,
        containerId,
        volumePath,
      };

      mockAgentProvider.getVirtualWorkspaceDockerImage.mockReturnValueOnce(undefined);
      mockAgentProvider.getSshConnectionDockerImage.mockReturnValueOnce(undefined);
      mockRepository.findByName.mockResolvedValue(null);
      passwordService.hashPassword.mockResolvedValue(hashedPassword);
      dockerService.createContainer.mockResolvedValue(containerId);
      dockerService.sendCommandToContainer.mockResolvedValue(undefined);
      repository.create.mockResolvedValue(createdAgent);

      // Should succeed even without DeploymentsService
      const result = await serviceWithoutDeployments.create(createDto);

      expect(result.id).toBe(mockAgent.id);
      expect(result.name).toBe(createDto.name);
    });

    it('should not mkdir provider config when getConfigBasePath is not defined', async () => {
      const createDto: CreateAgentDto = {
        name: 'Agent Without Config Base',
        containerType: ContainerType.GENERIC,
      };
      const hashedPassword = 'hashed-password';
      const containerId = 'container-id-123';
      const createdAgent = {
        ...mockAgent,
        name: createDto.name,
        hashedPassword,
        containerId,
        volumePath: '/opt/agents/vol',
      };

      delete (mockAgentProvider as { getConfigBasePath?: () => string }).getConfigBasePath;
      mockAgentProvider.getVirtualWorkspaceDockerImage.mockReturnValueOnce(undefined);
      mockAgentProvider.getSshConnectionDockerImage.mockReturnValueOnce(undefined);
      mockRepository.findByName.mockResolvedValue(null);
      passwordService.hashPassword.mockResolvedValue(hashedPassword);
      dockerService.createContainer.mockResolvedValue(containerId);
      dockerService.sendCommandToContainer.mockResolvedValue(undefined);
      repository.create.mockResolvedValue(createdAgent);

      await service.create(createDto);

      expect(dockerService.sendCommandToContainer).toHaveBeenCalledTimes(3);
      expect(dockerService.getContainerHomeDirectory).toHaveBeenCalledTimes(1);
      expect(dockerService.getContainerHomeDirectory).toHaveBeenCalledWith(containerId);
    });

    it('should mkdir absolute provider config path without calling getContainerHomeDirectory for tilde expansion', async () => {
      const createDto: CreateAgentDto = {
        name: 'Agent Abs Config',
        containerType: ContainerType.GENERIC,
      };
      const hashedPassword = 'hashed-password';
      const containerId = 'container-id-abc';
      const createdAgent = {
        ...mockAgent,
        name: createDto.name,
        hashedPassword,
        containerId,
        volumePath: '/opt/agents/vol2',
      };

      mockAgentProvider.getConfigBasePath = jest.fn().mockReturnValue('/var/my-agent-config');
      mockAgentProvider.getVirtualWorkspaceDockerImage.mockReturnValueOnce(undefined);
      mockAgentProvider.getSshConnectionDockerImage.mockReturnValueOnce(undefined);
      mockRepository.findByName.mockResolvedValue(null);
      passwordService.hashPassword.mockResolvedValue(hashedPassword);
      dockerService.createContainer.mockResolvedValue(containerId);
      dockerService.sendCommandToContainer.mockResolvedValue(undefined);
      repository.create.mockResolvedValue(createdAgent);

      await service.create(createDto);

      expect(dockerService.getContainerHomeDirectory).toHaveBeenCalledTimes(1);
      expect(dockerService.sendCommandToContainer).toHaveBeenNthCalledWith(
        3,
        containerId,
        `sh -c "mkdir -p -- '/var/my-agent-config'"`,
        undefined,
        true,
      );
      expect(dockerService.sendCommandToContainer).toHaveBeenNthCalledWith(
        4,
        containerId,
        `sh -c "sudo chown -R agenstra:agenstra -- '/var/my-agent-config'"`,
        undefined,
        true,
      );
    });
  });

  describe('findAll', () => {
    it('should return array of agents', async () => {
      const agents = [mockAgent];

      mockRepository.findAll.mockResolvedValue(agents);

      const result = await service.findAll(10, 0);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(mockAgent.id);
      expect(result[0]).not.toHaveProperty('hashedPassword');
      expect(repository.findAll).toHaveBeenCalledWith(10, 0);
    });

    it('should use default pagination values', async () => {
      const agents = [mockAgent];

      mockRepository.findAll.mockResolvedValue(agents);

      await service.findAll();

      expect(repository.findAll).toHaveBeenCalledWith(10, 0);
    });
  });

  describe('findOne', () => {
    it('should return agent by id', async () => {
      mockRepository.findByIdOrThrow.mockResolvedValue(mockAgent);

      const result = await service.findOne('test-uuid');

      expect(result.id).toBe(mockAgent.id);
      expect(result).not.toHaveProperty('hashedPassword');
      expect(repository.findByIdOrThrow).toHaveBeenCalledWith('test-uuid');
    });
  });

  describe('listModels', () => {
    const modelsPayload: AgentProviderModels = { 'model-1': 'First Model', 'model-2': 'Second Model' };

    it('should return parsed models when container command succeeds', async () => {
      mockRepository.findByIdOrThrow.mockResolvedValue(mockAgent);
      mockAgentProvider.getModelsListCommand.mockReturnValue('cursor-agent --list-models');
      mockAgentProvider.toModelsList.mockReturnValue(modelsPayload);
      dockerService.sendCommandToContainer.mockResolvedValue('raw-output');

      const result = await service.listModels('test-uuid');

      expect(result).toEqual(modelsPayload);
      expect(repository.findByIdOrThrow).toHaveBeenCalledWith('test-uuid');
      expect(agentProviderRegistry.getProvider).toHaveBeenCalledWith(mockAgent.agentType);
      expect(mockAgentProvider.getModelsListCommand).toHaveBeenCalled();
      expect(dockerService.sendCommandToContainer).toHaveBeenCalledWith(
        mockAgent.containerId,
        'cursor-agent --list-models',
      );
      expect(mockAgentProvider.toModelsList).toHaveBeenCalledWith('raw-output');
    });

    it('should return empty object when toModelsList returns undefined', async () => {
      mockRepository.findByIdOrThrow.mockResolvedValue(mockAgent);
      mockAgentProvider.toModelsList.mockReturnValue(undefined);
      dockerService.sendCommandToContainer.mockResolvedValue('raw-output');

      const result = await service.listModels('test-uuid');

      expect(result).toEqual({});
    });

    it('should return empty object without calling docker when agent has no containerId', async () => {
      const agentWithoutContainer = { ...mockAgent, containerId: undefined };

      mockRepository.findByIdOrThrow.mockResolvedValue(agentWithoutContainer);

      const result = await service.listModels('test-uuid');

      expect(result).toEqual({});
      expect(dockerService.sendCommandToContainer).not.toHaveBeenCalled();
    });

    it('should throw when provider does not support listing models', async () => {
      mockRepository.findByIdOrThrow.mockResolvedValue(mockAgent);
      const unsupported = {
        ...mockAgentProvider,
        getModelsListCommand: undefined,
        toModelsList: undefined,
      } as unknown as AgentProvider;

      agentProviderRegistry.getProvider.mockReturnValueOnce(unsupported);

      await expect(service.listModels('test-uuid')).rejects.toThrow(BadRequestException);
      expect(dockerService.sendCommandToContainer).not.toHaveBeenCalled();
    });

    it('should return empty object and log when docker command fails', async () => {
      const logError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      mockRepository.findByIdOrThrow.mockResolvedValue(mockAgent);
      dockerService.sendCommandToContainer.mockRejectedValue(new Error('container not running'));

      const result = await service.listModels('test-uuid');

      expect(result).toEqual({});
      expect(logError).toHaveBeenCalled();
      logError.mockRestore();
    });
  });

  describe('update', () => {
    it('should update agent', async () => {
      const updateDto: UpdateAgentDto = {
        name: 'Updated Agent',
        description: 'Updated Description',
      };
      const updatedAgent = { ...mockAgent, ...updateDto };

      mockRepository.findByName.mockResolvedValue(null);
      repository.update.mockResolvedValue(updatedAgent);

      const result = await service.update('test-uuid', updateDto);

      expect(result.name).toBe(updateDto.name);
      expect(repository.update).toHaveBeenCalled();
    });

    it('should throw BadRequestException when new name conflicts', async () => {
      const updateDto: UpdateAgentDto = {
        name: 'Conflicting Name',
      };
      const conflictingAgent = { ...mockAgent, id: 'different-id' };

      mockRepository.findByName.mockResolvedValue(conflictingAgent);

      await expect(service.update('test-uuid', updateDto)).rejects.toThrow(BadRequestException);
    });

    it('should update agent with deployment configuration', async () => {
      const updateDto: UpdateAgentDto = {
        name: 'Updated Agent',
        deploymentConfiguration: {
          providerType: 'github',
          repositoryId: 'owner/repo',
          defaultBranch: 'main',
          workflowId: 'workflow.yml',
          providerToken: 'ghp_token123',
        },
      };
      const updatedAgent = { ...mockAgent, ...updateDto };

      mockRepository.findByName.mockResolvedValue(null);
      repository.update.mockResolvedValue(updatedAgent);
      deploymentsService.upsertConfiguration.mockResolvedValue({
        id: 'config-uuid',
        agentId: 'test-uuid',
        providerType: 'github',
        repositoryId: 'owner/repo',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.update('test-uuid', updateDto);

      expect(result.name).toBe(updateDto.name);
      expect(deploymentsService.upsertConfiguration).toHaveBeenCalledWith('test-uuid', {
        providerType: 'github',
        repositoryId: 'owner/repo',
        defaultBranch: 'main',
        workflowId: 'workflow.yml',
        providerToken: 'ghp_token123',
        providerBaseUrl: undefined,
      });
    });

    it('should update agent successfully even if deployment configuration fails', async () => {
      const updateDto: UpdateAgentDto = {
        name: 'Updated Agent',
        deploymentConfiguration: {
          providerType: 'github',
          repositoryId: 'owner/repo',
          providerToken: 'ghp_token123',
        },
      };
      const updatedAgent = { ...mockAgent, ...updateDto };

      mockRepository.findByName.mockResolvedValue(null);
      repository.update.mockResolvedValue(updatedAgent);
      deploymentsService.upsertConfiguration.mockRejectedValue(new Error('Deployment config error'));

      const result = await service.update('test-uuid', updateDto);

      expect(result.name).toBe(updateDto.name);
      expect(deploymentsService.upsertConfiguration).toHaveBeenCalled();
      // Agent update should succeed even if deployment config fails
      expect(repository.update).toHaveBeenCalled();
    });

    it('should not update deployment configuration when not provided', async () => {
      const updateDto: UpdateAgentDto = {
        name: 'Updated Agent',
      };
      const updatedAgent = { ...mockAgent, ...updateDto };

      mockRepository.findByName.mockResolvedValue(null);
      repository.update.mockResolvedValue(updatedAgent);

      const result = await service.update('test-uuid', updateDto);

      expect(result.name).toBe(updateDto.name);
      expect(deploymentsService.upsertConfiguration).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('should delete agent with container', async () => {
      mockRepository.findByIdOrThrow.mockResolvedValue(mockAgent);
      dockerService.deleteContainer.mockResolvedValue(undefined);
      repository.delete.mockResolvedValue(undefined);

      await service.remove('test-uuid');

      expect(repository.findByIdOrThrow).toHaveBeenCalledWith('test-uuid');
      expect(dockerService.deleteContainer).toHaveBeenCalledWith(mockAgent.containerId);
      expect(repository.delete).toHaveBeenCalledWith('test-uuid');
    });

    it('should delete agent without container', async () => {
      const agentWithoutContainer = { ...mockAgent, containerId: undefined };

      mockRepository.findByIdOrThrow.mockResolvedValue(agentWithoutContainer);
      repository.delete.mockResolvedValue(undefined);

      await service.remove('test-uuid');

      expect(repository.findByIdOrThrow).toHaveBeenCalledWith('test-uuid');
      expect(dockerService.deleteContainer).not.toHaveBeenCalled();
      expect(repository.delete).toHaveBeenCalledWith('test-uuid');
    });

    it('should delete agent when containerId is null', async () => {
      const agentWithNullContainer = { ...mockAgent, containerId: null as string | undefined };

      mockRepository.findByIdOrThrow.mockResolvedValue(agentWithNullContainer);
      repository.delete.mockResolvedValue(undefined);

      await service.remove('test-uuid');

      expect(repository.findByIdOrThrow).toHaveBeenCalledWith('test-uuid');
      expect(dockerService.deleteContainer).not.toHaveBeenCalled();
      expect(repository.delete).toHaveBeenCalledWith('test-uuid');
    });
  });

  describe('start', () => {
    it('should start agent main container and return agent', async () => {
      mockRepository.findByIdOrThrow.mockResolvedValue(mockAgent);
      dockerService.startContainer.mockResolvedValue(undefined);

      const result = await service.start('test-uuid');

      expect(result.id).toBe(mockAgent.id);
      expect(result.name).toBe(mockAgent.name);
      expect(repository.findByIdOrThrow).toHaveBeenCalledWith('test-uuid');
      expect(dockerService.startContainer).toHaveBeenCalledWith(mockAgent.containerId);
      expect(dockerService.startContainer).toHaveBeenCalledTimes(1);
    });

    it('should start agent with VNC and SSH containers', async () => {
      const agentWithVncSsh = {
        ...mockAgent,
        vncContainerId: 'vnc-container-id',
        sshContainerId: 'ssh-container-id',
      };

      mockRepository.findByIdOrThrow.mockResolvedValue(agentWithVncSsh);
      dockerService.startContainer.mockResolvedValue(undefined);

      const result = await service.start('test-uuid');

      expect(result.id).toBe(agentWithVncSsh.id);
      expect(dockerService.startContainer).toHaveBeenCalledWith(agentWithVncSsh.containerId);
      expect(dockerService.startContainer).toHaveBeenCalledWith(agentWithVncSsh.vncContainerId);
      expect(dockerService.startContainer).toHaveBeenCalledWith(agentWithVncSsh.sshContainerId);
      expect(dockerService.startContainer).toHaveBeenCalledTimes(3);
    });

    it('should throw when agent not found', async () => {
      const notFoundError = new Error('Agent not found');

      mockRepository.findByIdOrThrow.mockRejectedValue(notFoundError);

      await expect(service.start('non-existent')).rejects.toThrow('Agent not found');
      expect(dockerService.startContainer).not.toHaveBeenCalled();
    });

    it('should throw when main container start fails', async () => {
      mockRepository.findByIdOrThrow.mockResolvedValue(mockAgent);
      dockerService.startContainer.mockRejectedValue(new Error('Docker start failed'));

      await expect(service.start('test-uuid')).rejects.toThrow('Docker start failed');
    });
  });

  describe('stop', () => {
    it('should stop agent main container and return agent', async () => {
      mockRepository.findByIdOrThrow.mockResolvedValue(mockAgent);
      dockerService.stopContainer.mockResolvedValue(undefined);

      const result = await service.stop('test-uuid');

      expect(result.id).toBe(mockAgent.id);
      expect(result.name).toBe(mockAgent.name);
      expect(repository.findByIdOrThrow).toHaveBeenCalledWith('test-uuid');
      expect(dockerService.stopContainer).toHaveBeenCalledWith(mockAgent.containerId);
      expect(dockerService.stopContainer).toHaveBeenCalledTimes(1);
    });

    it('should stop agent with VNC and SSH containers', async () => {
      const agentWithVncSsh = {
        ...mockAgent,
        vncContainerId: 'vnc-container-id',
        sshContainerId: 'ssh-container-id',
      };

      mockRepository.findByIdOrThrow.mockResolvedValue(agentWithVncSsh);
      dockerService.stopContainer.mockResolvedValue(undefined);

      const result = await service.stop('test-uuid');

      expect(result.id).toBe(agentWithVncSsh.id);
      expect(dockerService.stopContainer).toHaveBeenCalledWith(agentWithVncSsh.containerId);
      expect(dockerService.stopContainer).toHaveBeenCalledWith(agentWithVncSsh.vncContainerId);
      expect(dockerService.stopContainer).toHaveBeenCalledWith(agentWithVncSsh.sshContainerId);
      expect(dockerService.stopContainer).toHaveBeenCalledTimes(3);
    });

    it('should throw when agent not found', async () => {
      mockRepository.findByIdOrThrow.mockRejectedValue(new Error('Agent not found'));

      await expect(service.stop('non-existent')).rejects.toThrow('Agent not found');
      expect(dockerService.stopContainer).not.toHaveBeenCalled();
    });

    it('should throw when main container stop fails', async () => {
      mockRepository.findByIdOrThrow.mockResolvedValue(mockAgent);
      dockerService.stopContainer.mockRejectedValue(new Error('Docker stop failed'));

      await expect(service.stop('test-uuid')).rejects.toThrow('Docker stop failed');
    });
  });

  describe('restart', () => {
    it('should restart agent main container and return agent', async () => {
      mockRepository.findByIdOrThrow.mockResolvedValue(mockAgent);
      dockerService.restartContainer.mockResolvedValue(undefined);

      const result = await service.restart('test-uuid');

      expect(result.id).toBe(mockAgent.id);
      expect(result.name).toBe(mockAgent.name);
      expect(repository.findByIdOrThrow).toHaveBeenCalledWith('test-uuid');
      expect(dockerService.restartContainer).toHaveBeenCalledWith(mockAgent.containerId);
      expect(dockerService.restartContainer).toHaveBeenCalledTimes(1);
    });

    it('should restart agent with VNC and SSH containers', async () => {
      const agentWithVncSsh = {
        ...mockAgent,
        vncContainerId: 'vnc-container-id',
        sshContainerId: 'ssh-container-id',
      };

      mockRepository.findByIdOrThrow.mockResolvedValue(agentWithVncSsh);
      dockerService.restartContainer.mockResolvedValue(undefined);

      const result = await service.restart('test-uuid');

      expect(result.id).toBe(agentWithVncSsh.id);
      expect(dockerService.restartContainer).toHaveBeenCalledWith(agentWithVncSsh.containerId);
      expect(dockerService.restartContainer).toHaveBeenCalledWith(agentWithVncSsh.vncContainerId);
      expect(dockerService.restartContainer).toHaveBeenCalledWith(agentWithVncSsh.sshContainerId);
      expect(dockerService.restartContainer).toHaveBeenCalledTimes(3);
    });

    it('should throw when agent not found', async () => {
      mockRepository.findByIdOrThrow.mockRejectedValue(new Error('Agent not found'));

      await expect(service.restart('non-existent')).rejects.toThrow('Agent not found');
      expect(dockerService.restartContainer).not.toHaveBeenCalled();
    });

    it('should throw when main container restart fails', async () => {
      mockRepository.findByIdOrThrow.mockResolvedValue(mockAgent);
      dockerService.restartContainer.mockRejectedValue(new Error('Docker restart failed'));

      await expect(service.restart('test-uuid')).rejects.toThrow('Docker restart failed');
    });
  });

  describe('verifyCredentials', () => {
    it('should return true when credentials are valid', async () => {
      mockRepository.findById.mockResolvedValue(mockAgent);
      passwordService.verifyPassword.mockResolvedValue(true);

      const result = await service.verifyCredentials('test-uuid', 'password');

      expect(result).toBe(true);
      expect(passwordService.verifyPassword).toHaveBeenCalledWith('password', mockAgent.hashedPassword);
    });

    it('should return false when agent not found', async () => {
      mockRepository.findById.mockResolvedValue(null);

      const result = await service.verifyCredentials('non-existent', 'password');

      expect(result).toBe(false);
      expect(passwordService.verifyPassword).not.toHaveBeenCalled();
    });

    it('should return false when password does not match', async () => {
      mockRepository.findById.mockResolvedValue(mockAgent);
      passwordService.verifyPassword.mockResolvedValue(false);

      const result = await service.verifyCredentials('test-uuid', 'wrong');

      expect(result).toBe(false);
      expect(passwordService.verifyPassword).toHaveBeenCalledWith('wrong', mockAgent.hashedPassword);
    });
  });

  describe('generateRandomPassword', () => {
    it('should generate passwords of correct length', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const password1 = (service as any).generateRandomPassword();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const password2 = (service as any).generateRandomPassword();

      expect(password1).toHaveLength(16);
      expect(password2).toHaveLength(16);
      expect(password1).not.toBe(password2); // Should be random
    });

    it('should generate passwords with alphanumeric characters', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const password = (service as any).generateRandomPassword();
      const alphanumericRegex = /^[a-zA-Z0-9]+$/;

      expect(password).toMatch(alphanumericRegex);
    });
  });

  describe('extractGitDomain', () => {
    beforeEach(() => {
      process.env.GIT_USERNAME = 'testuser';
      process.env.GIT_TOKEN = 'test-token';
      process.env.GIT_REPOSITORY_URL = 'https://github.com/user/repo.git';
    });

    it('should extract domain from https URL', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const domain = (service as any).extractGitDomain('https://github.com/user/repo.git');

      expect(domain).toBe('github.com');
    });

    it('should extract domain from http URL', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const domain = (service as any).extractGitDomain('http://gitlab.com/user/repo.git');

      expect(domain).toBe('gitlab.com');
    });

    it('should extract domain from git@ URL', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const domain = (service as any).extractGitDomain('git@github.com:user/repo.git');

      expect(domain).toBe('github.com');
    });

    it('should extract domain from URL with port', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const domain = (service as any).extractGitDomain('https://git.example.com:8443/user/repo.git');

      expect(domain).toBe('git.example.com');
    });

    it('should return default github.com for invalid URL', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const domain = (service as any).extractGitDomain('invalid-url');

      expect(domain).toBe('github.com');
    });

    it('should extract domain from URL with path', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const domain = (service as any).extractGitDomain('https://bitbucket.org/workspace/repo.git');

      expect(domain).toBe('bitbucket.org');
    });
  });

  describe('createNetrcFile', () => {
    beforeEach(() => {
      process.env.GIT_USERNAME = 'testuser';
      process.env.GIT_TOKEN = 'test-token-123';
      process.env.GIT_REPOSITORY_URL = 'https://github.com/user/repo.git';
    });

    it('should create .netrc file with correct format', async () => {
      const containerId = 'container-id-123';

      dockerService.sendCommandToContainer.mockResolvedValue(undefined);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (service as any).createNetrcFile(containerId, process.env.GIT_REPOSITORY_URL);

      expect(dockerService.sendCommandToContainer).toHaveBeenCalledTimes(2);
      // Verify first command writes file using base64
      expect(dockerService.sendCommandToContainer).toHaveBeenNthCalledWith(
        1,
        containerId,
        expect.stringMatching(/sh -c "base64 -d > '\/home\/agenstra\/\.netrc'"/),
        expect.any(String), // base64 content
      );
      // Verify second command sets permissions
      expect(dockerService.sendCommandToContainer).toHaveBeenNthCalledWith(
        2,
        containerId,
        "chmod 600 '/home/agenstra/.netrc'",
      );

      // Verify base64 content contains expected .netrc content
      const base64Call = dockerService.sendCommandToContainer.mock.calls[0];
      const base64Content = base64Call[2] as string;
      const decodedContent = Buffer.from(base64Content, 'base64').toString('utf-8');

      expect(decodedContent).toContain('machine github.com');
      expect(decodedContent).toContain('login testuser');
      expect(decodedContent).toContain('password test-token-123');
    });

    it('should escape special characters in credentials', async () => {
      const containerId = 'container-id-123';

      process.env.GIT_USERNAME = "user'name";
      process.env.GIT_TOKEN = "token'with'quotes";
      process.env.GIT_REPOSITORY_URL = 'https://github.com/user/repo.git';
      dockerService.sendCommandToContainer.mockResolvedValue(undefined);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (service as any).createNetrcFile(containerId, process.env.GIT_REPOSITORY_URL);

      // Verify that special characters are properly handled in base64 content
      const base64Call = dockerService.sendCommandToContainer.mock.calls[0];
      const base64Content = base64Call[2] as string;
      const decodedContent = Buffer.from(base64Content, 'base64').toString('utf-8');

      expect(decodedContent).toContain("user'name");
      expect(decodedContent).toContain("token'with'quotes");

      // Verify the file path is properly escaped in the command
      expect(dockerService.sendCommandToContainer).toHaveBeenNthCalledWith(
        1,
        containerId,
        expect.stringMatching(/sh -c "base64 -d > '\/home\/agenstra\/\.netrc'"/),
        expect.any(String),
      );
    });

    it('should throw BadRequestException when GIT_USERNAME is missing', async () => {
      const containerId = 'container-id-123';

      delete process.env.GIT_USERNAME;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await expect((service as any).createNetrcFile(containerId)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when GIT_TOKEN and GIT_PASSWORD are missing', async () => {
      const containerId = 'container-id-123';

      delete process.env.GIT_TOKEN;
      delete process.env.GIT_PASSWORD;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await expect((service as any).createNetrcFile(containerId)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when GIT_REPOSITORY_URL is missing', async () => {
      const containerId = 'container-id-123';

      delete process.env.GIT_REPOSITORY_URL;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await expect((service as any).createNetrcFile(containerId)).rejects.toThrow(BadRequestException);
    });

    it('should use GIT_PASSWORD when GIT_TOKEN is not available', async () => {
      const containerId = 'container-id-123';

      delete process.env.GIT_TOKEN;
      process.env.GIT_PASSWORD = 'test-password';
      process.env.GIT_REPOSITORY_URL = 'https://github.com/user/repo.git';
      dockerService.sendCommandToContainer.mockResolvedValue(undefined);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (service as any).createNetrcFile(containerId, process.env.GIT_REPOSITORY_URL);

      expect(dockerService.sendCommandToContainer).toHaveBeenCalledTimes(2);
      // Verify password line uses GIT_PASSWORD in base64 content
      const base64Call = dockerService.sendCommandToContainer.mock.calls[0];
      const base64Content = base64Call[2] as string;
      const decodedContent = Buffer.from(base64Content, 'base64').toString('utf-8');

      expect(decodedContent).toContain('password test-password');
    });

    it('should resolve .netrc path from container home directory', async () => {
      const containerId = 'container-id-123';
      const customHome = '/custom/home';

      dockerService.getContainerHomeDirectory.mockResolvedValueOnce(customHome);
      dockerService.sendCommandToContainer.mockResolvedValue(undefined);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (service as any).createNetrcFile(containerId, process.env.GIT_REPOSITORY_URL);

      expect(dockerService.getContainerHomeDirectory).toHaveBeenCalledWith(containerId);
      expect(dockerService.sendCommandToContainer).toHaveBeenNthCalledWith(
        1,
        containerId,
        expect.stringMatching(/sh -c "base64 -d > '\/custom\/home\/\.netrc'"/),
        expect.any(String),
      );
      expect(dockerService.sendCommandToContainer).toHaveBeenNthCalledWith(
        2,
        containerId,
        "chmod 600 '/custom/home/.netrc'",
      );
    });
  });

  describe('escapeForShell', () => {
    it('should escape strings with single quotes', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (service as any).escapeForShell("test'string");

      expect(result).toBe("'test'\\''string'");
    });

    it('should wrap simple strings in single quotes', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (service as any).escapeForShell('simple-string');

      expect(result).toBe("'simple-string'");
    });

    it('should handle empty strings', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (service as any).escapeForShell('');

      expect(result).toBe("''");
    });

    it('should handle strings with multiple single quotes', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (service as any).escapeForShell("a'b'c");

      expect(result).toBe("'a'\\''b'\\''c'");
    });
  });

  describe('isSshRepository', () => {
    it('should return true for git@ URL', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (service as any).isSshRepository('git@github.com:user/repo.git');

      expect(result).toBe(true);
    });

    it('should return true for ssh:// URL', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (service as any).isSshRepository('ssh://git@github.com/user/repo.git');

      expect(result).toBe(true);
    });

    it('should return false for https:// URL', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (service as any).isSshRepository('https://github.com/user/repo.git');

      expect(result).toBe(false);
    });

    it('should return false for http:// URL', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (service as any).isSshRepository('http://github.com/user/repo.git');

      expect(result).toBe(false);
    });

    it('should return false for undefined URL', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (service as any).isSshRepository(undefined);

      expect(result).toBe(false);
    });

    it('should return false for empty string', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (service as any).isSshRepository('');

      expect(result).toBe(false);
    });
  });

  describe('getSshHostInfo', () => {
    it('should extract host from ssh:// URL', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (service as any).getSshHostInfo('ssh://git@github.com:22/user/repo.git');

      expect(result).toEqual({ host: 'github.com', port: 22 });
    });

    it('should extract host from ssh:// URL without port', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (service as any).getSshHostInfo('ssh://git@github.com/user/repo.git');

      expect(result).toEqual({ host: 'github.com' });
    });

    it('should extract host from git@ URL', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (service as any).getSshHostInfo('git@github.com:user/repo.git');

      expect(result).toEqual({ host: 'github.com' });
    });

    it('should fallback to extractGitDomain for other formats', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (service as any).getSshHostInfo('https://gitlab.com/user/repo.git');

      expect(result).toEqual({ host: 'gitlab.com' });
    });
  });

  describe('getSshKeyFilename', () => {
    it('should return id_rsa for RSA keys', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (service as any).getSshKeyFilename('rsa');

      expect(result).toBe('id_rsa');
    });

    it('should return id_ed25519 for Ed25519 keys', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (service as any).getSshKeyFilename('ed25519');

      expect(result).toBe('id_ed25519');
    });

    it('should return id_ecdsa for ECDSA keys', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (service as any).getSshKeyFilename('ecdsa');

      expect(result).toBe('id_ecdsa');
    });

    it('should return id_dsa for DSA keys', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (service as any).getSshKeyFilename('dsa');

      expect(result).toBe('id_dsa');
    });

    it('should handle uppercase key types', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (service as any).getSshKeyFilename('RSA');

      expect(result).toBe('id_rsa');
    });

    it('should default to id_rsa for unknown key types', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (service as any).getSshKeyFilename('unknown');

      expect(result).toBe('id_rsa');
    });
  });

  describe('prepareSshKeyPair', () => {
    it('should parse valid Ed25519 private key', () => {
      const key = sshpk.generatePrivateKey('ed25519');
      const privateKeyPem = key.toString('openssh');
      const publicKey = key.toPublic().toString('ssh');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (service as any).prepareSshKeyPair(privateKeyPem);

      expect(result.privateKey).toContain('BEGIN');
      expect(result.privateKey).toContain('END');
      // Compare public keys by extracting the key part (before any comment)
      expect(result.publicKey.split(' ').slice(0, 2).join(' ')).toBe(publicKey.split(' ').slice(0, 2).join(' '));
      expect(result.keyFilename).toBe('id_ed25519');
      expect(result.generated).toBe(false);
    });

    it('should parse valid Ed25519 private key', () => {
      const key = sshpk.generatePrivateKey('ed25519');
      const privateKeyPem = key.toString('openssh');
      const publicKey = key.toPublic().toString('ssh');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (service as any).prepareSshKeyPair(privateKeyPem);

      expect(result.privateKey).toContain('BEGIN');
      // Compare public keys by extracting the key part (before any comment)
      expect(result.publicKey.split(' ').slice(0, 2).join(' ')).toBe(publicKey.split(' ').slice(0, 2).join(' '));
      expect(result.keyFilename).toBe('id_ed25519');
      expect(result.generated).toBe(false);
    });

    it('should throw BadRequestException for invalid private key', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(() => (service as any).prepareSshKeyPair('invalid-key')).toThrow(BadRequestException);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(() => (service as any).prepareSshKeyPair('invalid-key')).toThrow(
        'Invalid SSH private key. Ensure it is in PEM or OpenSSH format without a passphrase.',
      );
    });

    it('should throw BadRequestException when private key is undefined', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(() => (service as any).prepareSshKeyPair(undefined)).toThrow(BadRequestException);
    });

    it('should throw BadRequestException when private key is empty string', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(() => (service as any).prepareSshKeyPair('')).toThrow(BadRequestException);
    });

    it('should trim whitespace from private key', () => {
      const key = sshpk.generatePrivateKey('ed25519');
      const privateKeyPem = key.toString('openssh');
      const publicKey = key.toPublic().toString('ssh');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (service as any).prepareSshKeyPair(`  ${privateKeyPem}  `);

      // Compare public keys by extracting the key part (before any comment)
      expect(result.publicKey.split(' ').slice(0, 2).join(' ')).toBe(publicKey.split(' ').slice(0, 2).join(' '));
      expect(result.keyFilename).toBe('id_ed25519');
    });
  });

  describe('writeFileToContainer', () => {
    it('should write file content to container using base64 encoding', async () => {
      const containerId = 'container-id-123';
      const filePath = '/home/agenstra/.ssh/id_rsa';
      const contents = 'test file content\nwith newlines';

      dockerService.sendCommandToContainer.mockResolvedValue(undefined);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (service as any).writeFileToContainer(containerId, filePath, contents);

      expect(dockerService.sendCommandToContainer).toHaveBeenCalledTimes(1);
      const callArgs = dockerService.sendCommandToContainer.mock.calls[0];

      expect(callArgs[0]).toBe(containerId);
      expect(callArgs[1]).toContain('echo');
      expect(callArgs[1]).toContain('base64 -d');
      expect(callArgs[1]).toContain(filePath);
      // Verify base64 encoding
      const base64Content = Buffer.from(contents, 'utf-8').toString('base64');

      expect(callArgs[1]).toContain(base64Content);
    });

    it('should escape base64 content for shell', async () => {
      const containerId = 'container-id-123';
      const filePath = '/home/agenstra/test';
      const contents = "content with 'quotes'";

      dockerService.sendCommandToContainer.mockResolvedValue(undefined);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (service as any).writeFileToContainer(containerId, filePath, contents);

      const callArgs = dockerService.sendCommandToContainer.mock.calls[0];

      // Base64 content should be escaped
      expect(callArgs[1]).toMatch(/echo '.*' \| base64 -d >/);
    });
  });

  describe('configureSshAccess', () => {
    beforeEach(() => {
      process.env.GIT_REPOSITORY_URL = 'git@github.com:user/repo.git';
      dockerService.getContainerHomeDirectory.mockResolvedValue('/home/agenstra');
    });

    it('should configure SSH access with Ed25519 key', async () => {
      const containerId = 'container-id-123';
      const key = sshpk.generatePrivateKey('ed25519');
      const privateKeyPem = key.toString('openssh');
      const publicKey = key.toPublic().toString('ssh');

      dockerService.sendCommandToContainer.mockResolvedValue(undefined);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (service as any).configureSshAccess(
        containerId,
        'git@github.com:user/repo.git',
        privateKeyPem,
      );

      // Compare public keys by extracting the key part (before any comment)
      expect(result.publicKey.split(' ').slice(0, 2).join(' ')).toBe(publicKey.split(' ').slice(0, 2).join(' '));
      expect(result.privateKey).toBeUndefined(); // generated is false, so privateKey is not returned
      expect(dockerService.sendCommandToContainer).toHaveBeenCalledTimes(6);
      expect(dockerService.sendCommandToContainer).toHaveBeenNthCalledWith(
        1,
        containerId,
        "mkdir -p '/home/agenstra/.ssh'",
      );
      expect(dockerService.sendCommandToContainer).toHaveBeenNthCalledWith(
        2,
        containerId,
        "chmod 700 '/home/agenstra/.ssh'",
      );
      expect(dockerService.sendCommandToContainer).toHaveBeenNthCalledWith(
        3,
        containerId,
        expect.stringMatching(/echo .* \| base64 -d > \/home\/agenstra\/\.ssh\/id_ed25519/),
      );
      expect(dockerService.sendCommandToContainer).toHaveBeenNthCalledWith(
        4,
        containerId,
        "chmod 600 '/home/agenstra/.ssh/id_ed25519'",
      );
      expect(dockerService.sendCommandToContainer).toHaveBeenNthCalledWith(
        5,
        containerId,
        expect.stringMatching(/ssh-keyscan.*github\.com.*>> '\/home\/agenstra\/\.ssh\/known_hosts'/),
      );
      expect(dockerService.sendCommandToContainer).toHaveBeenNthCalledWith(
        6,
        containerId,
        "chmod 600 '/home/agenstra/.ssh/known_hosts' || true",
      );
    });

    it('should handle SSH URL with port', async () => {
      const containerId = 'container-id-123';
      const key = sshpk.generatePrivateKey('ed25519');
      const privateKeyPem = key.toString('openssh');

      dockerService.sendCommandToContainer.mockResolvedValue(undefined);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (service as any).configureSshAccess(containerId, 'ssh://git@github.com:22/user/repo.git', privateKeyPem);

      expect(dockerService.sendCommandToContainer).toHaveBeenCalledWith(
        containerId,
        expect.stringMatching(/ssh-keyscan -p 22 github\.com/),
      );
    });

    it('should throw BadRequestException for invalid private key', async () => {
      const containerId = 'container-id-123';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const serviceAny = service as any;

      await expect(
        serviceAny.configureSshAccess(containerId, 'git@github.com:user/repo.git', 'invalid-key'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should resolve SSH paths from container home directory', async () => {
      const containerId = 'container-id-123';
      const customHome = '/custom/home';
      const key = sshpk.generatePrivateKey('ed25519');
      const privateKeyPem = key.toString('openssh');

      dockerService.getContainerHomeDirectory.mockResolvedValueOnce(customHome);
      dockerService.sendCommandToContainer.mockResolvedValue(undefined);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (service as any).configureSshAccess(containerId, 'git@github.com:user/repo.git', privateKeyPem);

      expect(dockerService.getContainerHomeDirectory).toHaveBeenCalledWith(containerId);
      expect(dockerService.sendCommandToContainer).toHaveBeenNthCalledWith(
        1,
        containerId,
        "mkdir -p '/custom/home/.ssh'",
      );
      expect(dockerService.sendCommandToContainer).toHaveBeenNthCalledWith(
        5,
        containerId,
        expect.stringMatching(/ssh-keyscan.*github\.com.*>> '\/custom\/home\/\.ssh\/known_hosts'/),
      );
      expect(dockerService.sendCommandToContainer).toHaveBeenNthCalledWith(
        6,
        containerId,
        "chmod 600 '/custom/home/.ssh/known_hosts' || true",
      );
    });
  });
});
