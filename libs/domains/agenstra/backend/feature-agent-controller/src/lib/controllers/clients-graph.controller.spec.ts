import * as identity from '@forepath/identity/backend';
import { ClientUsersRepository, type RequestWithUser } from '@forepath/identity/backend';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { ClientsRepository } from '../repositories/clients.repository';
import { ClientAgentGraphProxyService } from '../services/client-agent-graph-proxy.service';
import { ClientsService } from '../services/clients.service';
import { WorkspaceGraphSnapshotService } from '../services/workspace-graph-snapshot.service';
import { WorkspaceGraphViewService } from '../services/workspace-graph-view.service';

import { ClientsGraphController } from './clients-graph.controller';

jest.mock('@forepath/identity/backend', () => {
  const actual = jest.requireActual('@forepath/identity/backend');

  return {
    ...actual,
    ensureClientAccess: jest.fn().mockResolvedValue(undefined),
  };
});

const CLIENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const AGENT_ID = '11111111-1111-4111-8111-111111111111';

function patRequest(scopes: string[]): RequestWithUser {
  return { user: { id: 'user-1', roles: ['user'], amr: ['pat'], scopes } } as RequestWithUser;
}

const interactiveRequest = { user: { id: 'user-1', roles: ['user'], amr: ['pwd'] } } as RequestWithUser;

describe('ClientsGraphController', () => {
  let controller: ClientsGraphController;
  const graphProxy = {
    getStatus: jest.fn().mockResolvedValue({ status: 'ready' }),
    getOverview: jest.fn(),
    getDocument: jest.fn().mockResolvedValue({ nodes: [], edges: [] }),
    search: jest.fn().mockResolvedValue({ hits: [] }),
    getNode: jest.fn().mockResolvedValue({}),
    getNeighbors: jest.fn().mockResolvedValue({}),
    getPath: jest.fn().mockResolvedValue({}),
    getFile: jest.fn(),
    getReferences: jest.fn().mockResolvedValue({ prompts: [] }),
    refresh: jest.fn().mockResolvedValue({ queued: true }),
    compose: jest.fn(),
  };
  const snapshots = {
    listMemberAgentIds: jest.fn(),
    resolveEnvironmentNames: jest.fn(),
    getWorkspaceDocument: jest.fn().mockResolvedValue({ nodes: [] }),
    build: jest.fn().mockResolvedValue({ status: 'ready' }),
    refresh: jest.fn().mockResolvedValue({ status: 'ready' }),
    getGlobalDocument: jest.fn().mockResolvedValue({ nodes: [] }),
    getStatuses: jest.fn().mockResolvedValue([]),
  };
  const views = { page: jest.fn().mockResolvedValue({ nodes: [], edges: [] }) };
  const clientsService = { getAccessibleClientIds: jest.fn() };
  const clientsRepository = { findById: jest.fn().mockResolvedValue({ id: CLIENT_ID, name: 'Workspace' }) };
  const ensureClientAccess = identity.ensureClientAccess as jest.Mock;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ClientsGraphController],
      providers: [
        { provide: ClientAgentGraphProxyService, useValue: graphProxy },
        { provide: WorkspaceGraphSnapshotService, useValue: snapshots },
        { provide: WorkspaceGraphViewService, useValue: views },
        { provide: ClientsService, useValue: clientsService },
        { provide: ClientsRepository, useValue: clientsRepository },
        { provide: ClientUsersRepository, useValue: {} },
      ],
    }).compile();

    controller = module.get(ClientsGraphController);
  });

  describe('access checks', () => {
    it.each([
      ['status', () => controller.getEnvironmentGraphStatus(CLIENT_ID, AGENT_ID, interactiveRequest)],
      [
        'document',
        () =>
          controller.getEnvironmentGraph(
            CLIENT_ID,
            AGENT_ID,
            undefined,
            undefined,
            undefined,
            undefined,
            interactiveRequest,
          ),
      ],
      [
        'references',
        () => controller.getEnvironmentGraphReferences(CLIENT_ID, AGENT_ID, undefined, undefined, interactiveRequest),
      ],
      ['refresh', () => controller.refreshEnvironmentGraph(CLIENT_ID, AGENT_ID, interactiveRequest)],
      ['snapshot', () => controller.getWorkspaceGraphSnapshot(CLIENT_ID, interactiveRequest)],
      ['snapshot refresh', () => controller.refreshWorkspaceGraphSnapshot(CLIENT_ID, interactiveRequest)],
    ])('checks workspace access for %s', async (_name, call) => {
      await call();

      expect(ensureClientAccess).toHaveBeenCalledWith(clientsRepository, {}, CLIENT_ID, interactiveRequest);
    });

    it('does not proxy when workspace access is denied', async () => {
      ensureClientAccess.mockRejectedValueOnce(new ForbiddenException());

      await expect(controller.getEnvironmentGraphStatus(CLIENT_ID, AGENT_ID, interactiveRequest)).rejects.toThrow(
        ForbiddenException,
      );
      expect(graphProxy.getStatus).not.toHaveBeenCalled();
    });
  });

  describe('PAT scope enforcement', () => {
    it('requires agent_files:read for code graphs', async () => {
      await expect(
        controller.getEnvironmentGraph(
          CLIENT_ID,
          AGENT_ID,
          'code',
          undefined,
          undefined,
          undefined,
          patRequest(['graph:read']),
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(graphProxy.getDocument).not.toHaveBeenCalled();

      await controller.getEnvironmentGraph(
        CLIENT_ID,
        AGENT_ID,
        'code',
        '10',
        undefined,
        '20',
        patRequest(['graph:read', 'agent_files:read']),
      );
      expect(graphProxy.getDocument).toHaveBeenCalledWith(CLIENT_ID, AGENT_ID, {
        layer: 'code',
        limit: '10',
        types: undefined,
        offset: '20',
      });

      // `all` includes prompt references.
      await expect(
        controller.getEnvironmentGraph(
          CLIENT_ID,
          AGENT_ID,
          'all',
          undefined,
          undefined,
          undefined,
          patRequest(['graph:read', 'agent_files:read']),
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('requires agent_chats:read for the references layer', async () => {
      await expect(
        controller.searchEnvironmentGraph(
          CLIENT_ID,
          AGENT_ID,
          'foo',
          'references',
          undefined,
          undefined,
          patRequest(['graph:read', 'agent_files:read']),
        ),
      ).rejects.toThrow(ForbiddenException);

      await controller.searchEnvironmentGraph(
        CLIENT_ID,
        AGENT_ID,
        'foo',
        'references',
        undefined,
        undefined,
        patRequest(['graph:read', 'agent_files:read', 'agent_chats:read']),
      );
      expect(graphProxy.search).toHaveBeenCalled();
    });

    it('rejects unknown layers', async () => {
      await expect(
        controller.getEnvironmentGraphNode(CLIENT_ID, AGENT_ID, 'file:a', 'bogus', interactiveRequest),
      ).rejects.toThrow(BadRequestException);
    });

    it('requires agent_chats:read for prompt references', async () => {
      await expect(
        controller.getEnvironmentGraphReferences(CLIENT_ID, AGENT_ID, undefined, undefined, patRequest(['graph:read'])),
      ).rejects.toThrow(ForbiddenException);

      await controller.getEnvironmentGraphReferences(
        CLIENT_ID,
        AGENT_ID,
        'p-1',
        '5',
        patRequest(['graph:read', 'agent_chats:read']),
      );
      expect(graphProxy.getReferences).toHaveBeenCalledWith(CLIENT_ID, AGENT_ID, { promptId: 'p-1', limit: '5' });
    });

    it('strips prompt data from overview and file responses without agent_chats:read', async () => {
      graphProxy.getOverview.mockResolvedValue({ modules: [], recentPrompts: [{ id: 'p' }] });
      graphProxy.getFile.mockResolvedValue({ path: 'a.ts', prompts: [{ id: 'p' }] });

      const overview = await controller.getEnvironmentGraphOverview(
        CLIENT_ID,
        AGENT_ID,
        patRequest(['graph:read', 'agent_files:read']),
      );
      const file = await controller.getEnvironmentGraphFile(
        CLIENT_ID,
        AGENT_ID,
        'a.ts',
        patRequest(['graph:read', 'agent_files:read']),
      );

      expect(overview.recentPrompts).toBeUndefined();
      expect(file.prompts).toEqual([]);

      const interactive = await controller.getEnvironmentGraphOverview(CLIENT_ID, AGENT_ID, interactiveRequest);

      expect(interactive.recentPrompts).toEqual([{ id: 'p' }]);
    });

    it('requires agent_files:read for overview, file, neighbors and path', async () => {
      const req = patRequest(['graph:read']);

      await expect(controller.getEnvironmentGraphOverview(CLIENT_ID, AGENT_ID, req)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(controller.getEnvironmentGraphFile(CLIENT_ID, AGENT_ID, 'a.ts', req)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(
        controller.getEnvironmentGraphNeighbors(CLIENT_ID, AGENT_ID, 'file:a', undefined, undefined, undefined, req),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        controller.getEnvironmentGraphPath(CLIENT_ID, AGENT_ID, 'file:a', 'file:b', undefined, req),
      ).rejects.toThrow(ForbiddenException);
    });

    it('passes a scope filter to snapshot and global graphs', async () => {
      clientsService.getAccessibleClientIds.mockResolvedValue([CLIENT_ID]);

      await controller.getWorkspaceGraphSnapshot(CLIENT_ID, patRequest(['graph:read', 'tickets:read']));
      const snapshotCheck = snapshots.getWorkspaceDocument.mock.calls[0][1] as (scope: string) => boolean;

      expect(snapshotCheck('tickets:read')).toBe(true);
      expect(snapshotCheck('knowledge:read')).toBe(false);

      await controller.getGlobalGraph('knowledge', '100', '200', patRequest(['graph:read']));
      const request = views.page.mock.calls[0][0] as {
        scope: string;
        clientIds: string[];
        layer: string;
        limit: number;
        offset: number;
        isAllowed: (scope: string) => boolean;
      };

      expect(request).toEqual(
        expect.objectContaining({
          scope: 'global',
          clientIds: [CLIENT_ID],
          layer: 'knowledge',
          limit: 100,
          offset: 200,
        }),
      );
      expect(request.isAllowed('agent_files:read')).toBe(false);
    });
  });

  describe('global graph', () => {
    it('unions only the workspaces the caller can access, `all` layer by default', async () => {
      clientsService.getAccessibleClientIds.mockResolvedValue([CLIENT_ID]);

      await controller.getGlobalGraph(undefined, undefined, undefined, interactiveRequest);

      expect(clientsService.getAccessibleClientIds).toHaveBeenCalledWith('user-1', identity.UserRole.USER, false, {
        amr: ['pwd'],
      });
      expect(views.page).toHaveBeenCalledWith(
        expect.objectContaining({ scope: 'global', clientIds: [CLIENT_ID], layer: 'all', offset: 0 }),
      );
    });

    it('requires the scopes of the layer for PAT callers', async () => {
      clientsService.getAccessibleClientIds.mockResolvedValue([CLIENT_ID]);

      await expect(controller.getGlobalGraph('all', undefined, undefined, patRequest(['graph:read']))).rejects.toThrow(
        ForbiddenException,
      );
      await expect(
        controller.getGlobalGraph('code', undefined, undefined, patRequest(['graph:read', 'agent_files:read'])),
      ).resolves.toBeDefined();
      await expect(controller.getGlobalGraph('bogus', undefined, undefined, interactiveRequest)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('uses all workspaces for API key callers', async () => {
      clientsService.getAccessibleClientIds.mockResolvedValue([CLIENT_ID, 'other']);

      await controller.getGlobalGraphStatus({ apiKeyAuthenticated: true } as RequestWithUser);

      expect(clientsService.getAccessibleClientIds).toHaveBeenCalledWith(undefined, undefined, true, {
        amr: undefined,
      });
      expect(snapshots.getStatuses).toHaveBeenCalledWith([CLIENT_ID, 'other']);
    });
  });

  describe('workspace graph', () => {
    it('serves pages of the requested layer for this workspace only', async () => {
      await controller.getWorkspaceGraph(CLIENT_ID, 'paths', '50', '100', interactiveRequest);

      expect(ensureClientAccess).toHaveBeenCalled();
      expect(views.page).toHaveBeenCalledWith(
        expect.objectContaining({ scope: 'workspace', clientIds: [CLIENT_ID], layer: 'paths', limit: 50, offset: 100 }),
      );
    });

    it('requires agent_files:read for PAT callers on code layers', async () => {
      await expect(
        controller.getWorkspaceGraph(CLIENT_ID, 'code', undefined, undefined, patRequest(['graph:read'])),
      ).rejects.toThrow(ForbiddenException);
      expect(views.page).not.toHaveBeenCalled();

      // The knowledge layer is filtered node by node instead.
      await controller.getWorkspaceGraph(CLIENT_ID, 'knowledge', undefined, undefined, patRequest(['graph:read']));
      expect(views.page).toHaveBeenCalled();
    });
  });
});
