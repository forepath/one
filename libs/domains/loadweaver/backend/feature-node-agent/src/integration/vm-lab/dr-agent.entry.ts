/**
 * VM lab driver for the whole-cluster disaster-recovery drill (3.20, M6 step 3c), bundled with esbuild by the VM lab
 * global setup and copied into the VMs. It is the real node agent (`apps/loadweaver/backend-node-agent` main: `bootstrap`,
 * `bootstrap --restore`, `join`, `run`) with one lab change: the reconciler applies only the layers this drill needs
 * and replaces the overlay network by static routes —
 * - tunnels: the node's overlay addresses on loopback (real `LoopbackManager`), no WireGuard: every overlay address
 *   of a peer is routed to the peer's endpoint host instead (a stand-in like the static routes of the other labs);
 * - services: the pod network (real `PodNetworkManager`, Docker forward rules, node resolver);
 * - control plane (real `ControlPlaneRoleManager`, without the log store: OpenSearch doesn't fit the lab's memory
 *   next to the rest; its snapshots are covered by the platform-backups integration lab), object store (Garage),
 *   volumes (DRBD), workloads, backup repository servers (Kopia) — all real.
 * Firewall, BIRD, mesh, ingress, registry and the other layers are skipped (not part of the drill).
 *
 * Capacity: the planner reserves the production sizing of a control-plane member (platform + control plane, 3 GiB)
 * before placing workloads; the lab's members have 2.5–3 GiB in total, so the agent advertises that reserve on top of
 * the VM's real memory (`LAB_MEMORY_RESERVE`) — otherwise no workload fits on a two-member lab cluster.
 *
 * Joining a node over plain HTTP (the lab's API has no TLS front) goes through a loopback forwarder: the agent only
 * sends a join token over HTTPS or to the local control plane.
 *
 * usage: node dr-agent.js <agent command…>        (as the agent, e.g. `run`, `bootstrap --restore …`)
 *        node dr-agent.js join-via <api host:port> <agent join flags…>
 */
import { execFileSync } from 'node:child_process';
import { connect, createServer } from 'node:net';

import type { ApplyStep, DesiredState } from '@forepath/loadweaver/shared/util-agent-protocol';

import { HostInfoService } from '../../lib/host/host-info.service';
import { runAgentCli } from '../../lib/join/agent-cli';
import { ReconcilerService } from '../../lib/reconciler/reconciler.service';

type Layer = ApplyStep['layer'];

interface LabReconciler {
  loopback: { apply(addresses: string[]): Promise<boolean> };
  podNetwork: {
    apply(
      network: DesiredState['network'],
    ): Promise<{ changed: boolean; spec: { subnets: string[]; gateways: string[] } }>;
  };
  dockerForward: { apply(): Promise<boolean> };
  dns: {
    bind(input: { listen: string[]; clients: string[]; upstreams: string[] }): Promise<void>;
    update(dns: DesiredState['network']['dns']): void;
  };
  controlPlane: { apply(node: string, address: string, role: DesiredState['controlPlane']): Promise<boolean> };
  objectStore: { apply(role: DesiredState['objectStore'], address: string): Promise<boolean> };
  volumes: { apply(node: string, volumes: NonNullable<DesiredState['volumes']>): Promise<boolean> };
  workloads: {
    removeUndesired(workloads: NonNullable<DesiredState['workloads']>): Promise<boolean>;
    apply(
      workloads: NonNullable<DesiredState['workloads']>,
      gateways: string[],
      client: DesiredState['registryClient'],
    ): Promise<boolean>;
  };
  backupServers?: { apply(role: DesiredState['backupServer']): Promise<boolean> };
}

/** Platform + control-plane reserve of the planner (`workload-planning.utils.ts`), advertised on top (lab only). */
const LAB_MEMORY_RESERVE = (512 + 2560) * 1024 ** 2;
const capacity = HostInfoService.prototype.capacity;

HostInfoService.prototype.capacity = async function (this: HostInfoService, ...args: Parameters<typeof capacity>) {
  const real = await capacity.apply(this, args);

  return { ...real, memoryBytes: real.memoryBytes + LAB_MEMORY_RESERVE };
};

/** Overlay addresses of peers, routed to their endpoint hosts (the drill's stand-in for WireGuard). */
function staticRoutes(network: DesiredState['network']): boolean {
  let changed = false;

  for (const link of network.wireguard) {
    const host = link.peerEndpoint?.replace(/:\d+$/, '').replace(/^\[|\]$/g, '');

    if (!host || !/^\d+\.\d+\.\d+\.\d+$/.test(host)) continue;

    for (const prefix of link.allowedIps.filter((p) => !p.includes(':'))) {
      execFileSync('ip', ['route', 'replace', prefix, 'via', host]);
      changed = true;
    }
  }

  return changed;
}

(ReconcilerService.prototype as unknown as { layers: unknown }).layers = async function (
  this: LabReconciler,
  state: DesiredState,
  steps: ApplyStep[],
): Promise<void> {
  const step = async (layer: Layer, fn: () => Promise<boolean>) => {
    try {
      steps.push({ layer, status: (await fn()) ? 'applied' : 'unchanged' });
    } catch (error) {
      steps.push({ layer, status: 'failed', message: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  };
  const network = state.network;
  const address = network.addresses.find((a) => !a.includes(':')) ?? network.addresses[0];
  let gateways: string[] = [];

  await step('tunnels', async () => {
    const loop = await this.loopback.apply(network.addresses);

    return staticRoutes(network) || loop;
  });
  await step('services', async () => {
    const result = await this.podNetwork.apply(network);
    const forward = result.spec.subnets.length > 0 ? await this.dockerForward.apply() : false;

    gateways = result.spec.gateways;

    if (gateways.length > 0) await this.dns.bind({ listen: gateways, clients: result.spec.subnets, upstreams: [] });

    return result.changed || forward;
  });
  await step('dns', async () => {
    this.dns.update(network.dns);

    return true;
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- dropped on purpose
  const { logStore: _logStore, ...role } = state.controlPlane;
  // The lab has no mail server for login codes: the API skips the forced e-mail second factor.
  const controlPlane = role.environment
    ? { ...role, environment: { ...role.environment, DISABLE_FORCE_LOGIN_2FA: 'true' } }
    : role;

  await step('control-plane', () => this.controlPlane.apply(network.node, address ?? '127.0.0.1', controlPlane));
  await step('object-store', () => this.objectStore.apply(state.objectStore, address ?? '127.0.0.1'));
  // As the reconciler (G5): replicas that go away first, so their volumes can close.
  await step('volumes', async () => {
    const removed = await this.workloads.removeUndesired(state.workloads ?? []);

    return (await this.volumes.apply(network.node, state.volumes ?? [])) || removed;
  });
  await step('workloads', () => this.workloads.apply(state.workloads ?? [], gateways, state.registryClient));

  if (this.backupServers)
    await step('backups', () =>
      (this.backupServers as NonNullable<LabReconciler['backupServers']>).apply(state.backupServer),
    );
};

async function main(): Promise<void> {
  const [command, target, ...rest] = process.argv.slice(2);

  if (command === 'join-via') {
    // 127.0.0.1:3400 → the API, for the join only.
    const [host, port] = target.split(':');
    const forwarder = createServer((socket) => {
      const upstream = connect(Number(port), host);

      socket.pipe(upstream).pipe(socket);
      upstream.on('error', () => socket.destroy());
      socket.on('error', () => upstream.destroy());
    });

    await new Promise<void>((resolve) => forwarder.listen(3400, '127.0.0.1', () => resolve()));
    forwarder.unref();
    process.argv = [process.argv[0], process.argv[1], 'join', '--server', 'http://127.0.0.1:3400', ...rest];
  }

  // The real agent CLI (the same code as `loadweaver-agent`).
  await runAgentCli(
    process.argv.slice(2),
    'usage: dr-agent.js <loadweaver-agent command> | join-via <api> <join flags>',
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
