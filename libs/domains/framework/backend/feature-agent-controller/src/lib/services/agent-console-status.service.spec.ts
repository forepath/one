import { ClientUsersRepository, UserRole } from '@forepath/identity/backend';
import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { ClientsRepository } from '../repositories/clients.repository';
import { TicketAutomationRunsStatusRepository } from '../repositories/ticket-automation-runs-status.repository';
import { UserEnvironmentReadStateRepository } from '../repositories/user-environment-read-state.repository';

import { AgentConsoleStatusRealtimeService } from './agent-console-status-realtime.service';
import { AgentConsoleStatusService } from './agent-console-status.service';
import { ClientAgentMessagesProxyService } from './client-agent-messages-proxy.service';
import { ClientAgentProxyService } from './client-agent-proxy.service';
import { ClientAgentVcsProxyService } from './client-agent-vcs-proxy.service';
import { ClientsService } from './clients.service';

describe('AgentConsoleStatusService', () => {
  let service: AgentConsoleStatusService;
  const clientsService = {
    getAccessibleClientIds: jest.fn().mockResolvedValue(['client-1']),
  };
  const clientsRepository = {
    findById: jest.fn().mockResolvedValue({ id: 'client-1', userId: 'user-1' }),
  };
  const clientUsersRepository = {
    findByClientId: jest.fn().mockResolvedValue([]),
    findUserClientAccess: jest.fn().mockResolvedValue({ role: 'user' }),
  };
  const readStateRepository = {
    findByUserAndClientIds: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    upsertReadState: jest.fn().mockResolvedValue({}),
  };
  const automationRunsStatusRepository = {
    findLatestUpdatedAtByClient: jest.fn().mockResolvedValue(new Map()),
  };
  const messagesProxy = {
    getLatestAgentMessage: jest.fn().mockResolvedValue({
      id: 'msg-1',
      createdAt: new Date('2026-01-02T00:00:00.000Z').toISOString(),
    }),
  };
  const vcsProxy = {
    getStatus: jest.fn().mockResolvedValue({
      isClean: false,
      hasUnpushedCommits: false,
      files: [{ status: 'M', path: 'a.ts' }],
    }),
  };
  const agentProxy = {
    getClientAgents: jest.fn().mockResolvedValue([{ id: 'agent-1' }]),
  };
  const realtime = {
    emitToUser: jest.fn(),
    getUserIdForSocket: jest.fn(),
    getConnectedUserIds: jest.fn().mockReturnValue([]),
    getUserRole: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentConsoleStatusService,
        { provide: ClientsService, useValue: clientsService },
        { provide: ClientsRepository, useValue: clientsRepository },
        { provide: ClientUsersRepository, useValue: clientUsersRepository },
        { provide: UserEnvironmentReadStateRepository, useValue: readStateRepository },
        { provide: TicketAutomationRunsStatusRepository, useValue: automationRunsStatusRepository },
        { provide: ClientAgentMessagesProxyService, useValue: messagesProxy },
        { provide: ClientAgentVcsProxyService, useValue: vcsProxy },
        { provide: ClientAgentProxyService, useValue: agentProxy },
        { provide: AgentConsoleStatusRealtimeService, useValue: realtime },
      ],
    }).compile();

    service = module.get(AgentConsoleStatusService);
    jest.clearAllMocks();
    agentProxy.getClientAgents.mockResolvedValue([{ id: 'agent-1' }]);
    clientsRepository.findById.mockResolvedValue({ id: 'client-1', userId: 'user-1' });
    clientUsersRepository.findByClientId.mockResolvedValue([]);
  });

  it('builds snapshot with unread and git dirty', async () => {
    const snapshot = await service.buildSnapshotForUser({
      isApiKeyAuth: false,
      userId: 'user-1',
      userRole: UserRole.USER,
      user: { id: 'user-1', roles: [] },
    });

    expect(snapshot.environments).toHaveLength(1);
    expect(snapshot.environments[0]).toMatchObject({
      clientId: 'client-1',
      agentId: 'agent-1',
      hasUnreadMessages: true,
      gitDirty: true,
    });
    expect(snapshot.spacesHasAttention).toBe(true);
  });

  it('marks environment read and emits patch', async () => {
    jest.mocked(readStateRepository.upsertReadState).mockResolvedValue({
      userId: 'user-1',
      clientId: 'client-1',
      agentId: 'agent-1',
      lastReadAt: new Date(),
    } as never);
    messagesProxy.getLatestAgentMessage.mockResolvedValue({
      id: 'msg-1',
      createdAt: new Date().toISOString(),
    });

    await service.markEnvironmentRead(
      { isApiKeyAuth: false, userId: 'user-1', user: { id: 'user-1', roles: [] } },
      'client-1',
      'agent-1',
    );

    expect(readStateRepository.upsertReadState).toHaveBeenCalled();
    expect(realtime.emitToUser).toHaveBeenCalledWith('user-1', 'statusPatch', expect.any(Object));
  });

  it('notifyVcsStateChanged emits status patches to users with client access', async () => {
    vcsProxy.getStatus.mockResolvedValue({
      isClean: true,
      hasUnpushedCommits: false,
      files: [],
    });

    await service.notifyVcsStateChanged('client-1', 'agent-1');

    expect(realtime.emitToUser).toHaveBeenCalledWith('user-1', 'statusPatch', expect.any(Object));
  });

  it('notifyVcsStateChanged includes connected global admins with client access', async () => {
    clientUsersRepository.findByClientId.mockResolvedValue([{ userId: 'member-2' }]);
    realtime.getConnectedUserIds.mockReturnValue(['admin-user']);
    realtime.getUserRole.mockReturnValue(UserRole.ADMIN);
    vcsProxy.getStatus.mockResolvedValue({
      isClean: false,
      hasUnpushedCommits: false,
      files: [{ status: 'M', path: 'x.ts' }],
    });

    await service.notifyVcsStateChanged('client-1', 'agent-1');

    expect(realtime.emitToUser).toHaveBeenCalledWith('user-1', 'statusPatch', expect.any(Object));
    expect(realtime.emitToUser).toHaveBeenCalledWith('member-2', 'statusPatch', expect.any(Object));
    expect(realtime.emitToUser).toHaveBeenCalledWith('admin-user', 'statusPatch', expect.any(Object));
  });

  it('returns empty snapshot when user id cannot be resolved', async () => {
    const snapshot = await service.buildSnapshotForUser({ isApiKeyAuth: true });

    expect(snapshot).toEqual({
      generatedAt: expect.any(String),
      environments: [],
      clients: [],
      spacesHasAttention: false,
    });
  });

  it('tracks active environment per socket and clears on disconnect', () => {
    service.setActiveEnvironment('socket-1', 'client-1', 'agent-1');
    expect(service.isActiveEnvironmentForSocket('socket-1', 'client-1', 'agent-1')).toBe(true);

    service.setActiveEnvironment('socket-1', null, null);
    expect(service.isActiveEnvironmentForSocket('socket-1', 'client-1', 'agent-1')).toBe(false);

    service.setActiveEnvironment('socket-1', 'client-1', 'agent-1');
    service.clearSocket('socket-1');
    expect(service.isActiveEnvironmentForSocket('socket-1', 'client-1', 'agent-1')).toBe(false);
  });

  it('emits snapshot to socket and stores last snapshot for polling', async () => {
    const snapshot = await service.emitSnapshotToSocket('socket-1', {
      isApiKeyAuth: false,
      userId: 'user-1',
      user: { id: 'user-1', roles: [] },
    });

    expect(snapshot.environments).toHaveLength(1);
    expect(realtime.emitToUser).toHaveBeenCalledWith('user-1', 'statusSnapshot', snapshot);

    vcsProxy.getStatus.mockResolvedValue({
      isClean: true,
      hasUnpushedCommits: false,
      files: [],
    });
    jest.clearAllMocks();

    await service.runPollForSocket('socket-1', {
      isApiKeyAuth: false,
      userId: 'user-1',
      user: { id: 'user-1', roles: [] },
    });

    expect(realtime.emitToUser).toHaveBeenCalledWith('user-1', 'statusPatch', expect.any(Object));
  });

  it('skips markEnvironmentRead when user id is missing', async () => {
    await service.markEnvironmentRead({ isApiKeyAuth: true }, 'client-1', 'agent-1');

    expect(readStateRepository.upsertReadState).not.toHaveBeenCalled();
  });

  it('rejects markEnvironmentRead when agent is not accessible', async () => {
    agentProxy.getClientAgents.mockResolvedValue([{ id: 'other-agent' }]);

    await expect(
      service.markEnvironmentRead(
        { isApiKeyAuth: false, userId: 'user-1', user: { id: 'user-1', roles: [] } },
        'client-1',
        'agent-1',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('notifies users on agent chat activity and auto-reads active environment', async () => {
    realtime.getUserIdForSocket.mockReturnValue('user-1');
    service.setActiveEnvironment('socket-1', 'client-1', 'agent-1');

    await service.onAgentChatActivity('client-1', 'agent-1', new Date('2026-01-03T00:00:00.000Z'));

    expect(readStateRepository.upsertReadState).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        clientId: 'client-1',
        agentId: 'agent-1',
        lastReadAt: new Date('2026-01-03T00:00:00.000Z'),
      }),
    );
    expect(realtime.emitToUser).toHaveBeenCalledWith('user-1', 'statusPatch', expect.any(Object));
  });

  it('maps git conflict and unpushed commits in snapshot', async () => {
    vcsProxy.getStatus.mockResolvedValue({
      isClean: true,
      hasUnpushedCommits: true,
      files: [{ status: 'UU', path: 'conflict.ts' }],
    });
    messagesProxy.getLatestAgentMessage.mockResolvedValue(null);
    readStateRepository.findByUserAndClientIds.mockResolvedValue([]);

    const snapshot = await service.buildSnapshotForUser({
      isApiKeyAuth: false,
      userId: 'user-1',
      userRole: UserRole.USER,
      user: { id: 'user-1', roles: [] },
    });

    expect(snapshot.environments[0]).toMatchObject({
      gitDirty: true,
      gitConflict: true,
      hasUnreadMessages: false,
    });
  });

  it('skips clients when agent list cannot be loaded', async () => {
    agentProxy.getClientAgents.mockRejectedValue(new Error('offline'));

    const snapshot = await service.buildSnapshotForUser({
      isApiKeyAuth: false,
      userId: 'user-1',
      userRole: UserRole.USER,
      user: { id: 'user-1', roles: [] },
    });

    expect(snapshot.environments).toEqual([]);
  });

  it('notifies workspace owner and members on automation chat activity', async () => {
    clientsRepository.findById.mockResolvedValue({ id: 'client-1', userId: 'owner-1' });
    clientUsersRepository.findByClientId.mockResolvedValue([{ userId: 'member-1' }]);

    await service.onAutomationChatActivity('client-1', 'agent-1');

    expect(realtime.emitToUser).toHaveBeenCalledWith('owner-1', 'statusPatch', expect.any(Object));
    expect(realtime.emitToUser).toHaveBeenCalledWith('member-1', 'statusPatch', expect.any(Object));
  });
});
