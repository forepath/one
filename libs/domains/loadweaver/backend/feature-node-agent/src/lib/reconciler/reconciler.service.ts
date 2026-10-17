import {
  desiredStateSchema,
  type ApplyReport,
  type ApplyStep,
  type DesiredState,
} from '@forepath/loadweaver/shared/util-agent-protocol';
import { Injectable, Logger } from '@nestjs/common';

import { ControlPlaneRoleManager } from '../control-plane/control-plane-role.manager';
import { DnsResolverService } from '../dns/dns-resolver.service';
import { BirdManager } from '../network/bird.manager';
import { MeshManager } from '../mesh/mesh.manager';
import { EgressRoutingManager } from '../network/egress-routing.manager';
import { LoopbackManager } from '../network/loopback.manager';
import { NftablesManager } from '../network/nftables.manager';
import { PodNetworkManager } from '../network/pod-network.manager';
import { VpnManager } from '../network/vpn.manager';
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
import { WorkloadManager } from '../workloads/workload.manager';

type Layer = ApplyStep['layer'];

function message(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2000);
}

/**
 * Applies desired states to the host, layer by layer: tunnels → routing → filtering / services → DNS →
 * control plane. If a layer fails, the last successfully applied state is re-applied (3.19: failed applies
 * roll back), and the report says exactly which layers succeeded, failed or were rolled back.
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
  ) {}

  /** Applies are serialized; a newer state queued behind an older one is applied after it. */
  apply(desired: DesiredState): Promise<ApplyReport> {
    const run = this.chain.then(() => this.applyNow(desired));

    this.chain = run.catch(() => undefined);

    return run;
  }

  private async layers(state: DesiredState, steps: ApplyStep[]): Promise<void> {
    const step = async (layer: Layer, fn: () => Promise<boolean>) => {
      try {
        steps.push({ layer, status: (await fn()) ? 'applied' : 'unchanged' });
      } catch (error) {
        steps.push({ layer, status: 'failed', message: message(error) });
        throw error;
      }
    };
    const network = state.network;
    let gateways: string[] = [];
    const address = network.addresses.find((a) => !a.includes(':')) ?? network.addresses[0];

    await step('tunnels', async () => {
      const loop = await this.loopback.apply([...network.addresses, ...loopbackPublicAddresses(state.publicAddresses)]);

      return (await this.wireguard.apply(network.wireguard)) || loop;
    });
    await step('routing', async () => {
      const bird = await this.bird.apply(network, state.externalBgp);

      return (await this.egressRouting.apply(network.egress)) || bird;
    });
    await step('filtering', () => this.nftables.apply(network));
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
          clients: [...result.spec.subnets, ...(vpn?.prefixes ?? [])],
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
    await step('control-plane', () =>
      this.controlPlane.apply(network.node, address ?? '127.0.0.1', state.controlPlane),
    );
    // Object store and registry before workloads: images are pulled through the cluster (3.20, 3.22).
    await step('object-store', () => this.objectStore.apply(state.objectStore, address ?? '127.0.0.1'));
    await step('registry', async () => {
      const instances = await this.registry.apply(state.registry, address ?? '127.0.0.1');
      const router = await this.registryRouter.apply(
        state.registryClient,
        privateRepositories(state.workloads ?? [], state.registryClient),
      );

      return instances || router;
    });
    await step('ingress', () => this.ingress.apply(network.node, state.ingress));
    await step('authoritative-dns', () => this.authoritativeDns.apply(state.authoritativeDns));
    await step('rate-limiter', () => this.rateLimiter.apply(state.rateLimiter, address ?? '127.0.0.1'));
    // Volumes before workloads: containers mount them through the volume plugin (3.5).
    await step('volumes', () => this.volumes.apply(network.node, state.volumes ?? []));
    // Workloads use the node-local, policy-aware resolver on the pod network gateways (3.4).
    await step('workloads', () => this.workloads.apply(state.workloads ?? [], gateways, state.registryClient));
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

    try {
      await this.layers(desired, steps);
      await this.state.saveAppliedState(desired);

      return { revision: desired.revision, status: 'applied', steps };
    } catch (error) {
      const previous = await this.state.appliedState();

      this.logger.error(`Applying revision ${desired.revision} failed: ${message(error)}`);

      if (!previous || previous.revision === desired.revision) {
        return { revision: desired.revision, status: 'failed', steps, error: message(error) };
      }

      try {
        await this.layers(previous, []);

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
