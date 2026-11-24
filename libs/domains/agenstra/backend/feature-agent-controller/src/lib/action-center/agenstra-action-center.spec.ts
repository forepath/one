import { PlatformEmailDeliveryActionSource, PlatformWebhooksActionSource } from '@forepath/shared/backend';
import { ForbiddenException } from '@nestjs/common';

import {
  AdminActionCenterController,
  resolveAgenstraActionCenterViewer,
} from '../controllers/admin-action-center.controller';

import { AgenstraActionCenterGateway } from './agenstra-action-center.gateway';
import { AgenstraActionCenterRegistrar } from './agenstra-action-center.registrar';
import { AGENSTRA_ACTION_TYPES } from './agenstra-action-center.types';
import { AgenstraWorkspacesActionSource } from './agenstra-workspaces.action-source';

function recordingRunner(rows: (sql: string) => unknown[] = () => []) {
  const captured: Array<{ sql: string; params: unknown[] }> = [];

  return {
    captured,
    runner: {
      query: jest.fn(async (sql: string, params: unknown[] = []) => {
        captured.push({ sql, params });

        return rows(sql);
      }),
    },
  };
}

const maxPlaceholder = (sql: string) => Math.max(0, ...[...sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1])));
const context = { scopeKey: 'instance', itemLimit: 200, now: new Date('2026-11-24T10:00:00Z') };

describe('Agenstra action center sources', () => {
  it('pass exactly the bind values every statement references', async () => {
    const { captured, runner } = recordingRunner();

    for (const source of [
      new AgenstraWorkspacesActionSource(runner as never),
      new PlatformWebhooksActionSource(runner),
      new PlatformEmailDeliveryActionSource(runner),
    ]) {
      await source.collect(context);
    }

    expect(captured.length).toBeGreaterThanOrEqual(15);

    for (const { sql, params } of captured) {
      expect({ sql: sql.slice(0, 80), count: params.length }).toEqual({
        sql: sql.slice(0, 80),
        count: maxPlaceholder(sql),
      });
    }
  });

  it('declares the whole Agenstra catalog', () => {
    expect([...new AgenstraWorkspacesActionSource({} as never).types].sort()).toEqual(
      [...Object.values(AGENSTRA_ACTION_TYPES)].sort(),
    );
  });

  it('suggests the first workspace and attaches the workspace to every item', async () => {
    const { runner } = recordingRunner((sql) => {
      if (sql.includes('COUNT(*) AS count FROM clients')) {
        return [{ count: '0' }];
      }

      return sql.includes('FROM agent_tasks k') && sql.includes('approved_at IS NULL')
        ? [
            {
              id: 't-1',
              client_id: 'c-1',
              client_name: 'Shop',
              title: 'Nightly',
              agent_id: 'a-1',
              at: null,
              total: '1',
            },
          ]
        : [];
    });
    const groups = await new AgenstraWorkspacesActionSource(runner as never).collect(context);

    expect(groups.map((group) => group.type)).toEqual([
      AGENSTRA_ACTION_TYPES.setupFirstWorkspace,
      AGENSTRA_ACTION_TYPES.tasksApproval,
    ]);
    expect(groups[1].items[0].params).toEqual({
      clientId: 'c-1',
      clientName: 'Shop',
      title: 'Nightly',
      agentId: 'a-1',
    });
  });
});

describe('AdminActionCenterController (Agenstra)', () => {
  const request = (user: Record<string, unknown> | undefined, extra: Record<string, unknown> = {}) =>
    ({ user, ...extra }) as never;
  const actionCenter = { getView: jest.fn().mockResolvedValue('view'), silence: jest.fn(), unsilence: jest.fn() };
  const clientsService = { getAccessibleClientIds: jest.fn().mockResolvedValue(['c-1']) };
  const controller = new AdminActionCenterController(actionCenter as never, clientsService as never);

  beforeEach(() => jest.clearAllMocks());

  it.each([
    ['regular users', request({ id: 'u', roles: ['user'] })],
    ['the static credential', request(undefined, { apiKeyAuthenticated: true })],
  ])('rejects %s', (_label, req) => {
    expect(() => resolveAgenstraActionCenterViewer(req)).toThrow(ForbiddenException);
  });

  it('shows console admins / managers every workspace', async () => {
    await controller.getView(request({ id: 'u', roles: ['manager'], amr: ['pwd'] }));

    expect(clientsService.getAccessibleClientIds).not.toHaveBeenCalled();
    expect(actionCenter.getView).toHaveBeenCalledWith({ userId: 'u', role: 'manager', scopeKey: 'instance' });
  });

  it('limits personal access tokens to the workspaces their user may access (no console-admin bypass)', async () => {
    await controller.getView(request({ id: 'u', roles: ['admin'], amr: ['pat'], scopes: ['action_center:admin'] }));

    expect(clientsService.getAccessibleClientIds).toHaveBeenCalledWith('u', 'admin', false, { amr: ['pat'] });
    expect(actionCenter.getView).toHaveBeenCalledWith({
      userId: 'u',
      role: 'admin',
      scopeKey: 'instance',
      restriction: { param: 'clientId', values: ['c-1'] },
      groupFilter: expect.any(Function),
    });

    const viewer = actionCenter.getView.mock.calls[0][0];

    expect(viewer.groupFilter('agenstra.tickets.automation_approval', 'tickets')).toBe(false);
    expect(viewer.groupFilter('platform.updates.available', 'platform')).toBe(false);
  });
});

describe('AgenstraActionCenterGateway', () => {
  function setup(userInfo: unknown, user: unknown) {
    const socketAuthService = { validateAndGetUser: jest.fn().mockResolvedValue(userInfo) };
    const usersRepository = { findById: jest.fn().mockResolvedValue(user) };
    const gateway = new AgenstraActionCenterGateway({} as never, socketAuthService as never, usersRepository as never);
    const socket = { handshake: { headers: { authorization: 'Bearer t' }, auth: {} }, request: { socket: {} } };

    return {
      socketAuthService,
      authenticate: () =>
        (gateway as unknown as { authenticate: (s: unknown) => Promise<unknown> }).authenticate(socket),
    };
  }

  const interactive = { userId: 'u-1', userRole: 'admin', isApiKeyAuth: false, amr: ['pwd'] };

  it('accepts interactive admins with their current role', async () => {
    const { authenticate, socketAuthService } = setup(interactive, { id: 'u-1', role: 'admin', lockedAt: null });

    expect(((await authenticate()) as { viewer: unknown }).viewer).toEqual({
      userId: 'u-1',
      role: 'admin',
      scopeKey: 'instance',
    });
    expect(socketAuthService.validateAndGetUser).toHaveBeenCalledWith('Bearer t', undefined, { transportSocket: {} });
  });

  it.each([
    ['invalid tokens', null, { role: 'admin' }],
    ['the static credential', { isApiKeyAuth: true }, { role: 'admin' }],
    ['machine tokens', { ...interactive, amr: ['pat'] }, { role: 'admin' }],
    ['demoted users', interactive, { role: 'user', lockedAt: null }],
    ['locked users', interactive, { role: 'admin', lockedAt: new Date() }],
  ])('rejects %s', async (_label, userInfo, user) => {
    expect(await setup(userInfo, user).authenticate()).toBeNull();
  });
});

describe('AgenstraActionCenterRegistrar', () => {
  it('signals published events and publishes silence changes as webhooks', () => {
    let silenceListener: ((change: unknown) => void) | undefined;
    let publishListener: ((type: string) => void) | undefined;
    const claims = new Set<string>();
    const actionCenter = {
      claimWiring: jest.fn((key: string) => (claims.has(key) ? false : (claims.add(key), true))),
      signalChange: jest.fn(),
      onSilenceChange: jest.fn((listener) => ((silenceListener = listener), () => undefined)),
    };
    const publisher = {
      publish: jest.fn(),
      addListener: jest.fn((listener) => ((publishListener = listener), () => undefined)),
    };
    const registry = { register: jest.fn() };

    new AgenstraActionCenterRegistrar(
      registry as never,
      actionCenter as never,
      publisher as never,
      {} as never,
      { getStatusSummary: jest.fn() } as never,
      {} as never,
    ).onModuleInit();

    expect(registry.register.mock.calls[0]).toHaveLength(4);
    publishListener?.('chat_message.created');
    publishListener?.('egress.observed');
    expect(actionCenter.signalChange).not.toHaveBeenCalled();
    publishListener?.('agent.sandbox_creation_failed');
    expect(actionCenter.signalChange).toHaveBeenCalledWith('instance');
    silenceListener?.({
      change: 'created',
      actor: { userId: 'u-1' },
      silence: { id: 's-1', itemType: 'agenstra.tasks.run_failed', itemId: null, audience: 'everyone', until: null },
    });
    expect(publisher.publish).toHaveBeenCalledWith(
      'action_center.silence.created',
      expect.objectContaining({ silenceId: 's-1', audience: 'everyone', actorUserId: 'u-1' }),
    );
  });
});
