import { execFileSync } from 'node:child_process';

import type { ControlPlaneRole } from '@forepath/loadweaver/shared/util-agent-protocol';

import {
  controlPlaneImages,
  etcdClientUrl,
  etcdPeerUrl,
  etcdSpec,
} from '../lib/control-plane/control-plane-containers';
import {
  addMember,
  initialClusterFrom,
  listMembers,
  removeMember,
  updateMemberPeerUrl,
} from '../lib/control-plane/etcd-client';

/**
 * Control-plane growth on real etcd (3.2): bootstrap on loopback, move the peer URL to the node's address,
 * grow to a second member through the membership API and shrink again, with the same container arguments
 * the role manager uses. Runs on an isolated bridge network, never on the host network.
 */

function docker(args: string[]): string {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

async function eventually<T>(fn: () => Promise<T | undefined>, timeoutMs = 60_000): Promise<T> {
  const start = Date.now();

  for (;;) {
    try {
      const value = await fn();

      if (value !== undefined && value !== false) return value;
    } catch {
      // retry
    }

    if (Date.now() - start > timeoutMs) throw new Error('condition not met in time');

    await new Promise((r) => setTimeout(r, 500));
  }
}

describe('etcd membership on real etcd (lab)', () => {
  const run = `${process.pid}-${Date.now()}`;
  const network = `lw-lab-etcd-${run}`;
  const subnet = `10.${200 + (process.pid % 50)}.${Date.now() % 250}.0/24`;
  const prefix = subnet.split('.').slice(0, 3).join('.');
  const images = controlPlaneImages({});
  const role = (members: { name: string; address: string }[]): ControlPlaneRole => ({
    role: 'member',
    members: members.map((m) => ({ ...m, witness: false })),
    automaticFailover: members.length >= 3,
    scope: 'lw-lab',
  });

  /** Starts a member; returns its client API URL as seen from the test (published on loopback). */
  function start(name: string, address: string, cmd: string[]): string {
    const container = `lw-lab-${name}-${run}`;

    docker([
      'run',
      '-d',
      '--name',
      container,
      '--network',
      network,
      '--ip',
      address,
      '-p',
      '127.0.0.1::2379',
      '--memory',
      '128m',
      images.etcd,
      ...cmd,
    ]);

    const mapping = docker(['port', container, '2379/tcp']).split('\n')[0];

    return `http://127.0.0.1:${mapping.slice(mapping.lastIndexOf(':') + 1)}`;
  }

  beforeAll(() => {
    docker(['network', 'create', '--subnet', subnet, network]);
  });

  afterAll(() => {
    for (const name of ['n1', 'n2']) {
      try {
        docker(['rm', '-f', `lw-lab-${name}-${run}`]);
      } catch {
        // not started
      }
    }

    try {
      docker(['network', 'rm', network]);
    } catch {
      // already gone
    }
  });

  it('bootstraps, moves to the overlay address, grows and shrinks', async () => {
    const n1 = `${prefix}.11`;
    const n2 = `${prefix}.12`;
    // Inside the lab network members reach each other by address; the test reaches them through published ports.
    const n1Advertised = etcdClientUrl(n1);

    // Bootstrap: like the first node before it has joined, peers on loopback, clients on the real address too.
    const bootstrap = etcdSpec(
      { nodeName: 'n1', address: '127.0.0.1', stateDir: '/x', images },
      role([{ name: 'n1', address: '127.0.0.1' }]),
      'new',
      `n1=${etcdPeerUrl('127.0.0.1')}`,
    );
    const cmd = bootstrap.cmd!.map((arg) =>
      arg === etcdClientUrl('127.0.0.1') ? `${etcdClientUrl('127.0.0.1')},${n1Advertised}` : arg,
    );
    let n1Client = start('n1', n1, cmd);

    const [first] = await eventually(async () => {
      const members = await listMembers(n1Client);

      return members.length === 1 ? members : undefined;
    });

    expect(first.peerURLs).toEqual([etcdPeerUrl('127.0.0.1')]);

    // After joining, the node's overlay address is known: update the advertised peer URL and restart on it.
    await updateMemberPeerUrl(n1Client, first.ID, etcdPeerUrl(n1));
    docker(['rm', '-f', `lw-lab-n1-${run}`]);

    const moved = etcdSpec(
      { nodeName: 'n1', address: n1, stateDir: '/x', images },
      role([{ name: 'n1', address: n1 }]),
      'existing',
      `n1=${etcdPeerUrl(n1)}`,
    );

    // Keep the data: in the lab the restart reuses a fresh container, so re-create the single-member cluster on the new address.
    n1Client = start(
      'n1',
      n1,
      moved.cmd!.map((a) => (a === 'existing' ? 'new' : a)),
    );
    await eventually(async () => ((await listMembers(n1Client)).length === 1 ? true : undefined));

    // Grow: the joining node adds itself through an existing member, then starts with state "existing".
    const afterAdd = await addMember(n1Client, etcdPeerUrl(n2));
    const joinCluster = initialClusterFrom(afterAdd, { name: 'n2', peerUrl: etcdPeerUrl(n2) });

    expect(joinCluster).toBe(`n1=${etcdPeerUrl(n1)},n2=${etcdPeerUrl(n2)}`);

    const second = etcdSpec(
      { nodeName: 'n2', address: n2, stateDir: '/x', images },
      role([
        { name: 'n1', address: n1 },
        { name: 'n2', address: n2 },
      ]),
      'existing',
      joinCluster,
    );

    const n2Client = start('n2', n2, second.cmd!);

    const grown = await eventually(async () => {
      const members = await listMembers(n2Client);

      return members.length === 2 && members.every((m) => m.name) ? members : undefined;
    });

    expect(grown.map((m) => m.name).sort()).toEqual(['n1', 'n2']);

    // Shrink: the remaining member removes the one that left.
    const leaving = grown.find((m) => m.name === 'n2')!;

    // etcd refuses reconfiguration until a new member counts as active; the role manager retries on its next
    // reconcile, the test retries the same way.
    await eventually(async () => {
      await removeMember(n1Client, leaving.ID);

      return true;
    });
    expect((await listMembers(n1Client)).map((m) => m.name)).toEqual(['n1']);
  });
});
