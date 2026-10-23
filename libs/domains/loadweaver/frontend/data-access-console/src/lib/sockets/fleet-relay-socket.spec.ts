import type { Socket } from 'socket.io-client';

import { FleetRelaySocket } from './fleet-relay-socket';

const CLUSTER = '6f1c1b0e-0000-4000-8000-000000000001';

/** A fake fleet socket: records emits, lets the test fire server events. */
function fakeFleet() {
  const handlers = new Map<string, ((...args: unknown[]) => void)[]>();
  const fleet = {
    connected: true,
    emitted: [] as [string, unknown][],
    on(event: string, fn: (...args: unknown[]) => void) {
      handlers.set(event, [...(handlers.get(event) ?? []), fn]);

      return fleet;
    },
    emit(event: string, payload: unknown) {
      fleet.emitted.push([event, payload]);

      return fleet;
    },
    disconnect: jest.fn(),
    fire(event: string, ...args: unknown[]) {
      for (const fn of handlers.get(event) ?? []) fn(...args);
    },
  };

  return fleet;
}

describe('FleetRelaySocket', () => {
  it('attaches on connect, maps attached / events / emits / detach like a namespace socket', () => {
    const fleet = fakeFleet();
    const socket = new FleetRelaySocket(fleet as unknown as Socket, CLUSTER, 'logs');
    const seen: unknown[] = [];

    socket.on('connect', () => {
      seen.push('connect');
      socket.emit('subscribe', { tail: 1 });
    });
    socket.on('logLines', (event) => seen.push(event));
    socket.on('disconnect', (reason) => seen.push(`disconnect:${reason}`));

    fleet.fire('connect');
    expect(fleet.emitted).toEqual([['attach', { clusterId: CLUSTER, namespace: 'logs' }]]);

    // Another attachment of the same fleet socket is ignored.
    fleet.fire('attached', { attachmentId: 'other', clusterId: CLUSTER, namespace: 'plans' });
    expect(socket.connected).toBe(false);

    fleet.fire('attached', { attachmentId: 'a1', clusterId: CLUSTER, namespace: 'logs' });
    expect(socket.connected).toBe(true);
    expect(fleet.emitted[1]).toEqual(['emit', { attachmentId: 'a1', event: 'subscribe', args: [{ tail: 1 }] }]);

    fleet.fire('event', { attachmentId: 'other', event: 'logLines', args: ['not mine'] });
    fleet.fire('event', { attachmentId: 'a1', event: 'logLines', args: [{ lines: 2 }] });
    expect(seen).toEqual(['connect', { lines: 2 }]);

    // Cluster side dropped and came back: the next event re-signals connect (the feature re-subscribes).
    fleet.fire('detached', { attachmentId: 'a1', reason: 'transport close' });
    fleet.fire('event', { attachmentId: 'a1', event: 'logLines', args: [{ lines: 3 }] });
    expect(seen).toEqual(['connect', { lines: 2 }, 'disconnect:transport close', 'connect', { lines: 3 }]);

    socket.disconnect();
    expect(fleet.emitted.at(-1)).toEqual(['detach', { attachmentId: 'a1' }]);
    expect(fleet.disconnect).toHaveBeenCalled();
    expect(socket.active).toBe(false);
  });

  it('queues emits until attached', () => {
    const fleet = fakeFleet();
    const socket = new FleetRelaySocket(fleet as unknown as Socket, CLUSTER, 'terminals');

    socket.emit('createTerminal', { target: 'x' });
    fleet.fire('connect');
    fleet.fire('attached', { attachmentId: 't1', clusterId: CLUSTER, namespace: 'terminals' });
    expect(fleet.emitted).toEqual([
      ['attach', { clusterId: CLUSTER, namespace: 'terminals' }],
      ['emit', { attachmentId: 't1', event: 'createTerminal', args: [{ target: 'x' }] }],
    ]);
  });

  it('reports a refused attach as connect_error and stops being active', () => {
    const fleet = fakeFleet();
    const socket = new FleetRelaySocket(fleet as unknown as Socket, CLUSTER, 'terminals');
    const errors: string[] = [];

    socket.on('connect_error', (error) => errors.push((error as Error).message));
    fleet.fire('connect');
    fleet.fire('relayError', { clusterId: CLUSTER, namespace: 'plans', message: 'other namespace' });
    fleet.fire('relayError', {
      clusterId: CLUSTER,
      namespace: 'terminals',
      message: 'needs a cluster-wide operator grant',
    });
    expect(errors).toEqual(['needs a cluster-wide operator grant']);
    expect(socket.active).toBe(false);
    expect(socket.connected).toBe(false);
  });

  it('closes a stream whose access the fleet revoked, with a notice and no retry', () => {
    const fleet = fakeFleet();
    const socket = new FleetRelaySocket(fleet as unknown as Socket, CLUSTER, 'plans');
    const seen: string[] = [];

    socket.on('disconnect', (reason) => seen.push(`disconnect:${reason}`));
    socket.on('connect_error', (error) => seen.push((error as Error).message));
    fleet.fire('connect');
    fleet.fire('attached', { attachmentId: 'p1', clusterId: CLUSTER, namespace: 'plans' });
    fleet.fire('detached', { attachmentId: 'p1', reason: 'access-revoked', message: 'grant removed' });

    expect(seen[0]).toBe('disconnect:access-revoked');
    expect(seen[1]).toContain('revoked');
    expect(seen[1]).toContain('grant removed');
    expect(socket.active).toBe(false);
    // Later events of the closed attachment are ignored.
    fleet.fire('event', { attachmentId: 'p1', event: 'planPatch', args: [] });
    expect(socket.connected).toBe(false);
  });
});
