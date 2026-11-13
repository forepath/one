import {
  AgenstraOtelModule,
  ClientsModule,
  IdentityEmailBridgeModule,
  IdentityNotificationBridgeModule,
  IdentityStatisticsBridgeModule,
  AGENSTRA_PAT_SCOPES,
  AGENSTRA_RAW_PAT_BEARER_PATHS,
} from '@forepath/agenstra/backend/feature-agent-controller';
import { MonitoringModule } from '@forepath/shared/backend';
import {
  BullBoardSkippingThrottlerGuard,
  getAuthenticationMethod,
  getIdentityAuthGuards,
  getRateLimitConfig,
  OidcAuthModule,
  SamlAuthModule,
  UsersAuthModule,
} from '@forepath/identity/backend';
import { getTypeOrmOptionsForQueueRole } from '@forepath/shared/backend';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ControllerQueueModule } from '../queue/controller-queue.module';
import { typeormConfig } from '../typeorm.config';

const authMethod = getAuthenticationMethod();
// Raw `fp_pat_…` bearers are accepted on the OpenAI-compatible routes only (static-key SDKs).
const patAuthOptions = { patScopeCatalog: AGENSTRA_PAT_SCOPES, rawPatBearerPaths: AGENSTRA_RAW_PAT_BEARER_PATHS };

@Module({
  imports: [
    TypeOrmModule.forRoot(getTypeOrmOptionsForQueueRole(typeormConfig)),
    ControllerQueueModule,
    ThrottlerModule.forRoot(getRateLimitConfig()),
    ...(authMethod === 'oidc' ? [OidcAuthModule.register(patAuthOptions)] : []),
    ...(authMethod === 'saml' ? [SamlAuthModule.register(patAuthOptions)] : []),
    ...(authMethod === 'users' ? [UsersAuthModule.register(patAuthOptions)] : []),
    ClientsModule,
    IdentityStatisticsBridgeModule,
    IdentityNotificationBridgeModule,
    IdentityEmailBridgeModule,
    AgenstraOtelModule,
    MonitoringModule,
  ],
  providers: [
    ...getIdentityAuthGuards(),
    {
      provide: APP_GUARD,
      useClass: BullBoardSkippingThrottlerGuard,
    },
  ],
})
export class AppModule {}
