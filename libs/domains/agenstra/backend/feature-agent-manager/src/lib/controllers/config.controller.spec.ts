import { Test, TestingModule } from '@nestjs/testing';

import { GitRepositorySetupMode } from '../constants/git-repository-setup-mode';
import { ConfigService } from '../services/config.service';

import { ConfigController } from './config.controller';

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
      const agentTypes = [{ type: 'cursor', displayName: 'Cursor' }];

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
      const agentTypes = [{ type: 'cursor', displayName: 'Cursor' }];

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
      const agentTypes = [
        { type: 'cursor', displayName: 'Cursor' },
        { type: 'openai', displayName: 'OpenAI' },
        { type: 'anthropic', displayName: 'Anthropic Claude' },
      ];

      service.getGitRepositoryUrl.mockReturnValue(undefined);
      service.getGitRepositorySetupMode.mockReturnValue(GitRepositorySetupMode.CLONE);
      service.getAvailableAgentTypes.mockReturnValue(agentTypes);

      const result = await controller.getConfig();

      expect(result.agentTypes).toEqual(agentTypes);
      expect(result.agentTypes).toHaveLength(3);
      expect(result.agentTypes[0]).toEqual({ type: 'cursor', displayName: 'Cursor' });
      expect(result.agentTypes[1]).toEqual({ type: 'openai', displayName: 'OpenAI' });
      expect(result.agentTypes[2]).toEqual({ type: 'anthropic', displayName: 'Anthropic Claude' });
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
