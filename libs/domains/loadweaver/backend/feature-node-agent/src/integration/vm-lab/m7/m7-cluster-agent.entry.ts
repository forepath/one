/**
 * VM lab driver of the M7 cluster specs (exact-level scheduling through the control plane, VMs through the API,
 * Agenstra on Loadweaver, capability updates), bundled with decorator metadata by the M7 global setup and copied into
 * the VMs. Like the DR drill's driver (`dr-agent.entry.ts`) it is the real node agent (`bootstrap`, `join`, `run`,
 * the real stream, isolation probes, host settings, workloads, microVMs, VMs, consoles, migrations) with one lab
 * change: the reconciler applies only the layers the cluster specs need and replaces the overlay network by static
 * routes —
 * - tunnels: overlay addresses on loopback (real `LoopbackManager`), peers' overlay addresses routed to their
 *   endpoint hosts instead of WireGuard;
 * - services: the pod network (real `PodNetworkManager`, Docker forward rules, node resolver);
 * - control plane (real, without the log store: OpenSearch doesn't fit next to nested guests), object store (Garage),
 *   **registry** (built-in registry + the node's router: `loadweaver vm-image push`, VM image imports, private
 *   images), volumes (DRBD, block mode for VM disks), workloads, backup repository servers (Kopia) — all real.
 * Firewall, BIRD, mesh, ingress and the other layers are skipped.
 *
 * Lab settings for the control-plane role: no forced e-mail second factor (no mail server), and the microVM launcher
 * image of this tree (`LOADWEAVER_MICROVM_LAUNCHER_IMAGE`, loaded into the VMs, never pulled) for the planner.
 * Capacity: like the DR drill, the control-plane member reserve is advertised on top of the VM's memory.
 *
 * usage: node m7-cluster-agent.js <agent command…>
 *        node m7-cluster-agent.js join-via <api host:port> <agent join flags…>
 */
import { execFileSync } from 'node:child_process';
import { connect, createServer } from 'node:net';

import type { ApplyStep, DesiredState } from '@forepath/loadweaver/shared/util-agent-protocol';

import { HostInfoService } from '../../../lib/host/host-info.service';
import { runAgentCli } from '../../../lib/join/agent-cli';
import { ReconcilerService } from '../../../lib/reconciler/reconciler.service';
import { privateRepositories } from '../../../lib/registry/image-routing';

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
  registry: { apply(role: DesiredState['registry'], address: string): Promise<boolean> };
  registryRouter: { apply(client: DesiredState['registryClient'], repositories: Set<string>): Promise<boolean> };
  volumes: { apply(node: string, volumes: NonNullable<DesiredState['volumes']>): Promise<boolean> };
  workloads: {
    apply(
      workloads: NonNullable<DesiredState['workloads']>,
      gateways: string[],
      client: DesiredState['registryClient'],
    ): Promise<boolean>;
  };
  backupServers?: { apply(role: DesiredState['backupServer']): Promise<boolean> };
}

/** Platform + control-plane reserve of the planner, advertised on top (lab only, as in the DR drill). */
const LAB_MEMORY_RESERVE = (512 + 2560) * 1024 ** 2;
const capacity = HostInfoService.prototype.capacity;

HostInfoService.prototype.capacity = async function (this: HostInfoService, ...args: Parameters<typeof capacity>) {
  const real = await capacity.apply(this, args);

  return { ...real, memoryBytes: real.memoryBytes + LAB_MEMORY_RESERVE };
};

/** Overlay addresses of peers, routed to their endpoint hosts (the lab's stand-in for WireGuard). */
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

/** Lab settings of the control-plane container (see the file comment). */
function labControlPlane(role: DesiredState['controlPlane']): DesiredState['controlPlane'] {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- dropped on purpose
  const { logStore: _logStore, ...rest } = role;
  const launcher = process.env['LOADWEAVER_MICROVM_LAUNCHER_IMAGE'];

  return (
    rest.environment
      ? {
          ...rest,
          environment: {
            ...rest.environment,
            DISABLE_FORCE_LOGIN_2FA: 'true',
            ...(launcher ? { LOADWEAVER_MICROVM_LAUNCHER_IMAGE: launcher } : {}),
          },
        }
      : rest
  ) as DesiredState['controlPlane'];
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
  await step('control-plane', () =>
    this.controlPlane.apply(network.node, address ?? '127.0.0.1', labControlPlane(state.controlPlane)),
  );
  await step('object-store', () => this.objectStore.apply(state.objectStore, address ?? '127.0.0.1'));
  await step('registry', async () => {
    const instances = await this.registry.apply(state.registry, address ?? '127.0.0.1');
    const router = await this.registryRouter.apply(
      state.registryClient,
      new Set(privateRepositories(state.workloads ?? [], state.registryClient)),
    );

    return instances || router;
  });
  await step('volumes', async () => {
    const result = (await this.volumes.apply(network.node, state.volumes ?? [])) as boolean | { changed: boolean };

    return typeof result === 'boolean' ? result : result.changed;
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
    // 127.0.0.1:3400 → the API, for the join only (the agent sends a join token only over HTTPS or locally).
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
    'usage: m7-cluster-agent.js <loadweaver-agent command> | join-via <api> <join flags>',
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
