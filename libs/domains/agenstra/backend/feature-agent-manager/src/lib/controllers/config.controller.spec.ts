import { Test, TestingModule } from '@nestjs/testing';

import { GitRepositorySetupMode } from '../constants/git-repository-setup-mode';
import type { AgentTypeInfo } from '../dto/config-response.dto';
import { ConfigService } from '../services/config.service';

import { ConfigController } from './config.controller';

const opencodeCapabilities = {
  transport: 'opencode-http' as const,
  supportsChat: true,
  supportsStreaming: true,
  supportsToolEvents: true,
  supportsQuestions: true,
};

describe('ConfigController', () => {
  let controller: ConfigController;
  let service: jest.Mocked<ConfigService>;
  const mockConfigService = {
    getGitRepositoryUrl: jest.fn(),
    getGitRepositorySetupMode: jest.fn(),
    getAvailableAgentTypes: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ConfigController],
      providers: [
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    controller = module.get<ConfigController>(ConfigController);
    service = module.get(ConfigService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getConfig', () => {
    it('should return configuration with git repository URL and agent types when set', async () => {
      const gitRepositoryUrl = 'https://github.com/user/repo.git';
      const agentTypes: AgentTypeInfo[] = [
        { type: 'opencode', displayName: 'OpenCode', capabilities: opencodeCapabilities },
      ];

      service.getGitRepositoryUrl.mockReturnValue(gitRepositoryUrl);
      service.getGitRepositorySetupMode.mockReturnValue(GitRepositorySetupMode.CLONE);
      service.getAvailableAgentTypes.mockReturnValue(agentTypes);

      const result = await controller.getConfig();

      expect(result).toEqual({
        gitRepositoryUrl,
        gitRepositorySetupMode: GitRepositorySetupMode.CLONE,
        agentTypes,
      });
      expect(service.getGitRepositoryUrl).toHaveBeenCalled();
      expect(service.getAvailableAgentTypes).toHaveBeenCalled();
    });

    it('should return configuration with undefined git repository URL when not set', async () => {
      const agentTypes: AgentTypeInfo[] = [
        { type: 'opencode', displayName: 'OpenCode', capabilities: opencodeCapabilities },
      ];

      service.getGitRepositoryUrl.mockReturnValue(undefined);
      service.getGitRepositorySetupMode.mockReturnValue(GitRepositorySetupMode.CLONE);
      service.getAvailableAgentTypes.mockReturnValue(agentTypes);

      const result = await controller.getConfig();

      expect(result).toEqual({
        gitRepositoryUrl: undefined,
        gitRepositorySetupMode: GitRepositorySetupMode.CLONE,
        agentTypes,
      });
      expect(service.getGitRepositoryUrl).toHaveBeenCalled();
      expect(service.getAvailableAgentTypes).toHaveBeenCalled();
    });

    it('should return all registered agent types', async () => {
      const agentTypes: AgentTypeInfo[] = [
        { type: 'opencode', displayName: 'OpenCode', capabilities: opencodeCapabilities },
        {
          type: 'openai',
          displayName: 'OpenAI',
          capabilities: { ...opencodeCapabilities, transport: undefined },
        },
        {
          type: 'anthropic',
          displayName: 'Anthropic Claude',
          capabilities: { ...opencodeCapabilities, transport: undefined },
        },
      ];

      service.getGitRepositoryUrl.mockReturnValue(undefined);
      service.getGitRepositorySetupMode.mockReturnValue(GitRepositorySetupMode.CLONE);
      service.getAvailableAgentTypes.mockReturnValue(agentTypes);

      const result = await controller.getConfig();

      expect(result.agentTypes).toEqual(agentTypes);
      expect(result.agentTypes).toHaveLength(3);
      expect(result.agentTypes[0]).toEqual({
        type: 'opencode',
        displayName: 'OpenCode',
        capabilities: opencodeCapabilities,
      });
      expect(result.agentTypes[1].type).toBe('openai');
      expect(result.agentTypes[2].type).toBe('anthropic');
    });

    it('should return empty array when no agent types are registered', async () => {
      service.getGitRepositoryUrl.mockReturnValue(undefined);
      service.getAvailableAgentTypes.mockReturnValue([]);

      const result = await controller.getConfig();

      expect(result.agentTypes).toEqual([]);
      expect(result.agentTypes).toHaveLength(0);
    });
  });
});
