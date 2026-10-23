import {
  getAuthenticationMethod,
  KeycloakService,
  RevokedUserTokenEntity,
  RevokedUserTokensRepository,
  SocketAuthService,
  UserEntity,
  UsersRepository,
} from '@forepath/identity/backend';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KeycloakConnectModule } from 'nest-keycloak-connect';

import { FleetAuditController } from '../controllers/fleet-audit.controller';
import { FleetCloudController } from '../controllers/fleet-cloud.controller';
import { FleetClustersController } from '../controllers/fleet-clusters.controller';
import { FleetOperationsController } from '../controllers/fleet-operations.controller';
import { FleetOverviewController } from '../controllers/fleet-overview.controller';
import { FleetRelayController } from '../controllers/fleet-relay.controller';
import { FleetAuditEventEntity } from '../entities/fleet-audit-event.entity';
import { FleetClusterEntity } from '../entities/fleet-cluster.entity';
import { FleetGrantEntity } from '../entities/fleet-grant.entity';
import { FleetOperationEntity } from '../entities/fleet-operation.entity';
import { FleetRelayGateway } from '../gateways/fleet-relay.gateway';
import { FleetAccessEvents } from '../services/fleet-access-events.service';
import { FleetAccessService } from '../services/fleet-access.service';
import { FleetAuditService } from '../services/fleet-audit.service';
import { FleetClusterClient } from '../services/fleet-cluster-client.service';
import { FleetCloudService } from '../services/fleet-cloud.service';
import { FleetClustersService } from '../services/fleet-clusters.service';
import { FleetOperationsService } from '../services/fleet-operations.service';
import { FleetOverviewService } from '../services/fleet-overview.service';
import { FleetRelayService } from '../services/fleet-relay.service';

/** Entities of the fleet service (the app adds identity's user / token entities). */
export const FLEET_ENTITIES = [FleetClusterEntity, FleetGrantEntity, FleetAuditEventEntity, FleetOperationEntity];

/**
 * Loadweaver fleet service (3.24): cluster connections, per-cluster grants, REST + socket relay, fleet views,
 * cross-cluster operations and the Loadweaver Cloud hooks.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([...FLEET_ENTITIES, UserEntity, RevokedUserTokenEntity]),
    // KEYCLOAK_INSTANCE for the socket handshake (SocketAuthService) in keycloak mode, like Agenstra.
    ...(getAuthenticationMethod() === 'keycloak'
      ? [KeycloakConnectModule.registerAsync({ useExisting: KeycloakService })]
      : []),
  ],
  controllers: [
    // The relay first: `clusters/:id/api/*` must never be taken by another `clusters/…` route.
    FleetRelayController,
    FleetClustersController,
    FleetOverviewController,
    FleetOperationsController,
    FleetCloudController,
    FleetAuditController,
  ],
  providers: [
    FleetClusterClient,
    FleetAuditService,
    FleetAccessService,
    FleetAccessEvents,
    FleetClustersService,
    FleetRelayService,
    FleetOverviewService,
    FleetOperationsService,
    FleetCloudService,
    FleetRelayGateway,
    SocketAuthService,
    UsersRepository,
    RevokedUserTokensRepository,
  ],
  exports: [FleetClustersService, FleetOperationsService, FleetAuditService],
})
export class FleetModule {}
