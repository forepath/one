import { AuthenticationType } from '@forepath/identity/backend';
import { INSTANCE_SCOPE_KEY, NotificationDispatcherService } from '@forepath/shared/backend';

import type { ClientEntity } from '@forepath/identity/backend';
import type { TicketResponseDto } from '../dto/tickets/ticket-response.dto';

import { AgenstraNotificationPublisher } from './agenstra-notification.publisher';

describe('AgenstraNotificationPublisher', () => {
  it('publishes client events with instance scope and client id', () => {
    const dispatcher = {
      publishFireAndForget: jest.fn(),
    } as unknown as NotificationDispatcherService;
    const publisher = new AgenstraNotificationPublisher(dispatcher);
    const client = {
      id: 'client-1',
      name: 'Workspace A',
      endpoint: 'https://agent.example',
      authenticationType: AuthenticationType.API_KEY,
      createdAt: new Date('2026-07-01T10:00:00.000Z'),
      updatedAt: new Date('2026-07-02T10:00:00.000Z'),
    } as ClientEntity;

    publisher.publishClient('client.created', client);

    expect(dispatcher.publishFireAndForget).toHaveBeenCalledWith({
      type: 'client.created',
      scopeKey: INSTANCE_SCOPE_KEY,
      clientId: 'client-1',
      data: expect.objectContaining({
        id: 'client-1',
        name: 'Workspace A',
        createdAt: '2026-07-01T10:00:00.000Z',
      }),
    });
  });

  it('publishes ticket events with workspace client id', () => {
    const dispatcher = {
      publishFireAndForget: jest.fn(),
    } as unknown as NotificationDispatcherService;
    const publisher = new AgenstraNotificationPublisher(dispatcher);
    const ticket = {
      id: 'ticket-1',
      clientId: 'client-1',
      title: 'Fix bug',
      priority: 'medium',
      status: 'draft',
      automationEligible: false,
      createdAt: new Date('2026-07-01T10:00:00.000Z'),
      updatedAt: new Date('2026-07-01T10:00:00.000Z'),
    } as TicketResponseDto;

    publisher.publishTicket('ticket.updated', ticket);

    expect(dispatcher.publishFireAndForget).toHaveBeenCalledWith({
      type: 'ticket.updated',
      scopeKey: INSTANCE_SCOPE_KEY,
      clientId: 'client-1',
      data: expect.objectContaining({
        id: 'ticket-1',
        title: 'Fix bug',
      }),
    });
    expect(dispatcher.publishFireAndForget).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({ content: expect.anything() }),
      }),
    );
  });

  it('publishes agent configuration updates (instance-wide for the global layer)', () => {
    const dispatcher = {
      publishFireAndForget: jest.fn(),
    } as unknown as NotificationDispatcherService;
    const publisher = new AgenstraNotificationPublisher(dispatcher);

    publisher.publishAgentConfigUpdated({
      layer: 'global',
      clientId: null,
      agentId: null,
      changedRoots: ['egress'],
      securityRootsChanged: ['egress'],
      locksChanged: false,
      secretKeysChanged: [],
      updatedByUserId: 'user-1',
    });
    publisher.publishAgentConfigUpdated({
      layer: 'workspace',
      clientId: 'client-1',
      changedRoots: ['message_filters'],
      securityRootsChanged: ['message_filters'],
      locksChanged: true,
      secretKeysChanged: [],
    });

    expect(dispatcher.publishFireAndForget).toHaveBeenNthCalledWith(1, {
      type: 'agent_config.updated',
      scopeKey: INSTANCE_SCOPE_KEY,
      clientId: undefined,
      data: expect.objectContaining({ layer: 'global', changedRoots: ['egress'] }),
    });
    expect(dispatcher.publishFireAndForget).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ type: 'agent_config.updated', clientId: 'client-1' }),
    );
  });

  it('publishes egress decision, guard and policy events with workspace client id', () => {
    const dispatcher = {
      publishFireAndForget: jest.fn(),
    } as unknown as NotificationDispatcherService;
    const publisher = new AgenstraNotificationPublisher(dispatcher);

    publisher.publishEgressDecision('egress.blocked', 'client-1', {
      agentId: 'agent-1',
      kind: 'web',
      decision: 'blocked',
      host: 'example.org',
      rule: 'deny_host',
      count: 3,
      firstSeenAt: '2026-10-12T10:00:00.000Z',
      lastSeenAt: '2026-10-12T10:00:05.000Z',
    });
    publisher.publishEgressGuardFailed('client-1', {
      agentId: 'agent-1',
      message: 'guard_missing',
      occurredAt: '2026-10-12T10:00:00.000Z',
    });
    publisher.publishEgressPolicy('egress.policy_applied', 'client-1', { agentId: 'agent-1', mode: 'enforce' });

    expect(dispatcher.publishFireAndForget).toHaveBeenCalledWith({
      type: 'egress.blocked',
      scopeKey: INSTANCE_SCOPE_KEY,
      clientId: 'client-1',
      data: expect.objectContaining({ host: 'example.org', count: 3 }),
    });
    expect(dispatcher.publishFireAndForget).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'egress.guard_failed', clientId: 'client-1' }),
    );
    expect(dispatcher.publishFireAndForget).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'egress.policy_applied', data: { agentId: 'agent-1', mode: 'enforce' } }),
    );
  });

  it('publishes chat message events with workspace client id', () => {
    const dispatcher = {
      publishFireAndForget: jest.fn(),
    } as unknown as NotificationDispatcherService;
    const publisher = new AgenstraNotificationPublisher(dispatcher);

    publisher.publishChatMessage('client-1', {
      agentId: 'agent-1',
      direction: 'incoming',
      source: 'user',
      message: 'Hello agent',
      userId: 'user-1',
      chatId: 'chat-1',
    });

    expect(dispatcher.publishFireAndForget).toHaveBeenCalledWith({
      type: 'chat_message.created',
      scopeKey: INSTANCE_SCOPE_KEY,
      clientId: 'client-1',
      data: expect.objectContaining({
        agentId: 'agent-1',
        message: 'Hello agent',
        source: 'user',
        chatId: 'chat-1',
      }),
    });
  });

  it('publishes ACP session failure events with workspace client id', () => {
    const dispatcher = {
      publishFireAndForget: jest.fn(),
    } as unknown as NotificationDispatcherService;
    const publisher = new AgenstraNotificationPublisher(dispatcher);

    publisher.publishAgentAcpSessionFailed('client-1', {
      agentId: 'agent-1',
      message: 'ACP session initialize failed',
      code: 'ACP_SESSION_FAILED',
    });

    expect(dispatcher.publishFireAndForget).toHaveBeenCalledWith({
      type: 'agent.acp.session_failed',
      scopeKey: INSTANCE_SCOPE_KEY,
      clientId: 'client-1',
      data: expect.objectContaining({
        agentId: 'agent-1',
        code: 'ACP_SESSION_FAILED',
      }),
    });
  });

  it('publishes ACP permission denied events with workspace client id', () => {
    const dispatcher = {
      publishFireAndForget: jest.fn(),
    } as unknown as NotificationDispatcherService;
    const publisher = new AgenstraNotificationPublisher(dispatcher);

    publisher.publishAgentAcpPermissionDenied('client-1', {
      agentId: 'agent-1',
      message: 'ACP session permission denied',
    });

    expect(dispatcher.publishFireAndForget).toHaveBeenCalledWith({
      type: 'agent.acp.permission_denied',
      scopeKey: INSTANCE_SCOPE_KEY,
      clientId: 'client-1',
      data: expect.objectContaining({
        agentId: 'agent-1',
      }),
    });
  });

  it('publishes agent chat failed events with workspace client id', () => {
    const dispatcher = {
      publishFireAndForget: jest.fn(),
    } as unknown as NotificationDispatcherService;
    const publisher = new AgenstraNotificationPublisher(dispatcher);

    publisher.publishAgentChatFailed('client-1', {
      agentId: 'agent-1',
      message: 'Error processing chat message',
      code: 'CHAT_ERROR',
    });

    expect(dispatcher.publishFireAndForget).toHaveBeenCalledWith({
      type: 'agent.chat.failed',
      scopeKey: INSTANCE_SCOPE_KEY,
      clientId: 'client-1',
      data: expect.objectContaining({
        agentId: 'agent-1',
        code: 'CHAT_ERROR',
      }),
    });
  });

  it('publishes message filter triggered events with workspace client id', () => {
    const dispatcher = {
      publishFireAndForget: jest.fn(),
    } as unknown as NotificationDispatcherService;
    const publisher = new AgenstraNotificationPublisher(dispatcher);

    publisher.publishMessageFilterTriggered('client-1', {
      agentId: 'agent-1',
      direction: 'incoming',
      status: 'dropped',
      filterType: 'regex',
      filterDisplayName: 'Secrets',
      reason: 'Matched secret pattern',
      wordCount: 3,
      charCount: 11,
      userId: 'user-1',
    });

    expect(dispatcher.publishFireAndForget).toHaveBeenCalledWith({
      type: 'message_filter.triggered',
      scopeKey: INSTANCE_SCOPE_KEY,
      clientId: 'client-1',
      data: expect.objectContaining({
        status: 'dropped',
        filterDisplayName: 'Secrets',
      }),
    });
  });

  it('publishes ticket comment events without author email', () => {
    const dispatcher = {
      publishFireAndForget: jest.fn(),
    } as unknown as NotificationDispatcherService;
    const publisher = new AgenstraNotificationPublisher(dispatcher);

    publisher.publishTicketComment('client-1', {
      id: 'comment-1',
      ticketId: 'ticket-1',
      authorUserId: 'user-1',
      authorEmail: 'user@example.com',
      body: 'Looks good',
      createdAt: new Date('2026-07-01T11:00:00.000Z'),
    });

    expect(dispatcher.publishFireAndForget).toHaveBeenCalledWith({
      type: 'ticket.comment.created',
      scopeKey: INSTANCE_SCOPE_KEY,
      clientId: 'client-1',
      data: {
        id: 'comment-1',
        ticketId: 'ticket-1',
        authorUserId: 'user-1',
        body: 'Looks good',
        createdAt: '2026-07-01T11:00:00.000Z',
      },
    });
  });

  it('publishes environment events without secret values', () => {
    const dispatcher = {
      publishFireAndForget: jest.fn(),
    } as unknown as NotificationDispatcherService;
    const publisher = new AgenstraNotificationPublisher(dispatcher);

    publisher.publishEnvironment('environment.created', 'client-1', {
      id: 'env-1',
      agentId: 'agent-1',
      variable: 'API_KEY',
      content: 'super-secret',
      createdAt: new Date('2026-07-01T10:00:00.000Z'),
      updatedAt: new Date('2026-07-02T10:00:00.000Z'),
    });

    expect(dispatcher.publishFireAndForget).toHaveBeenCalledWith({
      type: 'environment.created',
      scopeKey: INSTANCE_SCOPE_KEY,
      clientId: 'client-1',
      data: {
        id: 'env-1',
        agentId: 'agent-1',
        variable: 'API_KEY',
        createdAt: '2026-07-01T10:00:00.000Z',
        updatedAt: '2026-07-02T10:00:00.000Z',
      },
    });
  });

  it('publishes chat session lifecycle events', () => {
    const dispatcher = {
      publishFireAndForget: jest.fn(),
    } as unknown as NotificationDispatcherService;
    const publisher = new AgenstraNotificationPublisher(dispatcher);

    publisher.publishChatSession('chat_session.created', 'client-1', {
      id: 'chat-1',
      agentId: 'agent-1',
      title: 'Planning',
      kind: 'user',
      lastMessageAt: new Date('2026-07-01T11:00:00.000Z'),
      createdAt: new Date('2026-07-01T10:00:00.000Z'),
      updatedAt: new Date('2026-07-02T10:00:00.000Z'),
    });

    expect(dispatcher.publishFireAndForget).toHaveBeenCalledWith({
      type: 'chat_session.created',
      scopeKey: INSTANCE_SCOPE_KEY,
      clientId: 'client-1',
      data: {
        id: 'chat-1',
        agentId: 'agent-1',
        title: 'Planning',
        kind: 'user',
        lastMessageAt: '2026-07-01T11:00:00.000Z',
        createdAt: '2026-07-01T10:00:00.000Z',
        updatedAt: '2026-07-02T10:00:00.000Z',
      },
    });
    expect(dispatcher.publishFireAndForget).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({
          message: expect.anything(),
          body: expect.anything(),
          content: expect.anything(),
        }),
      }),
    );
  });

  it('publishes container isolation events with workspace client id', () => {
    const dispatcher = {
      publishFireAndForget: jest.fn(),
    } as unknown as NotificationDispatcherService;
    const publisher = new AgenstraNotificationPublisher(dispatcher);

    publisher.publishIsolationHostTransition('isolation.sandbox_unavailable', 'client-1', {
      clientId: 'client-1',
      level: 'sandboxed',
      runtime: 'runsc-systrap',
      previousState: 'ready',
      state: 'probe-failed',
      reasonCode: 'E_PROBE_EXEC_FAILED',
      recommendedLevel: 'standard',
      revision: 'sha256:x',
    });
    publisher.publishAgentIsolationOverride('client-1', {
      agentId: 'agent-1',
      automaticSelection: 'sandboxed',
      effectiveSelection: 'standard',
    });
    publisher.publishAgentSandboxCreationFailed('client-1', {
      agentName: 'env',
      isolationLevel: 'sandboxed',
      runtime: 'runsc-systrap',
      error: 'boom',
      occurredAt: '2026-10-15T20:00:00.000Z',
    });

    expect(dispatcher.publishFireAndForget).toHaveBeenCalledWith({
      type: 'isolation.sandbox_unavailable',
      scopeKey: INSTANCE_SCOPE_KEY,
      clientId: 'client-1',
      data: expect.objectContaining({ state: 'probe-failed', reasonCode: 'E_PROBE_EXEC_FAILED' }),
    });
    expect(dispatcher.publishFireAndForget).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'agent.isolation_override', clientId: 'client-1' }),
    );
    expect(dispatcher.publishFireAndForget).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'agent.sandbox_creation_failed', clientId: 'client-1' }),
    );
  });
});
