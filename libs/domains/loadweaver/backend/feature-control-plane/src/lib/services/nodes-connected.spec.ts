import { NODE_HEARTBEAT_TIMEOUT_MS } from '../constants/control-plane.constants';
import { nodeConnectedInCluster } from './nodes.service';

/** `GET /nodes` `connected` is the cluster's view, not this replica's sessions (3.43). */
describe('nodeConnectedInCluster', () => {
  const now = Date.parse('2026-10-30T12:00:00Z');
  const node = (connected: boolean, agoMs: number | null, lifecycle = 'active') =>
    ({
      connected,
      lastSeenAt: agoMs === null ? null : new Date(now - agoMs),
      lifecycle,
    }) as never;

  it('counts a fresh heartbeat recorded by any replica', () => {
    expect(nodeConnectedInCluster(node(true, 5_000), now)).toBe(true);
    expect(nodeConnectedInCluster(node(true, NODE_HEARTBEAT_TIMEOUT_MS), now)).toBe(true);
  });

  it('not a stale one, a recorded disconnect, a node never seen, or one that left', () => {
    expect(nodeConnectedInCluster(node(true, NODE_HEARTBEAT_TIMEOUT_MS + 1), now)).toBe(false);
    expect(nodeConnectedInCluster(node(false, 1_000), now)).toBe(false);
    expect(nodeConnectedInCluster(node(true, null), now)).toBe(false);
    expect(nodeConnectedInCluster(node(true, 1_000, 'left'), now)).toBe(false);
  });
});
