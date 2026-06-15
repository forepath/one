import {
  CommitDto,
  CreateBranchDto,
  GitBranchDto,
  GitDiffDto,
  GitStatusDto,
  RebaseDto,
  ResolveConflictDto,
  StageFilesDto,
  UnstageFilesDto,
} from '@forepath/agenstra/backend/feature-agent-manager';
import { ClientUsersRepository } from '@forepath/identity/backend';
import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { ClientsRepository } from '../repositories/clients.repository';
import { ClientAgentVcsProxyService } from '../services/client-agent-vcs-proxy.service';

import { ClientsVcsController } from './clients-vcs.controller';

describe('ClientsVcsController', () => {
  let controller: ClientsVcsController;
  let proxyService: jest.Mocked<ClientAgentVcsProxyService>;
  const mockClientsRepository = {
    findById: jest.fn(),
  };
  const mockClientUsersRepository = {
    findUserClientAccess: jest.fn(),
  };
  const mockProxyService = {
    getStatus: jest.fn(),
    getBranches: jest.fn(),
    getFileDiff: jest.fn(),
    stageFiles: jest.fn(),
    unstageFiles: jest.fn(),
    commit: jest.fn(),
    push: jest.fn(),
    pull: jest.fn(),
    fetch: jest.fn(),
    rebase: jest.fn(),
    switchBranch: jest.fn(),
    createBranch: jest.fn(),
    deleteBranch: jest.fn(),
    resolveConflict: jest.fn(),
  };

  beforeEach(async () => {
    mockClientsRepository.findById.mockResolvedValue({ id: 'client-uuid', userId: null });
    mockClientUsersRepository.findUserClientAccess.mockResolvedValue(null);

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ClientsVcsController],
      providers: [
        {
          provide: ClientAgentVcsProxyService,
          useValue: mockProxyService,
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

    controller = module.get<ClientsVcsController>(ClientsVcsController);
    proxyService = module.get(ClientAgentVcsProxyService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getStatus', () => {
    it('should get git status', async () => {
      const mockStatus: GitStatusDto = {
        currentBranch: 'main',
        isClean: true,
        hasUnpushedCommits: false,
        aheadCount: 0,
        behindCount: 0,
        files: [],
      };

      proxyService.getStatus.mockResolvedValue(mockStatus);

      const mockReq = { apiKeyAuthenticated: true } as any;
      const result = await controller.getStatus('client-uuid', 'agent-uuid', mockReq);

      expect(result).toEqual(mockStatus);
      expect(proxyService.getStatus).toHaveBeenCalledWith('client-uuid', 'agent-uuid');
    });
  });

  describe('getBranches', () => {
    it('should list branches', async () => {
      const mockBranches: GitBranchDto[] = [
        {
          name: 'main',
          ref: 'refs/heads/main',
          isCurrent: true,
          isRemote: false,
          commit: 'abc123',
          message: 'Initial commit',
        },
        {
          name: 'develop',
          ref: 'refs/heads/develop',
          isCurrent: false,
          isRemote: false,
          commit: 'def456',
          message: 'Develop branch',
        },
      ];

      proxyService.getBranches.mockResolvedValue(mockBranches);

      const mockReq = { apiKeyAuthenticated: true } as any;
      const result = await controller.getBranches('client-uuid', 'agent-uuid', mockReq);

      expect(result).toEqual(mockBranches);
      expect(proxyService.getBranches).toHaveBeenCalledWith('client-uuid', 'agent-uuid');
    });
  });

  describe('getFileDiff', () => {
    it('should get file diff', async () => {
      const mockDiff: GitDiffDto = {
        path: 'src/file.ts',
        originalContent: Buffer.from('old content').toString('base64'),
        modifiedContent: Buffer.from('new content').toString('base64'),
        encoding: 'utf-8',
        isBinary: false,
      };

      proxyService.getFileDiff.mockResolvedValue(mockDiff);

      const mockReq = { apiKeyAuthenticated: true } as any;
      const result = await controller.getFileDiff('client-uuid', 'agent-uuid', 'src/file.ts', mockReq);

      expect(result).toEqual(mockDiff);
      expect(proxyService.getFileDiff).toHaveBeenCalledWith('client-uuid', 'agent-uuid', 'src/file.ts');
    });

    it('should throw BadRequestException when file path is missing', async () => {
      await expect(controller.getFileDiff('client-uuid', 'agent-uuid', '')).rejects.toThrow('File path is required');
    });
  });

  describe('stageFiles', () => {
    it('should stage files', async () => {
      const dto: StageFilesDto = {
        files: ['src/file1.ts', 'src/file2.ts'],
      };

      proxyService.stageFiles.mockResolvedValue(undefined);

      const mockReq = { apiKeyAuthenticated: true } as any;

      await controller.stageFiles('client-uuid', 'agent-uuid', dto, mockReq);

      expect(proxyService.stageFiles).toHaveBeenCalledWith('client-uuid', 'agent-uuid', dto);
    });
  });

  describe('unstageFiles', () => {
    it('should unstage files', async () => {
      const dto: UnstageFilesDto = {
        files: ['src/file1.ts'],
      };

      proxyService.unstageFiles.mockResolvedValue(undefined);

      const mockReq = { apiKeyAuthenticated: true } as any;

      await controller.unstageFiles('client-uuid', 'agent-uuid', dto, mockReq);

      expect(proxyService.unstageFiles).toHaveBeenCalledWith('client-uuid', 'agent-uuid', dto);
    });
  });

  describe('commit', () => {
    it('should commit staged changes', async () => {
      const dto: CommitDto = {
        message: 'Test commit',
      };

      proxyService.commit.mockResolvedValue(undefined);

      const mockReq = { apiKeyAuthenticated: true } as any;

      await controller.commit('client-uuid', 'agent-uuid', dto, mockReq);

      expect(proxyService.commit).toHaveBeenCalledWith('client-uuid', 'agent-uuid', dto);
    });
  });

  describe('push', () => {
    it('should push changes', async () => {
      const pushOptions = { force: false };

      proxyService.push.mockResolvedValue(undefined);

      const mockReq = { apiKeyAuthenticated: true } as any;

      await controller.push('client-uuid', 'agent-uuid', pushOptions, mockReq);

      expect(proxyService.push).toHaveBeenCalledWith('client-uuid', 'agent-uuid', pushOptions);
    });

    it('should push with default empty options', async () => {
      proxyService.push.mockResolvedValue(undefined);

      const mockReq = { apiKeyAuthenticated: true } as any;

      await controller.push('client-uuid', 'agent-uuid', undefined, mockReq);

      expect(proxyService.push).toHaveBeenCalledWith('client-uuid', 'agent-uuid', {});
    });
  });

  describe('pull', () => {
    it('should pull changes', async () => {
      proxyService.pull.mockResolvedValue(undefined);

      const mockReq = { apiKeyAuthenticated: true } as any;

      await controller.pull('client-uuid', 'agent-uuid', mockReq);

      expect(proxyService.pull).toHaveBeenCalledWith('client-uuid', 'agent-uuid');
    });
  });

  describe('fetch', () => {
    it('should fetch changes', async () => {
      proxyService.fetch.mockResolvedValue(undefined);

      const mockReq = { apiKeyAuthenticated: true } as any;

      await controller.fetch('client-uuid', 'agent-uuid', mockReq);

      expect(proxyService.fetch).toHaveBeenCalledWith('client-uuid', 'agent-uuid');
    });
  });

  describe('rebase', () => {
    it('should rebase branch', async () => {
      const dto: RebaseDto = {
        branch: 'main',
      };

      proxyService.rebase.mockResolvedValue(undefined);

      const mockReq = { apiKeyAuthenticated: true } as any;

      await controller.rebase('client-uuid', 'agent-uuid', dto, mockReq);

      expect(proxyService.rebase).toHaveBeenCalledWith('client-uuid', 'agent-uuid', dto);
    });
  });

  describe('switchBranch', () => {
    it('should switch branch', async () => {
      proxyService.switchBranch.mockResolvedValue(undefined);

      const mockReq = { apiKeyAuthenticated: true } as any;

      await controller.switchBranch('client-uuid', 'agent-uuid', 'develop', mockReq);

      expect(proxyService.switchBranch).toHaveBeenCalledWith('client-uuid', 'agent-uuid', 'develop');
    });
  });

  describe('createBranch', () => {
    it('should create branch', async () => {
      const dto: CreateBranchDto = {
        name: 'feature-branch',
        baseBranch: 'main',
      };

      proxyService.createBranch.mockResolvedValue(undefined);

      const mockReq = { apiKeyAuthenticated: true } as any;

      await controller.createBranch('client-uuid', 'agent-uuid', dto, mockReq);

      expect(proxyService.createBranch).toHaveBeenCalledWith('client-uuid', 'agent-uuid', dto);
    });
  });

  describe('deleteBranch', () => {
    it('should delete branch', async () => {
      proxyService.deleteBranch.mockResolvedValue(undefined);

      const mockReq = { apiKeyAuthenticated: true } as any;

      await controller.deleteBranch('client-uuid', 'agent-uuid', 'feature-branch', mockReq);

      expect(proxyService.deleteBranch).toHaveBeenCalledWith('client-uuid', 'agent-uuid', 'feature-branch');
    });
  });

  describe('resolveConflict', () => {
    it('should resolve conflict', async () => {
      const dto: ResolveConflictDto = {
        path: 'src/file.ts',
        strategy: 'yours',
      };

      proxyService.resolveConflict.mockResolvedValue(undefined);

      const mockReq = { apiKeyAuthenticated: true } as any;

      await controller.resolveConflict('client-uuid', 'agent-uuid', dto, mockReq);

      expect(proxyService.resolveConflict).toHaveBeenCalledWith('client-uuid', 'agent-uuid', dto);
    });
  });

  describe('permission checks', () => {
    it('should throw ForbiddenException when user does not have access', async () => {
      mockClientsRepository.findById.mockResolvedValue({ id: 'client-uuid', userId: 'other-user-id' });
      mockClientUsersRepository.findUserClientAccess.mockResolvedValue(null);

      const mockReq = { apiKeyAuthenticated: false, user: { id: 'user-uuid', roles: ['user'] } } as any;

      await expect(controller.getStatus('client-uuid', 'agent-uuid', mockReq)).rejects.toThrow(ForbiddenException);
      expect(proxyService.getStatus).not.toHaveBeenCalled();
    });
  });
});
