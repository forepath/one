import { Module } from '@nestjs/common';

import { ControlPlaneRoleManager } from './control-plane/control-plane-role.manager';
import { PostgresLeaderProxy } from './control-plane/postgres-leader-proxy';
import { DnsResolverService } from './dns/dns-resolver.service';
import { CommandRunner } from './host/command-runner';
import { dockerProvider } from './host/docker.provider';
import { HostInfoService } from './host/host-info.service';
import { ManagedContainers } from './host/managed-containers';
import { JoinService } from './join/join.service';
import { BirdManager } from './network/bird.manager';
import { LoopbackManager } from './network/loopback.manager';
import { NftablesManager } from './network/nftables.manager';
import { PodNetworkManager } from './network/pod-network.manager';
import { DockerForwardManager } from './network/docker-forward.manager';
import { PublicAddressManager } from './network/public-address.manager';
import { IngressManager } from './ingress/ingress.manager';
import { AuthoritativeDnsManager } from './dns/authoritative-dns.manager';
import { EgressRoutingManager } from './network/egress-routing.manager';
import { MeshManager } from './mesh/mesh.manager';
import { WorkloadIdentityManager } from './mesh/workload-identity.manager';
import { ImageScanner } from './images/image-scanner';
import { ProbeManager } from './probes/probe.manager';
import { VpnManager } from './network/vpn.manager';
import { RateLimiterManager } from './ratelimit/ratelimit.manager';
import { WireguardManager } from './network/wireguard.manager';
import { ReconcilerService } from './reconciler/reconciler.service';
import { AgentStateStore } from './state/agent-state.store';
import { AgentConnectionService } from './stream/agent-connection.service';
import { SecretBroker } from './workloads/secret-broker.service';
import { VolumeManager } from './volumes/volume.manager';
import { VolumePluginServer } from './volumes/volume-plugin.server';
import { WorkloadManager } from './workloads/workload.manager';
import { ObjectStoreManager } from './object-store/object-store.manager';
import { RegistryManager } from './registry/registry.manager';
import { RegistryRouter } from './registry/registry-router';

/**
 * The Loadweaver node agent (5): a Node.js SEA run by systemd, outside Docker, managing the host network,
 * the container runtime and the control-plane role of its node.
 */
@Module({
  providers: [
    dockerProvider,
    CommandRunner,
    HostInfoService,
    ManagedContainers,
    AgentStateStore,
    LoopbackManager,
    WireguardManager,
    BirdManager,
    NftablesManager,
    PodNetworkManager,
    DockerForwardManager,
    PublicAddressManager,
    IngressManager,
    AuthoritativeDnsManager,
    EgressRoutingManager,
    MeshManager,
    WorkloadIdentityManager,
    ImageScanner,
    ProbeManager,
    VpnManager,
    RateLimiterManager,
    DnsResolverService,
    PostgresLeaderProxy,
    ControlPlaneRoleManager,
    SecretBroker,
    WorkloadManager,
    VolumeManager,
    VolumePluginServer,
    ObjectStoreManager,
    RegistryManager,
    RegistryRouter,
    ReconcilerService,
    AgentConnectionService,
    JoinService,
  ],
  exports: [AgentConnectionService, JoinService, AgentStateStore],
})
export class NodeAgentModule {}
