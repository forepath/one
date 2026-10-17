import {
  DynamicProviderLoaderService,
  registerDynamicProviders,
} from '@forepath/shared/backend/util-dynamic-provider-registry';
import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AgentSessionRegistry } from '../agent-stream/agent-session.registry';
import { AgentStreamServer } from '../agent-stream/agent-stream.server';
import { ClusterController } from '../controllers/cluster.controller';
import { CronRunsController } from '../controllers/cron-runs.controller';
import { RegistryController } from '../controllers/registry.controller';
import { CertificatesController } from '../controllers/certificates.controller';
import { DnsController } from '../controllers/dns.controller';
import { DnsService } from '../dns/dns.service';
import { RpkiCheckService } from '../bgp/rpki-check.service';
import { DnsReconcilerService } from '../dns/dns-reconciler.service';
import { DnsZoneStatusEntity } from '../entities/dns-zone-status.entity';
import { DnsZoneSerialEntity } from '../entities/dns-zone-serial.entity';
import { DnssecKeyEntity } from '../entities/dnssec-key.entity';
import { ImageScanEntity } from '../entities/image-scan.entity';
import { DnsFailoverStateEntity, ProbeResultEntity } from '../entities/dns-failover.entity';
import { DnsFailoverControllerService } from '../dns/dns-failover-controller.service';
import { DnssecService } from '../dns/dnssec.service';
import { WorkloadIdentityService } from '../mesh/workload-identity.service';
import { ImagePolicyService } from '../images/image-policy.service';
import { ImagesController } from '../controllers/images.controller';
import { VpnController } from '../controllers/vpn.controller';
import { VpnClientEntity, VpnGatewayKeyEntity } from '../entities/vpn-client.entity';
import {
  DYNAMIC_POSTURE_PLUGINS_ENV,
  PosturePluginRegistry,
  type PosturePluginFactory,
} from '../remote-access/posture-plugin';
import { RemoteAccessService } from '../remote-access/remote-access.service';
import { CertificatesService } from '../acme/certificates.service';
import { AcmeAccountEntity, AcmeChallengeEntity, CertificateEntity } from '../entities/certificate.entity';
import { BasicToBearerMiddleware } from '../registry/basic-to-bearer.middleware';
import { RegistryProxyService } from '../registry/registry-proxy.service';
import { DYNAMIC_KMS_PROVIDERS_ENV, MasterKeyKmsRegistry, type MasterKeyKmsProvider } from '../kms/master-key-kms';
import { VaultTransitKms } from '../kms/vault-transit.kms';
import { InstallController } from '../controllers/install.controller';
import { JoinTokensController } from '../controllers/join-tokens.controller';
import { NodeJoinController } from '../controllers/node-join.controller';
import { NodesController } from '../controllers/nodes.controller';
import { PlansController } from '../controllers/plans.controller';
import { ResourcesController } from '../controllers/resources.controller';
import { SecretsController } from '../controllers/secrets.controller';
import { AuditEventEntity } from '../entities/audit-event.entity';
import { ClusterMemberEntity } from '../entities/cluster-member.entity';
import { ClusterEntity } from '../entities/cluster.entity';
import { CronRunEntity, CronScheduleEntity } from '../entities/cron-run.entity';
import { ObjectStoreGenerationEntity } from '../entities/object-store-generation.entity';
import { PublicAddressEntity } from '../entities/public-address.entity';
import { PublicAddressService } from '../ipam/public-address.service';
import { PublicAddressControllerService } from '../services/public-address-controller.service';
import { PlatformCredentialsService } from '../services/platform-credentials.service';
import {
  DnsProviderRegistry,
  DYNAMIC_DNS_PROVIDERS_ENV,
  DYNAMIC_FAILOVER_IP_PROVIDERS_ENV,
  FailoverIpProviderRegistry,
  RegistrarProviderRegistry,
  DYNAMIC_REGISTRAR_PROVIDERS_ENV,
  type RegistrarProviderFactory,
  type DnsProviderFactory,
  type FailoverIpProviderFactory,
} from '@forepath/shared/backend/util-hosting-providers';
import { JoinTokenEntity } from '../entities/join-token.entity';
import { NodeDesiredStateEntity } from '../entities/node-desired-state.entity';
import { NodeEntity } from '../entities/node.entity';
import { PlanEntity } from '../entities/plan.entity';
import { ResourceEntity } from '../entities/resource.entity';
import { ServiceAddressEntity } from '../entities/service-address.entity';
import { VolumePlacementEntity } from '../entities/volume-placement.entity';
import { WorkloadPlacementEntity } from '../entities/workload-placement.entity';
import { DeploymentStateEntity } from '../entities/deployment-state.entity';
import { MasterKeyEntity } from '../entities/master-key.entity';
import { SecretEntity } from '../entities/secret.entity';
import { UnsealRequestEntity, UnsealShareEntity } from '../entities/unseal.entity';
import { ClusterMembersRepository } from '../repositories/cluster-members.repository';
import { JoinTokensRepository } from '../repositories/join-tokens.repository';
import { NodesRepository } from '../repositories/nodes.repository';
import { ResourcesRepository } from '../repositories/resources.repository';
import { AuditLogService } from '../services/audit-log.service';
import { ClusterAccessService } from '../services/cluster-access.service';
import { ClusterBootstrapService } from '../services/cluster-bootstrap.service';
import { ClusterIdentityService } from '../services/cluster-identity.service';
import { CronControllerService } from '../services/cron-controller.service';
import { ObjectStoreControllerService } from '../services/object-store-controller.service';
import { RegistryTokenService } from '../services/registry-token.service';
import { InstallService } from '../services/install.service';
import { JoinTokensService } from '../services/join-tokens.service';
import { NetworkStateService } from '../services/network-state.service';
import { NodeAgentsService } from '../services/node-agents.service';
import { NodesService } from '../services/nodes.service';
import { PlansService } from '../services/plans.service';
import { ResourceStoreService } from '../services/resource-store.service';
import { WorkloadPlannerService } from '../services/workload-planner.service';
import { WorkloadControllerService } from '../services/workload-controller.service';
import { ImageResolverService } from '../services/image-resolver.service';
import { MasterKeyService } from '../services/master-key.service';
import { SecretsService } from '../services/secrets.service';

export const CONTROL_PLANE_ENTITIES = [
  ClusterEntity,
  ResourceEntity,
  NodeEntity,
  NodeDesiredStateEntity,
  JoinTokenEntity,
  AuditEventEntity,
  ClusterMemberEntity,
  PlanEntity,
  WorkloadPlacementEntity,
  ServiceAddressEntity,
  VolumePlacementEntity,
  SecretEntity,
  MasterKeyEntity,
  UnsealRequestEntity,
  UnsealShareEntity,
  DeploymentStateEntity,
  CronScheduleEntity,
  CronRunEntity,
  ObjectStoreGenerationEntity,
  PublicAddressEntity,
  CertificateEntity,
  AcmeAccountEntity,
  AcmeChallengeEntity,
  DnsZoneStatusEntity,
  DnsZoneSerialEntity,
  DnssecKeyEntity,
  ImageScanEntity,
  VpnClientEntity,
  VpnGatewayKeyEntity,
  ProbeResultEntity,
  DnsFailoverStateEntity,
];

/**
 * Loadweaver control plane: cluster identity, desired state, plans, nodes and the agent stream.
 */
@Module({
  imports: [TypeOrmModule.forFeature(CONTROL_PLANE_ENTITIES)],
  controllers: [
    ImagesController,
    VpnController,
    ClusterController,
    InstallController,
    NodeJoinController,
    NodesController,
    JoinTokensController,
    PlansController,
    ResourcesController,
    SecretsController,
    CronRunsController,
    RegistryController,
    CertificatesController,
    DnsController,
  ],
  providers: [
    ClusterMembersRepository,
    JoinTokensRepository,
    NodesRepository,
    ResourcesRepository,
    AuditLogService,
    ClusterAccessService,
    ClusterBootstrapService,
    ClusterIdentityService,
    InstallService,
    JoinTokensService,
    NetworkStateService,
    NodeAgentsService,
    NodesService,
    PlansService,
    ResourceStoreService,
    WorkloadPlannerService,
    WorkloadControllerService,
    CronControllerService,
    ObjectStoreControllerService,
    RegistryTokenService,
    RegistryProxyService,
    ImageResolverService,
    MasterKeyService,
    SecretsService,
    VaultTransitKms,
    PublicAddressService,
    CertificatesService,
    DnsService,
    RpkiCheckService,
    DnsReconcilerService,
    DnsFailoverControllerService,
    DnssecService,
    WorkloadIdentityService,
    ImagePolicyService,
    RemoteAccessService,
    {
      provide: PosturePluginRegistry,
      useFactory: async (dynamicLoader: DynamicProviderLoaderService) => {
        const registry = new PosturePluginRegistry();

        await registerDynamicProviders<PosturePluginFactory>({
          envKey: DYNAMIC_POSTURE_PLUGINS_ENV,
          criticality: 'optional',
          register: (factory) => registry.register(factory),
          dynamicLoader,
          loggerContext: 'PosturePluginRegistry',
        });

        return registry;
      },
      inject: [DynamicProviderLoaderService],
    },
    {
      provide: RegistrarProviderRegistry,
      useFactory: async (dynamicLoader: DynamicProviderLoaderService) => {
        const registry = new RegistrarProviderRegistry();

        await registerDynamicProviders<RegistrarProviderFactory>({
          envKey: DYNAMIC_REGISTRAR_PROVIDERS_ENV,
          criticality: 'optional',
          register: (factory) => registry.register(factory),
          dynamicLoader,
          loggerContext: 'RegistrarProviderRegistry',
        });

        return registry;
      },
      inject: [DynamicProviderLoaderService],
    },
    {
      provide: DnsProviderRegistry,
      useFactory: async (dynamicLoader: DynamicProviderLoaderService) => {
        const registry = new DnsProviderRegistry();

        await registerDynamicProviders<DnsProviderFactory>({
          envKey: DYNAMIC_DNS_PROVIDERS_ENV,
          criticality: 'optional',
          register: (factory) => registry.register(factory),
          dynamicLoader,
          loggerContext: 'DnsProviderRegistry',
        });

        return registry;
      },
      inject: [DynamicProviderLoaderService],
    },
    PublicAddressControllerService,
    PlatformCredentialsService,
    {
      provide: FailoverIpProviderRegistry,
      useFactory: async (dynamicLoader: DynamicProviderLoaderService) => {
        const registry = new FailoverIpProviderRegistry();

        await registerDynamicProviders<FailoverIpProviderFactory>({
          envKey: DYNAMIC_FAILOVER_IP_PROVIDERS_ENV,
          criticality: 'optional',
          register: (factory) => registry.register(factory),
          dynamicLoader,
          loggerContext: 'FailoverIpProviderRegistry',
        });

        return registry;
      },
      inject: [DynamicProviderLoaderService],
    },
    DynamicProviderLoaderService,
    {
      provide: MasterKeyKmsRegistry,
      useFactory: async (vault: VaultTransitKms, dynamicLoader: DynamicProviderLoaderService) => {
        const registry = new MasterKeyKmsRegistry();

        registry.register(vault);
        // Other KMS (cloud providers, HSMs) as plugins, like the other dynamic providers.
        await registerDynamicProviders<MasterKeyKmsProvider>({
          envKey: DYNAMIC_KMS_PROVIDERS_ENV,
          criticality: 'optional',
          register: (provider) => registry.register(provider),
          dynamicLoader,
          loggerContext: 'MasterKeyKmsRegistry',
        });

        return registry;
      },
      inject: [VaultTransitKms, DynamicProviderLoaderService],
    },
    AgentSessionRegistry,
    AgentStreamServer,
  ],
  exports: [
    AuditLogService,
    ClusterAccessService,
    ResourceStoreService,
    NetworkStateService,
    NodesService,
    AgentSessionRegistry,
    RegistryProxyService,
  ],
})
export class ControlPlaneModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(BasicToBearerMiddleware).forRoutes({ path: 'registry/token', method: RequestMethod.GET });
  }
}
