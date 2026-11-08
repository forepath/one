jest.mock('@forepath/identity/backend', () => {
  const actual = jest.requireActual('@forepath/identity/backend') as Record<string, unknown>;

  return {
    ...actual,
    getUserFromRequest: jest.fn(),
  };
});

import * as identity from '@forepath/identity/backend';
import { ForbiddenException, NotFoundException } from '@nestjs/common';

import { CreateAtlassianSiteConnectionDto } from '../dto/context-import/create-atlassian-site-connection.dto';
import { CreateExternalImportConfigDto } from '../dto/context-import/create-external-import-config.dto';
import { UpdateAtlassianSiteConnectionDto } from '../dto/context-import/update-atlassian-site-connection.dto';
import { UpdateExternalImportConfigDto } from '../dto/context-import/update-external-import-config.dto';
import { ExternalImportKind, ExternalImportProviderId } from '../entities/external-import.enums';
import { AtlassianImportProvider } from '../providers/import/atlassian-external-import.provider';
import { AtlassianSiteConnectionService } from '../services/atlassian-site-connection.service';
import { ContextImportOrchestratorService } from '../services/context-import-orchestrator.service';
import { ExternalImportConfigService } from '../services/external-import-config.service';
import { ExternalImportSyncMarkerService } from '../services/external-import-sync-marker.service';

import { ContextImportController } from './context-import.controller';

const getUserFromRequestMock = identity.getUserFromRequest as jest.MockedFunction<typeof identity.getUserFromRequest>;

describe('ContextImportController', () => {
  const connections = {
    findAll: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    recordTestResult: jest.fn(),
  } as unknown as AtlassianSiteConnectionService;
  const configs = {
    findAll: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  } as unknown as ExternalImportConfigService;
  const orchestrator = {
    runConfigById: jest.fn(),
  } as unknown as ContextImportOrchestratorService;
  const markers = {
    deleteAllForConfig: jest.fn(),
  } as unknown as ExternalImportSyncMarkerService;
  const atlassianProvider = {
    testConnection: jest.fn(),
  } as unknown as AtlassianImportProvider;
  const adminReq = {} as Parameters<ContextImportController['listConnections']>[0];
  const connectionId = '123e4567-e89b-42d3-a456-426614174000';
  const configId = '223e4567-e89b-42d3-a456-426614174001';
  const clientId = '323e4567-e89b-42d3-a456-426614174002';
  let controller: ContextImportController;

  beforeEach(() => {
    jest.clearAllMocks();
    getUserFromRequestMock.mockReturnValue({
      userId: 'user-1',
      userRole: identity.UserRole.ADMIN,
      isApiKeyAuth: false,
    } as identity.UserInfoFromRequest);
    controller = new ContextImportController(connections, configs, orchestrator, markers, atlassianProvider);
  });

  describe('authorization', () => {
    it('throws ForbiddenException for non-admin session users', async () => {
      getUserFromRequestMock.mockReturnValueOnce({
        userId: 'user-1',
        userRole: identity.UserRole.USER,
        isApiKeyAuth: false,
      } as identity.UserInfoFromRequest);

      await expect(controller.listConnections(adminReq)).rejects.toThrow(ForbiddenException);
      expect(connections.findAll).not.toHaveBeenCalled();
    });

    it('allows API key authentication without admin role', async () => {
      getUserFromRequestMock.mockReturnValueOnce({
        isApiKeyAuth: true,
      } as identity.UserInfoFromRequest);
      (connections.findAll as jest.Mock).mockResolvedValue([]);

      await controller.listConnections(adminReq);

      expect(connections.findAll).toHaveBeenCalledWith(10, 0, undefined);
    });

    it('allows PAT admin sessions through assertAdmin and relies on RequireScopes for PAT scope enforcement', async () => {
      getUserFromRequestMock.mockReturnValueOnce({
        userId: 'user-1',
        userRole: identity.UserRole.ADMIN,
        isApiKeyAuth: false,
        amr: ['pat'],
      } as identity.UserInfoFromRequest);
      (connections.findAll as jest.Mock).mockResolvedValue([]);

      await controller.listConnections(adminReq);
      expect(connections.findAll).toHaveBeenCalledWith(10, 0, undefined);
    });
  });

  describe('listConnections pagination', () => {
    it('uses default limit 10 and offset 0 when query params omitted', async () => {
      (connections.findAll as jest.Mock).mockResolvedValue([]);

      await controller.listConnections(adminReq, undefined, undefined);

      expect(connections.findAll).toHaveBeenCalledWith(10, 0, undefined);
    });

    it('forwards limit, offset, and search to the service', async () => {
      (connections.findAll as jest.Mock).mockResolvedValue([]);

      await controller.listConnections(adminReq, 25, 100, 'wiki');

      expect(connections.findAll).toHaveBeenCalledWith(25, 100, 'wiki');
    });
  });

  describe('listConfigs pagination', () => {
    it('uses default limit 10 and offset 0 when query params omitted', async () => {
      (configs.findAll as jest.Mock).mockResolvedValue([]);

      await controller.listConfigs(adminReq, undefined, undefined);

      expect(configs.findAll).toHaveBeenCalledWith(10, 0, undefined);
    });

    it('forwards limit, offset, and search to the service', async () => {
      (configs.findAll as jest.Mock).mockResolvedValue([]);

      await controller.listConfigs(adminReq, 25, 100, 'jira');

      expect(configs.findAll).toHaveBeenCalledWith(25, 100, 'jira');
    });
  });

  describe('connections CRUD and test', () => {
    it('getConnection delegates to service', async () => {
      const dto = { id: connectionId } as never;

      (connections.findOne as jest.Mock).mockResolvedValue(dto);

      await expect(controller.getConnection(connectionId, adminReq)).resolves.toBe(dto);
      expect(connections.findOne).toHaveBeenCalledWith(connectionId);
    });

    it('createConnection delegates to service', async () => {
      const body: CreateAtlassianSiteConnectionDto = {
        baseUrl: 'https://example.atlassian.net',
        accountEmail: 'a@b.com',
        apiToken: 'secret',
      };
      const created = { id: connectionId } as never;

      (connections.create as jest.Mock).mockResolvedValue(created);

      await expect(controller.createConnection(body, adminReq)).resolves.toBe(created);
      expect(connections.create).toHaveBeenCalledWith(body);
    });

    it('updateConnection delegates to service', async () => {
      const body: UpdateAtlassianSiteConnectionDto = { label: 'L' };
      const updated = { id: connectionId } as never;

      (connections.update as jest.Mock).mockResolvedValue(updated);

      await expect(controller.updateConnection(connectionId, body, adminReq)).resolves.toBe(updated);
      expect(connections.update).toHaveBeenCalledWith(connectionId, body);
    });

    it('deleteConnection delegates to service', async () => {
      (connections.delete as jest.Mock).mockResolvedValue(undefined);

      await expect(controller.deleteConnection(connectionId, adminReq)).resolves.toBeUndefined();
      expect(connections.delete).toHaveBeenCalledWith(connectionId);
    });

    it('testConnection runs the provider test and persists the result', async () => {
      const result = { ok: false, message: 'Jira HTTP 401, Confluence HTTP 401' };
      const recorded = { ...result, testedAt: '2026-01-01T00:00:00.000Z' };

      (connections.findOne as jest.Mock).mockResolvedValue({ id: connectionId });
      (atlassianProvider.testConnection as jest.Mock).mockResolvedValue(result);
      (connections.recordTestResult as jest.Mock).mockResolvedValue(recorded);

      await expect(controller.testConnection(connectionId, adminReq)).resolves.toEqual(recorded);
      expect(atlassianProvider.testConnection).toHaveBeenCalledWith(connectionId);
      expect(connections.recordTestResult).toHaveBeenCalledWith(connectionId, result);
    });

    it('testConnection does not call the provider for unknown connections', async () => {
      (connections.findOne as jest.Mock).mockRejectedValue(new NotFoundException('Connection not found'));

      await expect(controller.testConnection(connectionId, adminReq)).rejects.toBeInstanceOf(NotFoundException);
      expect(atlassianProvider.testConnection).not.toHaveBeenCalled();
    });

    it('is mounted at connections/atlassian', () => {
      expect(Reflect.getMetadata('path', ContextImportController)).toBe('connections/atlassian');
    });
  });

  describe('configs CRUD, run, and markers', () => {
    it('getConfig delegates to service', async () => {
      const dto = { id: configId } as never;

      (configs.findOne as jest.Mock).mockResolvedValue(dto);

      await expect(controller.getConfig(configId, adminReq)).resolves.toBe(dto);
      expect(configs.findOne).toHaveBeenCalledWith(configId);
    });

    it('createConfig delegates to service', async () => {
      const body: CreateExternalImportConfigDto = {
        provider: ExternalImportProviderId.ATLASSIAN,
        importKind: ExternalImportKind.CONFLUENCE,
        atlassianConnectionId: connectionId,
        clientId,
      };
      const created = { id: configId } as never;

      (configs.create as jest.Mock).mockResolvedValue(created);

      await expect(controller.createConfig(body, adminReq)).resolves.toBe(created);
      expect(configs.create).toHaveBeenCalledWith(body);
    });

    it('updateConfig delegates to service', async () => {
      const body: UpdateExternalImportConfigDto = { enabled: false };
      const updated = { id: configId } as never;

      (configs.update as jest.Mock).mockResolvedValue(updated);

      await expect(controller.updateConfig(configId, body, adminReq)).resolves.toBe(updated);
      expect(configs.update).toHaveBeenCalledWith(configId, body);
    });

    it('deleteConfig delegates to service', async () => {
      (configs.delete as jest.Mock).mockResolvedValue(undefined);

      await expect(controller.deleteConfig(configId, adminReq)).resolves.toBeUndefined();
      expect(configs.delete).toHaveBeenCalledWith(configId);
    });

    it('runConfig delegates to orchestrator', async () => {
      (orchestrator.runConfigById as jest.Mock).mockResolvedValue(undefined);

      await expect(controller.runConfig(configId, adminReq)).resolves.toBeUndefined();
      expect(orchestrator.runConfigById).toHaveBeenCalledWith(configId);
    });

    it('clearMarkers delegates to marker service', async () => {
      (markers.deleteAllForConfig as jest.Mock).mockResolvedValue(undefined);

      await expect(controller.clearMarkers(configId, adminReq)).resolves.toBeUndefined();
      expect(markers.deleteAllForConfig).toHaveBeenCalledWith(configId);
    });
  });
});
