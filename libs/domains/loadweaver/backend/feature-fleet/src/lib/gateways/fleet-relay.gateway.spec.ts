import { NotFoundException } from '@nestjs/common';

import { FleetAccessEvents } from '../services/fleet-access-events.service';
import { clusterAccess } from '../utils/fleet-access.utils';
import { FleetRelayGateway, fleetSocketRecheckMs } from './fleet-relay.gateway';

const remotes: Array<{ options: Record<string, unknown>; disconnect: jest.Mock }> = [];

jest.mock('@forepath/shared/backend/util-http-context', () => ({
  createCorrelationAwareSocketIoClient: jest.fn((_url: string, options: Record<string, unknown>) => {
    const remote = {
      options,
      on: jest.fn(),
      onAny: jest.fn(),
      emit: jest.fn(),
      removeAllListeners: jest.fn(),
      disconnect: jest.fn(),
    };

    remotes.push(remote);

    return remote;
  }),
}));

const ID = '00000000-0000-4000-8000-00000000000a';
const cluster = {
  id: ID,
  name: 'eu',
  endpoint: 'https://eu.example.com',
  caCertificate: null,
  credential: 'cluster-pat',
  state: 'active',
  readOnlyUntil: null as Date | null,
};
const userInfo = { userId: 'u1', userRole: 'user', isApiKeyAuth: false, email: 'alice@example.com' };

function setup() {
  let grants: { role: 'viewer' | 'operator' | 'admin'; project: string | null }[] = [
    { role: 'operator', project: null },
  ];
  const state = { cluster: { ...cluster }, tokenValid: true };
  const access = {
    visibleCluster: jest.fn(async (caller: never) => {
      const a = clusterAccess(caller, grants, state.cluster as never);

      if (!a.clusterRole && !a.projects.size) throw new NotFoundException('cluster not found');

      return { cluster: state.cluster, access: a };
    }),
  };
  const socketAuth = { validateAndGetUser: jest.fn(async () => (state.tokenValid ? userInfo : null)) };
  const audit = { recordQuietly: jest.fn() };
  const events = new FleetAccessEvents();
  const gateway = new FleetRelayGateway(socketAuth as never, access as never, audit as never, events);
  const emitted: Array<[string, Record<string, unknown>]> = [];
  const socket = {
    id: 's1',
    data: { userInfo, authorization: 'Bearer fleet-jwt' },
    emit: jest.fn((event: string, payload: Record<string, unknown>) => emitted.push([event, payload])),
    disconnect: jest.fn(),
  };

  return {
    gateway,
    socket,
    emitted,
    events,
    state,
    socketAuth,
    setGrants: (g: typeof grants) => {
      grants = g;
    },
  };
}

const attachedId = (emitted: Array<[string, Record<string, unknown>]>) =>
  emitted.find(([e]) => e === 'attached')?.[1]['attachmentId'];

describe('socket relay (3.24)', () => {
  beforeEach(() => {
    remotes.length = 0;
  });

  it('connects through the SSRF-guarded agent (lookup validates resolved addresses)', async () => {
    const { gateway, socket, emitted } = setup();

    await gateway.attach({ clusterId: ID, namespace: 'terminals' }, socket as never);

    expect(attachedId(emitted)).toBeDefined();
    const agent = remotes[0].options['agent'] as { options: { lookup?: unknown } };

    expect(typeof agent.options.lookup).toBe('function');
  });

  it('closes attachments whose grant is gone at the next re-check (L3)', async () => {
    const { gateway, socket, emitted, setGrants } = setup();

    await gateway.attach({ clusterId: ID, namespace: 'plans' }, socket as never);
    setGrants([]);
    await gateway.recheckAll();

    expect(remotes[0].disconnect).toHaveBeenCalled();
    expect(emitted).toContainEqual(['detached', expect.objectContaining({ reason: 'access-revoked' })]);
    // Gone: emits are refused afterwards.
    gateway.forward({ attachmentId: attachedId(emitted), event: 'x', args: [] }, socket as never);
    expect(emitted.at(-1)?.[0]).toBe('relayError');
  });

  it('closes terminals when the read-only grace starts, right away on the change event', async () => {
    const { gateway, socket, emitted, events, state } = setup();

    await gateway.attach({ clusterId: ID, namespace: 'terminals' }, socket as never);
    await gateway.attach({ clusterId: ID, namespace: 'plans' }, socket as never);
    gateway.afterInit({ use: jest.fn() } as never);
    state.cluster.state = 'teardown';
    events.accessChanged(ID);
    await new Promise((resolve) => setImmediate(resolve));
    gateway.onModuleDestroy();

    expect(remotes[0].disconnect).toHaveBeenCalled();
    expect(remotes[1].disconnect).not.toHaveBeenCalled();
    expect(emitted.filter(([e]) => e === 'detached')).toHaveLength(1);
  });

  it('disconnects the console socket when its token no longer validates', async () => {
    const { gateway, socket, state } = setup();

    await gateway.attach({ clusterId: ID, namespace: 'plans' }, socket as never);
    state.tokenValid = false;
    await gateway.recheckAll();

    expect(remotes[0].disconnect).toHaveBeenCalled();
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  it('re-checks every minute by default', () => {
    expect(fleetSocketRecheckMs({})).toBe(60_000);
    expect(fleetSocketRecheckMs({ FLEET_SOCKET_RECHECK_MS: '1000' })).toBe(60_000);
    expect(fleetSocketRecheckMs({ FLEET_SOCKET_RECHECK_MS: '30000' })).toBe(30_000);
  });

  it('relays plans / topology streams to project grants only with a fresh signed claim per connect (2026-10-27)', async () => {
    const run = async (identityState: string | undefined) => {
      remotes.length = 0;

      const { socket, emitted, setGrants, state } = setup();
      const identity = { claimFor: jest.fn(async () => 'signed.claim') };
      const gateway = new FleetRelayGateway(
        { validateAndGetUser: jest.fn(async () => userInfo) } as never,
        {
          visibleCluster: jest.fn(async (caller: never) => ({
            cluster: state.cluster,
            access: clusterAccess(caller, [{ role: 'viewer', project: 'shop' }], state.cluster as never),
          })),
        } as never,
        { recordQuietly: jest.fn() } as never,
        new FleetAccessEvents(),
        identity as never,
      );

      setGrants([{ role: 'viewer', project: 'shop' }]);
      Object.assign(state.cluster, {
        health: { clusterId: 'cluster-uid', ...(identityState ? { identity: identityState } : {}) },
      });
      await gateway.attach({ clusterId: ID, namespace: 'plans' }, socket as never);

      return { emitted, identity };
    };

    const untrusted = await run('untrusted');

    expect(untrusted.emitted.find(([e]) => e === 'relayError')?.[1]['message']).toContain('trust this fleet');
    expect(remotes).toHaveLength(0);

    const verified = await run('verified');

    expect(attachedId(verified.emitted)).toBeDefined();

    const auth = remotes[0].options['auth'] as (cb: (data: object) => void) => void;
    const handshake = await new Promise((resolve) => auth(resolve));

    expect(handshake).toEqual({ fleetIdentity: 'signed.claim' });
    expect(verified.identity.claimFor).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ audience: 'cluster-uid', method: 'SOCKET', url: '/socket/plans', body: null }),
    );
    // Reconnects mint a new claim.
    await new Promise((resolve) => auth(resolve));
    expect(verified.identity.claimFor).toHaveBeenCalledTimes(2);
  });
});
