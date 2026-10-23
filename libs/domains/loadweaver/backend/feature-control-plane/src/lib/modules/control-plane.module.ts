import {
  DynamicProviderLoaderService,
  registerDynamicProviders,
} from '@forepath/shared/backend/util-dynamic-provider-registry';
import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AgentSessionRegistry } from '../agent-stream/agent-session.registry';
import { FleetOnBehalfOfScopeInterceptor } from '../auth/fleet-on-behalf-of-scope.interceptor';
import { AgentStreamServer } from '../agent-stream/agent-stream.server';
import { ClusterController } from '../controllers/cluster.controller';
import { CronRunsController } from '../controllers/cron-runs.controller';
import { DeploymentStatusController } from '../controllers/deployment-status.controller';
import { IsolationCapabilitiesController } from '../controllers/isolation-capabilities.controller';
import { MigrationsController } from '../controllers/migrations.controller';
import { MigrationEntity } from '../entities/migration.entity';
import { MigrationSessionService } from '../services/migration-session.service';
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
import { PostureController } from '../controllers/posture.controller';
import { PostureCertificateTrustEntity, PostureIntegrationEntity } from '../entities/posture-integration.entity';
import { PostureCertificatesService } from '../posture/posture-certificates.service';
import { PostureIntegrationsService } from '../posture/posture-integrations.service';
import { BUILTIN_POSTURE_PLUGINS } from '../posture/plugins/builtin-posture-plugins';
import { AccessController } from '../controllers/access.controller';
import { ApplyOperationService } from '../plans/apply-operation.service';
import { PlansGateway } from '../gateways/plans.gateway';
import { DriftController } from '../controllers/drift.controller';
import {
  GitAccountsCallbackController,
  GitAccountsController,
  GitConnectionsController,
  GitSopsController,
  GitWebhooksController,
} from '../controllers/git.controller';
import {
  GitAccountEntity,
  GitCommitEntity,
  GitConnectionEntity,
  GitOAuthStateEntity,
  GitPendingLinkEntity,
  GitWebhookDeliveryEntity,
  GitLockEntity,
  GitPullRequestEntity,
  GitResourceStateEntity,
  GitSopsKeyEntity,
} from '../entities/git.entity';
import { GitAccountsService } from '../git/git-accounts.service';
import { GitBotService } from '../git/git-bot.service';
import { GitBotConfigService, GitHubAppTokens } from '../git/github-app';
import { GitConnectionsService } from '../git/git-connections.service';
import { GitScopeService } from '../git/git-scope.service';
import { ClusterSopsDecryptor, GitSopsDecryptor } from '../git/git-sops';
import { GitSyncService } from '../git/git-sync.service';
import { ChangeEventsService } from '../services/change-events.service';
import { DriftService } from '../plans/drift.service';
import { LogsController } from '../controllers/logs.controller';
import { LogsGateway } from '../gateways/logs.gateway';
import { LogsService } from '../logs/logs.service';
import { MetricsController } from '../controllers/metrics.controller';
import { MetricsStore } from '../metrics/metrics.store';
import { UsageController } from '../controllers/usage.controller';
import { UsageService } from '../usage/usage.service';
import { AlertsController } from '../controllers/alerts.controller';
import { AlertService } from '../alerts/alert.service';
import { AuditService } from '../audit/audit.service';
import { SiemForwarderService } from '../siem/siem-forwarder.service';
import { AuditController } from '../controllers/audit.controller';
import { DashboardsController, GrafanaController } from '../controllers/dashboards.controller';
import { DashboardQueryService } from '../dashboards/dashboard-query.service';
import { HealthController } from '../controllers/health.controller';
import { HealthService } from '../health/health.service';
import { OverviewService } from '../health/overview.service';
import { SloService } from '../health/slo.service';
import { StatusPageService } from '../health/status-page.service';
import { SearchService } from '../search/search.service';
import { SearchController } from '../controllers/search.controller';
import { PublicWallboardController, WallboardsController } from '../controllers/wallboards.controller';
import { WallboardService } from '../health/wallboard.service';
import { ReportsController } from '../controllers/reports.controller';
import { GarageFileStorageProvider } from '../reports/garage-file-storage.provider';
import { ReportsService } from '../reports/reports.service';
import { LiveController } from '../controllers/live.controller';
import { TopologyController } from '../controllers/topology.controller';
import { TopologyGateway } from '../gateways/topology.gateway';
import { TopologyService } from '../topology/topology.service';
import { LiveFilesController } from '../controllers/live-files.controller';
import { TerminalsGateway } from '../gateways/terminals.gateway';
import { ExecGateway } from '../gateways/exec.gateway';
import { TunnelsGateway } from '../gateways/tunnels.gateway';
import { ConsolesGateway } from '../gateways/consoles.gateway';
import { VirtualMachinesController, VmImagesController } from '../controllers/virtual-machines.controller';
import { VIRTUAL_MACHINE_ENTITIES } from '../entities/virtual-machine.entities';
import { VirtualMachinesService } from '../services/virtual-machines.service';
import { VmImageCatalogService } from '../services/vm-image-catalog.service';
import { VmImageImportService } from '../services/vm-image-import.service';
import { LiveAccessService } from '../live/live-access.service';
import { LiveBroker } from '../live/live-broker';
import { LiveFilesService } from '../live/live-files.service';
import { LiveRecordsService } from '../live/live-records.service';
import { FileStorageModule } from '@forepath/shared/backend/util-file-storage';
import { IncidentsController, PublicStatusController } from '../controllers/status-pages.controller';
import { OtelSummaryCollector } from '../metrics/otel-summary.collector';
import { LoadweaverNotificationsModule } from '../notifications/loadweaver-notifications.module';
import { OpenSearchModule } from '@forepath/shared/backend/util-opensearch';
import {
  getAuthenticationMethod,
  KeycloakService,
  RevokedUserTokenEntity,
  RevokedUserTokensRepository,
  SocketAuthService,
  UserEntity,
  UsersRepository,
} from '@forepath/identity/backend';
import { KeycloakConnectModule } from 'nest-keycloak-connect';
import { ProjectAccessService } from '../access/project-access.service';
import {
  PlanApprovalEntity,
  PolicyAcceptanceEntity,
  ProjectMemberEntity,
  ProjectSettingsEntity,
} from '../entities/project-access.entity';
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
import { PostgresCertificateEntity } from '../entities/postgres-certificate.entity';
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
import { PostgresCertificateRenewalService } from '../services/postgres-certificate-renewal.service';
import { ReplicaDrainService } from '../services/replica-drain.service';
import { NodeAgentsService } from '../services/node-agents.service';
import { NodesService } from '../services/nodes.service';
import { PlansService } from '../services/plans.service';
import { ResourceStoreService } from '../services/resource-store.service';
import { WorkloadPlannerService } from '../services/workload-planner.service';
import { WorkloadControllerService } from '../services/workload-controller.service';
import { ImageResolverService } from '../services/image-resolver.service';
import { MasterKeyService } from '../services/master-key.service';
import { SecretsService } from '../services/secrets.service';
import { UPDATES_CONTROLLERS, UPDATES_ENTITIES, UPDATES_PROVIDERS } from '../updates/updates.providers';
import {
  AUTOSCALING_CONTROLLERS,
  AUTOSCALING_ENTITIES,
  AUTOSCALING_PROVIDERS,
} from '../autoscaling/autoscaling.providers';
import { IMPORT_CONTROLLERS, IMPORT_ENTITIES, IMPORT_PROVIDERS } from '../import/import.providers';
import { ReleasesService } from '../updates/releases.service';
import { BACKUPS_CONTROLLERS, BACKUPS_ENTITIES, BACKUPS_PROVIDERS } from '../backups/backups.providers';
import { BackupKeyService } from '../backups/backup-keys.service';
import {
  PLATFORM_BACKUPS_CONTROLLERS,
  PLATFORM_BACKUPS_ENTITIES,
  PLATFORM_BACKUPS_PROVIDERS,
} from '../backups/platform/platform-backups.providers';

export const CONTROL_PLANE_ENTITIES = [
  // Update rollout (3.26).
  ...UPDATES_ENTITIES,
  // Horizontal autoscaling (3.23).
  ...AUTOSCALING_ENTITIES,
  // Import of existing hosts and former nodes (3.21).
  ...IMPORT_ENTITIES,
  // Backups (3.20).
  ...BACKUPS_ENTITIES,
  // Control-plane data backups (3.20).
  ...PLATFORM_BACKUPS_ENTITIES,
  // Virtual machines (3.35): power, node commands, snapshots, image imports.
  ...VIRTUAL_MACHINE_ENTITIES,
  ClusterEntity,
  ResourceEntity,
  NodeEntity,
  NodeDesiredStateEntity,
  // Members' Postgres server certificates (3.2), reused until due.
  PostgresCertificateEntity,
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
  MigrationEntity,
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
  // Posture integrations and device certificate trust (3.31).
  PostureIntegrationEntity,
  PostureCertificateTrustEntity,
  ProjectMemberEntity,
  ProjectSettingsEntity,
  PlanApprovalEntity,
  PolicyAcceptanceEntity,
  ProbeResultEntity,
  DnsFailoverStateEntity,
  GitConnectionEntity,
  GitCommitEntity,
  GitResourceStateEntity,
  GitAccountEntity,
  GitOAuthStateEntity,
  GitPendingLinkEntity,
  GitWebhookDeliveryEntity,
  GitLockEntity,
  GitPullRequestEntity,
  GitSopsKeyEntity,
];

/**
 * Loadweaver control plane: cluster identity, desired state, plans, nodes and the agent stream.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([...CONTROL_PLANE_ENTITIES, UserEntity, RevokedUserTokenEntity]),
    OpenSearchModule,
    LoadweaverNotificationsModule,
    // Reports (3.25) through the shared file storage; Garage registers itself as a provider.
    FileStorageModule,
    // KEYCLOAK_INSTANCE for the socket handshake (SocketAuthService) in keycloak mode, like Agenstra.
    ...(getAuthenticationMethod() === 'keycloak'
      ? [KeycloakConnectModule.registerAsync({ useExisting: KeycloakService })]
      : []),
  ],
  controllers: [
    ImagesController,
    VpnController,
    PostureController,
    AccessController,
    DriftController,
    GitConnectionsController,
    GitWebhooksController,
    GitAccountsController,
    GitAccountsCallbackController,
    GitSopsController,
    LogsController,
    MetricsController,
    UsageController,
    AlertsController,
    AuditController,
    DashboardsController,
    GrafanaController,
    HealthController,
    PublicStatusController,
    IncidentsController,
    SearchController,
    WallboardsController,
    PublicWallboardController,
    ReportsController,
    LiveFilesController,
    LiveController,
    TopologyController,
    ClusterController,
    InstallController,
    NodeJoinController,
    NodesController,
    JoinTokensController,
    PlansController,
    ResourcesController,
    SecretsController,
    CronRunsController,
    DeploymentStatusController,
    IsolationCapabilitiesController,
    VirtualMachinesController,
    VmImagesController,
    MigrationsController,
    RegistryController,
    CertificatesController,
    DnsController,
    ...UPDATES_CONTROLLERS,
    ...AUTOSCALING_CONTROLLERS,
    ...IMPORT_CONTROLLERS,
    // Before `backups/:id` (BackupsController): `backups/platform/…` must not be taken for a backup id.
    ...PLATFORM_BACKUPS_CONTROLLERS,
    ...BACKUPS_CONTROLLERS,
  ],
  providers: [
    // `fleet:on-behalf-of` only for cluster admins / fleet service users (checked at PAT create / change).
    { provide: APP_INTERCEPTOR, useClass: FleetOnBehalfOfScopeInterceptor },
    ...UPDATES_PROVIDERS,
    ...AUTOSCALING_PROVIDERS,
    ...IMPORT_PROVIDERS,
    ...BACKUPS_PROVIDERS,
    ...PLATFORM_BACKUPS_PROVIDERS,
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
    PostgresCertificateRenewalService,
    ReplicaDrainService,
    NodeAgentsService,
    NodesService,
    PlansService,
    ResourceStoreService,
    WorkloadPlannerService,
    WorkloadControllerService,
    MigrationSessionService,
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
    PostureIntegrationsService,
    PostureCertificatesService,
    ProjectAccessService,
    ApplyOperationService,
    PlansGateway,
    DriftService,
    ChangeEventsService,
    GitScopeService,
    GitConnectionsService,
    GitSyncService,
    GitBotConfigService,
    GitHubAppTokens,
    GitBotService,
    GitAccountsService,
    // SOPS (3.29): the cluster's age identity, sealed with the master key.
    ClusterSopsDecryptor,
    { provide: GitSopsDecryptor, useExisting: ClusterSopsDecryptor },
    LogsService,
    MetricsStore,
    UsageService,
    AlertService,
    AuditService,
    SiemForwarderService,
    DashboardQueryService,
    HealthService,
    OverviewService,
    SloService,
    StatusPageService,
    SearchService,
    WallboardService,
    GarageFileStorageProvider,
    ReportsService,
    LiveBroker,
    LiveAccessService,
    LiveFilesService,
    LiveRecordsService,
    TerminalsGateway,
    ExecGateway,
    TunnelsGateway,
    ConsolesGateway,
    VirtualMachinesService,
    VmImageImportService,
    VmImageCatalogService,
    TopologyService,
    TopologyGateway,
    OtelSummaryCollector,
    LogsGateway,
    SocketAuthService,
    UsersRepository,
    RevokedUserTokensRepository,
    {
      provide: PosturePluginRegistry,
      useFactory: async (dynamicLoader: DynamicProviderLoaderService) => {
        const registry = new PosturePluginRegistry();

        // Built-in MDM / EDR plugins first, then plugins from DYNAMIC_POSTURE_PLUGINS.
        for (const factory of BUILTIN_POSTURE_PLUGINS) registry.register(factory);

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
    // The app's queue processor runs the report jobs (3.25).
    ReportsService,
    // ... and the posture integration syncs (3.31).
    PostureIntegrationsService,
    AuditLogService,
    ClusterAccessService,
    ResourceStoreService,
    NetworkStateService,
    NodesService,
    AgentSessionRegistry,
    RegistryProxyService,
    // Release announcements of the shared updates feature land here (queue module, 3.26).
    ReleasesService,
    // Backup keys (3.20) for the queue's backup jobs.
    BackupKeyService,
  ],
})
export class ControlPlaneModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(BasicToBearerMiddleware).forRoutes({ path: 'registry/token', method: RequestMethod.GET });
  }
}
