import {
  GitBranchDto,
  GitStatusDto,
  PrepareCleanWorkspaceDto,
  RunVerifierCommandsDto,
  RunVerifierCommandsResponseDto,
} from '@forepath/framework/backend/feature-agent-manager';
import { AuthenticationType, ClientEntity } from '@forepath/identity/backend';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import axios, { AxiosError } from 'axios';

import { ClientsRepository } from '../repositories/clients.repository';

import { AgentConsoleStatusService } from './agent-console-status.service';
import { ClientAgentVcsProxyService } from './client-agent-vcs-proxy.service';
import { ClientsService } from './clients.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('ClientAgentVcsProxyService', () => {
  let service: ClientAgentVcsProxyService;
  let clientsService: jest.Mocked<ClientsService>;
  let clientsRepository: jest.Mocked<ClientsRepository>;
  const mockClientId = 'test-client-uuid';
  const mockAgentId = 'test-agent-uuid';
  const mockClientEntity: ClientEntity = {
    id: mockClientId,
    name: 'Test Client',
    description: 'Test Description',
    endpoint: 'https://example.com',
    authenticationType: AuthenticationType.API_KEY,
    apiKey: 'test-api-key',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };
  const mockClientsService = {
    getAccessToken: jest.fn(),
  };
  const mockClientsRepository = {
    findByIdOrThrow: jest.fn(),
  };
  const mockAgentConsoleStatusService = {
    notifyVcsStateChanged: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientAgentVcsProxyService,
        { provide: ClientsService, useValue: mockClientsService },
        { provide: ClientsRepository, useValue: mockClientsRepository },
        { provide: AgentConsoleStatusService, useValue: mockAgentConsoleStatusService },
      ],
    }).compile();

    service = module.get<ClientAgentVcsProxyService>(ClientAgentVcsProxyService);
    clientsService = module.get(ClientsService);
    clientsRepository = module.get(ClientsRepository);

    jest.clearAllMocks();
  });

  describe('getStatus', () => {
    it('should proxy GET /status with API_KEY auth', async () => {
      const status: GitStatusDto = {
        currentBranch: 'main',
        isClean: true,
        hasUnpushedCommits: false,
        aheadCount: 0,
        behindCount: 0,
        files: [],
      };

      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({ status: 200, data: status } as any);

      const result = await service.getStatus(mockClientId, mockAgentId);

      expect(result).toEqual(status);
      expect(clientsRepository.findByIdOrThrow).toHaveBeenCalledWith(mockClientId);
      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
          url: `https://example.com/api/agents/${mockAgentId}/vcs/status`,
          headers: expect.objectContaining({
            Authorization: 'Bearer test-api-key',
          }),
        }),
      );
    });

    it('should use KEYCLOAK token when configured', async () => {
      const keycloakClient = {
        ...mockClientEntity,
        authenticationType: AuthenticationType.KEYCLOAK,
        apiKey: undefined,
      };

      clientsRepository.findByIdOrThrow.mockResolvedValue(keycloakClient);
      clientsService.getAccessToken.mockResolvedValue('jwt-token');
      mockedAxios.request.mockResolvedValue({
        status: 200,
        data: {
          currentBranch: 'main',
          isClean: true,
          hasUnpushedCommits: false,
          aheadCount: 0,
          behindCount: 0,
          files: [],
        },
      } as any);

      await service.getStatus(mockClientId, mockAgentId);

      expect(clientsService.getAccessToken).toHaveBeenCalledWith(mockClientId);
      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer jwt-token' }),
        }),
      );
    });

    it('should throw NotFoundException when remote returns 404', async () => {
      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({
        status: 404,
        data: { message: 'Agent not found' },
      } as any);

      await expect(service.getStatus(mockClientId, mockAgentId)).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when remote returns 400', async () => {
      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({
        status: 400,
        data: { message: 'Dirty tree' },
      } as any);

      await expect(service.getStatus(mockClientId, mockAgentId)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when API key is missing for API_KEY client', async () => {
      const noKey = { ...mockClientEntity, apiKey: undefined };

      clientsRepository.findByIdOrThrow.mockResolvedValue(noKey);

      await expect(service.getStatus(mockClientId, mockAgentId)).rejects.toThrow(BadRequestException);
      expect(mockedAxios.request).not.toHaveBeenCalled();
    });

    it('should map axios network error to BadRequestException', async () => {
      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      const err = new AxiosError('Network Error');

      err.request = {};
      mockedAxios.request.mockRejectedValue(err);

      await expect(service.getStatus(mockClientId, mockAgentId)).rejects.toThrow(BadRequestException);
    });
  });

  describe('getFileDiff', () => {
    it('should pass path as query param', async () => {
      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({
        status: 200,
        data: {
          path: 'src/a.ts',
          originalContent: '',
          modifiedContent: '',
          encoding: 'utf-8',
          isBinary: false,
        },
      } as any);

      await service.getFileDiff(mockClientId, mockAgentId, 'src/a.ts');

      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
          url: `https://example.com/api/agents/${mockAgentId}/vcs/diff`,
          params: { path: 'src/a.ts' },
        }),
      );
    });
  });

  describe('switchBranch', () => {
    it('should encode branch name in URL path', async () => {
      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({ status: 204, data: undefined } as any);

      await service.switchBranch(mockClientId, mockAgentId, 'feature/foo bar');

      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          url: `https://example.com/api/agents/${mockAgentId}/vcs/branches/${encodeURIComponent('feature/foo bar')}/switch`,
        }),
      );
      expect(mockAgentConsoleStatusService.notifyVcsStateChanged).toHaveBeenCalledWith(mockClientId, mockAgentId);
    });
  });

  describe('git state notifications', () => {
    it('should notify status socket after successful push', async () => {
      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({ status: 204, data: undefined } as any);

      await service.push(mockClientId, mockAgentId, { force: true });

      expect(mockAgentConsoleStatusService.notifyVcsStateChanged).toHaveBeenCalledWith(mockClientId, mockAgentId);
    });

    it('should notify status socket after successful fetch', async () => {
      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({ status: 204, data: undefined } as any);

      await service.fetch(mockClientId, mockAgentId);

      expect(mockAgentConsoleStatusService.notifyVcsStateChanged).toHaveBeenCalledWith(mockClientId, mockAgentId);
    });

    it('should not notify status socket when getStatus fails', async () => {
      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({
        status: 404,
        data: { message: 'Agent not found' },
      } as any);

      await expect(service.getStatus(mockClientId, mockAgentId)).rejects.toThrow(NotFoundException);
      expect(mockAgentConsoleStatusService.notifyVcsStateChanged).not.toHaveBeenCalled();
    });

    it('should not notify status socket when push fails', async () => {
      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({
        status: 400,
        data: { message: 'Push rejected' },
      } as any);

      await expect(service.push(mockClientId, mockAgentId)).rejects.toThrow(BadRequestException);
      expect(mockAgentConsoleStatusService.notifyVcsStateChanged).not.toHaveBeenCalled();
    });
  });

  describe('prepareCleanWorkspace', () => {
    it('should POST to vcs workspace/prepare-clean', async () => {
      const body: PrepareCleanWorkspaceDto = { baseBranch: 'main' };

      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({ status: 204, data: undefined } as any);

      await service.prepareCleanWorkspace(mockClientId, mockAgentId, body);

      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          url: `https://example.com/api/agents/${mockAgentId}/vcs/workspace/prepare-clean`,
          data: body,
        }),
      );
      expect(mockAgentConsoleStatusService.notifyVcsStateChanged).toHaveBeenCalledWith(mockClientId, mockAgentId);
    });
  });

  describe('additional git mutations', () => {
    beforeEach(() => {
      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({ status: 204, data: undefined } as any);
    });

    it('notifies after pull and commit', async () => {
      await service.pull(mockClientId, mockAgentId);
      await service.commit(mockClientId, mockAgentId, { message: 'feat: test' });

      expect(mockAgentConsoleStatusService.notifyVcsStateChanged).toHaveBeenCalledTimes(2);
    });

    it('notifies after stage and unstage', async () => {
      await service.stageFiles(mockClientId, mockAgentId, { files: ['a.ts'] });
      await service.unstageFiles(mockClientId, mockAgentId, { files: ['a.ts'] });

      expect(mockAgentConsoleStatusService.notifyVcsStateChanged).toHaveBeenCalledTimes(2);
    });
  });

  describe('auth and error handling', () => {
    it('throws for unsupported authentication type', async () => {
      clientsRepository.findByIdOrThrow.mockResolvedValue({
        ...mockClientEntity,
        authenticationType: 'unknown' as AuthenticationType,
      });

      await expect(service.getStatus(mockClientId, mockAgentId)).rejects.toThrow(BadRequestException);
    });

    it('maps non-404/400 HTTP status to BadRequestException', async () => {
      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({
        status: 403,
        data: { message: 'Forbidden' },
      } as any);

      await expect(service.getStatus(mockClientId, mockAgentId)).rejects.toThrow('Request failed: Forbidden');
    });

    it('maps axios response errors with non-400 status', async () => {
      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      const err = new AxiosError('Forbidden');

      err.response = { status: 403, data: { message: 'denied' } } as never;
      mockedAxios.request.mockRejectedValue(err);

      await expect(service.getStatus(mockClientId, mockAgentId)).rejects.toThrow('Request failed: denied');
    });

    it('maps axios setup errors', async () => {
      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      const err = new AxiosError('Invalid config');

      mockedAxios.request.mockRejectedValue(err);

      await expect(service.getStatus(mockClientId, mockAgentId)).rejects.toThrow('Request setup failed');
    });

    it('logs when status notification fails after mutation', async () => {
      const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);

      mockAgentConsoleStatusService.notifyVcsStateChanged.mockRejectedValue(new Error('socket down'));
      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({ status: 204, data: undefined } as any);

      await service.fetch(mockClientId, mockAgentId);

      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to publish status patch'));
      warnSpy.mockRestore();
    });
  });

  describe('runVerifierCommands', () => {
    it('should POST to automation verify-commands', async () => {
      const body: RunVerifierCommandsDto = {
        commands: [{ cmd: 'npm test' }],
        timeoutMs: 60_000,
      };
      const response: RunVerifierCommandsResponseDto = {
        results: [{ cmd: 'npm test', exitCode: 0, output: 'ok' }],
      };

      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({ status: 200, data: response } as any);

      const result = await service.runVerifierCommands(mockClientId, mockAgentId, body);

      expect(result).toEqual(response);
      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          url: `https://example.com/api/agents/${mockAgentId}/automation/verify-commands`,
          data: body,
        }),
      );
    });
  });

  describe('getBranches', () => {
    it('should proxy GET /branches', async () => {
      const branches: GitBranchDto[] = [
        {
          name: 'main',
          ref: 'refs/heads/main',
          isCurrent: true,
          isRemote: false,
          commit: 'abc1234',
          message: 'init',
        },
      ];

      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({ status: 200, data: branches } as any);

      const result = await service.getBranches(mockClientId, mockAgentId);

      expect(result).toEqual(branches);
      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
          url: `https://example.com/api/agents/${mockAgentId}/vcs/branches`,
        }),
      );
    });
  });
});
