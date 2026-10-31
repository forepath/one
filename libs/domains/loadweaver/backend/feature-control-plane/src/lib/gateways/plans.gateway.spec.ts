import type { SocketAuthService } from '@forepath/identity/backend';
import type { Socket } from 'socket.io';
import type { DataSource } from 'typeorm';

import type { ProjectAccessService } from '../access/project-access.service';
import { DraftEntity } from '../drafts/draft.entity';
import { PlansGateway } from './plans.gateway';

jest.mock('@forepath/identity/backend', () => ({
  ...jest.requireActual('@forepath/identity/backend'),
  buildRequestFromSocketUser: (u: { id: string }) => ({ actor: { type: 'user', id: u.id } }),
}));
jest.mock('../services/audit-log.service', () => ({
  actorFromRequest: (req?: { actor?: unknown }) => req?.actor ?? { type: 'api-key', id: null },
  AuditLogService: class {},
}));

/** `socket/plans` streams Workspace drafts to the people who may edit them (3.36). */
describe('PlansGateway drafts', () => {
  const draft = (id: string, owner: string, projects: string[]) =>
    ({
      id,
      title: id,
      owner,
      projects,
      clusterScope: null,
      ops: [],
      version: 1,
      status: 'open',
      planId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }) as DraftEntity;

  it('snapshots and patches drafts by edit rights', async () => {
    const drafts = [draft('d1', 'alice', ['shop']), draft('d2', 'carol', ['blog']), draft('d3', 'bob', [])];
    const dataSource = {
      getRepository: (entity: unknown) => ({
        find: async () => (entity === DraftEntity ? drafts : []),
      }),
    } as unknown as DataSource;
    const access = {
      caller: async () => ({ isApiKey: false, projects: new Map([['shop', 'developer']]) }),
    } as unknown as ProjectAccessService;
    const gateway = new PlansGateway(dataSource, {} as SocketAuthService, access);
    const socket = { id: 's1', data: { userInfo: { id: 'bob' } }, emit: jest.fn(), disconnect: jest.fn() };

    jest.useFakeTimers();
    await gateway.handleConnection(socket as unknown as Socket);
    expect(socket.emit).toHaveBeenCalledWith('draftsSnapshot', {
      drafts: [expect.objectContaining({ id: 'd1' }), expect.objectContaining({ id: 'd3' })],
    });

    socket.emit.mockClear();
    await gateway.poll();
    expect(socket.emit.mock.calls.filter(([e]) => e === 'draftPatch').map(([, p]) => p.draft.id)).toEqual(['d1', 'd3']);
    gateway.handleDisconnect(socket as unknown as Socket);
    jest.useRealTimers();
  });

  it('verifies a fleet subscription’s claim and streams as that person (2026-10-27)', async () => {
    const identity = { person: 'fleet:f:alice', projects: { shop: 'viewer' } };
    const fleets = {
      evaluateSocket: jest.fn(async (token: unknown) =>
        token === 'good'
          ? { result: 'verified', identity }
          : token
            ? { result: 'refused', reason: 'claim expired' }
            : { result: 'none' },
      ),
    };
    const caller = jest.fn(async () => ({ isApiKey: false, projects: new Map([['shop', 'viewer']]) }));
    const gateway = new PlansGateway(
      { getRepository: () => ({ find: async () => [] }) } as never,
      { validateAndGetUser: async () => ({ id: 'svc', userId: 'svc' }) } as never,
      { caller } as never,
      fleets as never,
    );
    let middleware: (socket: unknown, next: (error?: Error) => void) => Promise<void> = async () => undefined;

    gateway.afterInit({ use: (fn: typeof middleware) => (middleware = fn) } as never);

    const handshake = (fleetIdentity?: string) => ({
      handshake: { headers: { authorization: 'Bearer x' }, auth: { fleetIdentity } },
    });
    const refused = jest.fn();

    await middleware(handshake('bad'), refused);
    expect(refused.mock.calls[0][0]).toBeInstanceOf(Error);

    const socket = { id: 's9', ...handshake('good'), emit: jest.fn(), disconnect: jest.fn() } as Record<
      string,
      unknown
    >;
    const ok = jest.fn();

    await middleware(socket, ok);
    expect(ok).toHaveBeenCalledWith();
    expect((socket['data'] as Record<string, unknown>)['fleetIdentity']).toBe(identity);

    jest.useFakeTimers();
    await gateway.handleConnection(socket as never);
    expect(caller).toHaveBeenCalledWith(expect.objectContaining({ fleetIdentity: identity }));
    gateway.handleDisconnect(socket as never);
    jest.useRealTimers();
  });
});
