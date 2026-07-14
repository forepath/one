import { AuthenticationType } from '@forepath/identity/backend';
import { INSTANCE_SCOPE_KEY, NotificationDispatcherService } from '@forepath/shared/backend';

import type { ClientEntity } from '@forepath/identity/backend';
import type { FilterRuleResponseDto } from '../dto/filter-rules/filter-rule-response.dto';
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

  it('publishes filter rule events without client id for global rules', () => {
    const dispatcher = {
      publishFireAndForget: jest.fn(),
    } as unknown as NotificationDispatcherService;
    const publisher = new AgenstraNotificationPublisher(dispatcher);
    const rule = {
      id: 'rule-1',
      pattern: 'secret',
      regexFlags: 'i',
      direction: 'outbound',
      filterType: 'redact',
      priority: 0,
      enabled: true,
      isGlobal: true,
      workspaceIds: [],
      sync: { pending: 0, synced: 0, failed: 0 },
      workspaceSync: [],
      createdAt: '2026-07-01T10:00:00.000Z',
      updatedAt: '2026-07-01T10:00:00.000Z',
    } as unknown as FilterRuleResponseDto;

    publisher.publishFilterRule('filter_rule.deleted', rule);

    expect(dispatcher.publishFireAndForget).toHaveBeenCalledTimes(1);
    expect(dispatcher.publishFireAndForget).toHaveBeenCalledWith({
      type: 'filter_rule.deleted',
      scopeKey: INSTANCE_SCOPE_KEY,
      clientId: undefined,
      data: expect.objectContaining({
        id: 'rule-1',
        pattern: 'secret',
      }),
    });
  });

  it('publishes filter rule events once per linked workspace', () => {
    const dispatcher = {
      publishFireAndForget: jest.fn(),
    } as unknown as NotificationDispatcherService;
    const publisher = new AgenstraNotificationPublisher(dispatcher);
    const rule = {
      id: 'rule-2',
      pattern: 'token',
      regexFlags: 'i',
      direction: 'outbound',
      filterType: 'redact',
      priority: 0,
      enabled: true,
      isGlobal: false,
      workspaceIds: ['client-a', 'client-b'],
      sync: { pending: 0, synced: 0, failed: 0 },
      workspaceSync: [],
      createdAt: '2026-07-01T10:00:00.000Z',
      updatedAt: '2026-07-01T10:00:00.000Z',
    } as unknown as FilterRuleResponseDto;

    publisher.publishFilterRule('filter_rule.created', rule);

    expect(dispatcher.publishFireAndForget).toHaveBeenCalledTimes(2);
    expect(dispatcher.publishFireAndForget).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: 'client-a', type: 'filter_rule.created' }),
    );
    expect(dispatcher.publishFireAndForget).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: 'client-b', type: 'filter_rule.created' }),
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
    });

    expect(dispatcher.publishFireAndForget).toHaveBeenCalledWith({
      type: 'chat_message.created',
      scopeKey: INSTANCE_SCOPE_KEY,
      clientId: 'client-1',
      data: expect.objectContaining({
        agentId: 'agent-1',
        message: 'Hello agent',
        source: 'user',
      }),
    });
  });

  it('publishes filter rule triggered events with workspace client id', () => {
    const dispatcher = {
      publishFireAndForget: jest.fn(),
    } as unknown as NotificationDispatcherService;
    const publisher = new AgenstraNotificationPublisher(dispatcher);

    publisher.publishFilterRuleTriggered('client-1', {
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
      type: 'filter_rule.triggered',
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
});
