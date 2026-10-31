import type { SocketAuthService } from '@forepath/identity/backend';
import type { Socket } from 'socket.io';

import type { ProjectAccessService } from '../access/project-access.service';
import type { TopologyService } from '../topology/topology.service';
import { TopologyGateway } from './topology.gateway';

jest.mock('@forepath/identity/backend', () => ({
  ...jest.requireActual('@forepath/identity/backend'),
  buildRequestFromSocketUser: (u: { id: string }) => ({ user: u }),
}));

/** `socket/topology` (3.9 flows, 3.36 B3 structure changes). */
describe('TopologyGateway', () => {
  function setup() {
    let version = 'v1';
    const roles: Record<string, string | undefined> = { admin: 'cluster-admin', dev: undefined };
    const access = {
      caller: jest.fn(async (req: { user: { id: string } }) => ({
        userId: req.user.id,
        isApiKey: false,
        clusterRole: roles[req.user.id],
        projects: new Map([['shop', 'developer']]),
      })),
    } as unknown as ProjectAccessService;
    const topology = {
      structureVersion: jest.fn(async () => version),
      liveFlows: jest.fn(async () => [{ id: 'flow:a->b' }]),
    } as unknown as TopologyService & { liveFlows: jest.Mock };
    const gateway = new TopologyGateway({} as SocketAuthService, access, topology);
    const socket = (id: string) =>
      ({ id, connected: true, data: { userInfo: { id } }, emit: jest.fn() }) as unknown as Socket & {
        emit: jest.Mock;
      };
    const tick = () => (gateway as unknown as { tick: () => Promise<void> }).tick();

    return { gateway, socket, tick, topology, bump: () => (version = 'v2') };
  }

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('sends structure changes to project members who ask for them, flows only to cluster roles', async () => {
    const { gateway, socket, tick, bump } = setup();
    const admin = socket('admin');
    const dev = socket('dev');

    await gateway.subscribe(admin, { structure: true });
    await gateway.subscribe(dev, { structure: true });
    await tick();
    expect(admin.emit).toHaveBeenCalledWith('flows', expect.objectContaining({ edges: [{ id: 'flow:a->b' }] }));
    expect(dev.emit).not.toHaveBeenCalledWith('flows', expect.anything());
    expect(dev.emit).not.toHaveBeenCalledWith('structureChanged', expect.anything());

    bump();
    await tick();
    expect(admin.emit).toHaveBeenCalledWith('structureChanged', { version: 'v2' });
    expect(dev.emit).toHaveBeenCalledWith('structureChanged', { version: 'v2' });
    gateway.onModuleDestroy();
  });

  it('keeps refusing flows-only subscriptions without a cluster role', async () => {
    const { gateway, socket } = setup();
    const dev = socket('dev');

    await gateway.subscribe(dev);
    expect(dev.emit).toHaveBeenCalledWith('error', { message: 'live traffic needs a cluster role' });
    gateway.onModuleDestroy();
  });
});
