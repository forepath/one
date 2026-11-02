import {
  desiredStateSchema,
  type ApplyReport,
  type ApplyStep,
  type DesiredState,
} from '@forepath/loadweaver/shared/util-agent-protocol';
import { Injectable, Logger, Optional } from '@nestjs/common';

import { ControlPlaneRoleManager } from '../control-plane/control-plane-role.manager';
import { DnsResolverService } from '../dns/dns-resolver.service';
import { BirdManager } from '../network/bird.manager';
import { MeshManager } from '../mesh/mesh.manager';
import { EgressRoutingManager } from '../network/egress-routing.manager';
import { LoopbackManager } from '../network/loopback.manager';
import { NftablesManager } from '../network/nftables.manager';
import { PodNetworkManager } from '../network/pod-network.manager';
import { VpnManager } from '../network/vpn.manager';
import { LogCollectorsService } from '../logs/log-collectors.service';
import { WireguardManager } from '../network/wireguard.manager';
import { AgentStateStore } from '../state/agent-state.store';
import { VolumeManager } from '../volumes/volume.manager';
import { ObjectStoreManager } from '../object-store/object-store.manager';
import { DockerForwardManager } from '../network/docker-forward.manager';
import { loopbackPublicAddresses, PublicAddressManager } from '../network/public-address.manager';
import { IngressManager } from '../ingress/ingress.manager';
import { AuthoritativeDnsManager } from '../dns/authoritative-dns.manager';
import { RateLimiterManager } from '../ratelimit/ratelimit.manager';
import { privateRepositories } from '../registry/image-routing';
import { RegistryManager } from '../registry/registry.manager';
import { RegistryRouter } from '../registry/registry-router';
import { clusterImageRepositories, setClusterImageRouting } from '../updates/release-images';
import { UpdatesService } from '../updates/updates.service';
import { WorkloadManager } from '../workloads/workload.manager';
import { KopiaServerManager } from '../backups/kopia-server.manager';

type Layer = ApplyStep['layer'];

function message(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2000);
}

/**
 * Host routes of addresses a replica kept from another node in a live migration (3.10): the workload's, and for a
 * full VM those of its further NICs (`vm.nics[].hostRoutes`, M7.4); each NIC's guest resolves through this node.
 */
export function keptHostRoutes(workload: NonNullable<DesiredState['workloads']>[number]): string[] {
  return [...(workload.hostRoutes ?? []), ...(workload.vm?.nics ?? []).flatMap((nic) => nic.hostRoutes ?? [])];
}

/**
 * Applies desired states to the host, layer by layer: tunnels → routing → filtering / services → DNS →
 * control plane. If a layer fails, the last successfully applied state is re-applied (3.19: failed applies
 * roll back), and the report says exactly which layers succeeded, failed or were rolled back. The control-plane role
 * is the exception (3.43): its failure is reported (step + `error`) while the other layers apply.
 */
@Injectable()
export class ReconcilerService {
  private readonly logger = new Logger(ReconcilerService.name);
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly loopback: LoopbackManager,
    private readonly egressRouting: EgressRoutingManager,
    private readonly mesh: MeshManager,
    private readonly wireguard: WireguardManager,
    private readonly bird: BirdManager,
    private readonly nftables: NftablesManager,
    private readonly podNetwork: PodNetworkManager,
    private readonly dns: DnsResolverService,
    private readonly controlPlane: ControlPlaneRoleManager,
    private readonly state: AgentStateStore,
    private readonly workloads: WorkloadManager,
    private readonly volumes: VolumeManager,
    private readonly objectStore: ObjectStoreManager,
    private readonly registry: RegistryManager,
    private readonly registryRouter: RegistryRouter,
    private readonly dockerForward: DockerForwardManager,
    private readonly publicAddresses: PublicAddressManager,
    private readonly ingress: IngressManager,
    private readonly authoritativeDns: AuthoritativeDnsManager,
    private readonly rateLimiter: RateLimiterManager,
    private readonly vpn: VpnManager,
    private readonly logs: LogCollectorsService,
    @Optional() private readonly updates?: UpdatesService,
    @Optional() private readonly backupServers?: KopiaServerManager,
  ) {}

  /** Applies are serialized; a newer state queued behind an older one is applied after it. */
  apply(desired: DesiredState): Promise<ApplyReport> {
    const run = this.chain.then(() => this.applyNow(desired));

    this.chain = run.catch(() => undefined);

    return run;
  }

  /**
   * `isolated` collects the failures of layers that don't fail the apply (the control-plane role, 3.43): a member
   * whose etcd can't start yet still runs its network, object store, registry and workloads.
   */
  private async layers(state: DesiredState, steps: ApplyStep[], isolated: string[] = []): Promise<void> {
    // A layer reports whether it changed anything, optionally with a warning that doesn't fail the apply.
    const step = async (
      layer: Layer,
      fn: () => Promise<boolean | { changed: boolean; message?: string }>,
      options: { isolated?: boolean } = {},
    ) => {
      try {
        const result = await fn();
        const { changed, message: warning } = typeof result === 'boolean' ? { changed: result } : result;

        steps.push({ layer, status: changed ? 'applied' : 'unchanged', ...(warning ? { message: warning } : {}) });
      } catch (error) {
        steps.push({ layer, status: 'failed', message: message(error) });

        if (!options.isolated) throw error;

        this.logger.warn(`Layer ${layer} failed, applying the others: ${message(error)}`);
        isolated.push(`${layer}: ${message(error)}`);
      }
    };
    const network = state.network;
    let gateways: string[] = [];
    const address = network.addresses.find((a) => !a.includes(':')) ?? network.addresses[0];

    // The release this node runs (3.26) first: every later layer renders its containers with the release's images.
    if (this.updates)
      await step('components', async () => {
        const changed = await (this.updates as UpdatesService).apply(
          state.components,
          state.controlPlane,
          address ?? '127.0.0.1',
        );

        // Air-gapped clusters: release images from the cluster registry (`lw-system/<component>`).
        setClusterImageRouting(state.registryClient, state.components?.clusterImages ?? []);

        return changed;
      });
    await step('tunnels', async () => {
      const loop = await this.loopback.apply([...network.addresses, ...loopbackPublicAddresses(state.publicAddresses)]);

      return (await this.wireguard.apply(network.wireguard)) || loop;
    });
    await step('routing', async () => {
      const bird = await this.bird.apply(network, state.externalBgp);

      return (await this.egressRouting.apply(network.egress)) || bird;
    });
    await step('filtering', async () => {
      const changed = await this.nftables.apply(network);

      // Firewall log lines name the policy whose rule matched (3.14).
      this.logs.updateFirewall(network);
      this.logs.updateWorkloads(state.workloads ?? []);

      return changed;
    });
    // Remote access gateway after its filter rules are in place (3.31).
    await step('remote-access', () => this.vpn.apply(network.remoteAccess));
    await step('services', async () => {
      const result = await this.podNetwork.apply(network);
      const forward = result.spec.subnets.length > 0 ? await this.dockerForward.apply() : false;
      // Remote clients use the resolver on the active gateway's client-network address (split DNS).
      const vpn = network.remoteAccess?.active ? network.remoteAccess : undefined;

      gateways = result.spec.gateways;

      if (result.spec.gateways.length > 0 || vpn) {
        await this.dns.bind({
          listen: [...result.spec.gateways, ...(vpn ? [vpn.address.split('/')[0]] : [])],
          // Replicas that kept their address in a live migration (3.10) resolve here too, a VM with every NIC.
          clients: [
            ...result.spec.subnets,
            ...(state.workloads ?? []).flatMap(keptHostRoutes),
            ...(vpn?.prefixes ?? []),
          ],
          upstreams: [],
        });
      }

      return result.changed || forward;
    });
    // After the pod network: the proxy listens on its gateways (3.7).
    await step('mesh', () => this.mesh.apply(network.node, network));
    await step('public-addresses', () => this.publicAddresses.apply(network.node, state.publicAddresses ?? []));
    await step('dns', async () => {
      this.dns.update(network.dns);

      return true;
    });
    // Isolated (3.43): a failing member role (e.g. etcd waiting for its bootstrap) is reported, the rest applies.
    await step(
      'control-plane',
      () => this.controlPlane.apply(network.node, address ?? '127.0.0.1', state.controlPlane),
      {
        isolated: true,
      },
    );
    // Object store and registry before workloads: images are pulled through the cluster (3.20, 3.22).
    await step('object-store', () => this.objectStore.apply(state.objectStore, address ?? '127.0.0.1'));
    await step('registry', async () => {
      const instances = await this.registry.apply(state.registry, address ?? '127.0.0.1');
      const router = await this.registryRouter.apply(
        state.registryClient,
        new Set([...privateRepositories(state.workloads ?? [], state.registryClient), ...clusterImageRepositories()]),
      );

      return instances || router;
    });
    await step('ingress', () => this.ingress.apply(network.node, state.ingress));
    await step('authoritative-dns', () => this.authoritativeDns.apply(state.authoritativeDns));
    await step('rate-limiter', () => this.rateLimiter.apply(state.rateLimiter, address ?? '127.0.0.1'));
    // Volumes before workloads: containers mount them through the volume plugin (3.5). Replicas that go away are
    // removed first, though: a volume leaving with them can only close once they let go of it (G5: a VM and its disk
    // removed together failed this step on every reconcile, and the workloads step never removed the VM).
    await step('volumes', async () => {
      const removed = await this.workloads.removeUndesired(state.workloads ?? []);
      const volumes = await this.volumes.apply(network.node, state.volumes ?? []);

      return {
        changed: removed || volumes,
        // Removed DRBD peers whose bitmap slot couldn't be freed yet (retried every reconcile): visible on the node.
        message: this.volumes.forgetPeerWarning(),
      };
    });
    // Workloads use the node-local, policy-aware resolver on the pod network gateways (3.4).
    await step('workloads', () => this.workloads.apply(state.workloads ?? [], gateways, state.registryClient));
    // Backup repository servers on control-plane members (3.20); none wanted → removed.
    if (this.backupServers)
      await step('backups', () => (this.backupServers as KopiaServerManager).apply(state.backupServer));
  }

  private async applyNow(input: DesiredState): Promise<ApplyReport> {
    const parsed = desiredStateSchema.safeParse(input);

    if (!parsed.success) {
      return {
        revision: input.revision ?? 0,
        status: 'failed',
        steps: [],
        error: 'desired state failed validation on the node',
      };
    }

    const desired = parsed.data;
    const steps: ApplyStep[] = [];
    const isolated: string[] = [];

    try {
      await this.layers(desired, steps, isolated);
      await this.state.saveAppliedState(desired);
      // Every layer ran with the release's images: only now does the node report the release (3.26 gates). Not while
      // the control-plane role failed: an update rollout waits for it.
      if (isolated.length === 0) await this.updates?.confirmApplied(desired.components?.release);

      return {
        revision: desired.revision,
        status: 'applied',
        steps,
        // The isolated failures stay visible on the node (`applyError`) while the revision counts as applied.
        ...(isolated.length > 0 ? { error: isolated.join('; ').slice(0, 4096) } : {}),
      };
    } catch (error) {
      const previous = await this.state.appliedState();

      this.logger.error(`Applying revision ${desired.revision} failed: ${message(error)}`);

      if (!previous || previous.revision === desired.revision) {
        return { revision: desired.revision, status: 'failed', steps, error: message(error) };
      }

      try {
        await this.layers(previous, []);
        await this.updates?.confirmApplied(previous.components?.release);

        return { revision: desired.revision, status: 'rolled-back', steps, error: message(error) };
      } catch (rollbackError) {
        // The real state is reported, never hidden (3.19).
        return {
          revision: desired.revision,
          status: 'failed',
          steps,
          error: `${message(error)}; rollback to revision ${previous.revision} failed: ${message(rollbackError)}`,
        };
      }
    }
  }
}
