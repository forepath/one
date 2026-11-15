import { AgentsModule, AgenstraOtelModule } from '@forepath/agenstra/backend/feature-agent-manager';
import {
  getAuthenticationMethod,
  getHybridAuthGuards,
  getRateLimitConfig,
  OidcModule,
} from '@forepath/identity/backend';
import { MonitoringModule } from '@forepath/shared/backend';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';

import { typeormConfig } from '../typeorm.config';

const authMethod = getAuthenticationMethod();

// The agent-manager has no users table / console: only service authentication is supported.
// Anything else would leave the API without an authenticating guard, so refuse to start.
if (authMethod !== 'api-key' && authMethod !== 'oidc' && authMethod !== 'mtls') {
  throw new Error(
    `AUTHENTICATION_METHOD=${authMethod} is not supported by the agent-manager. Use api-key (STATIC_API_KEY), oidc (OIDC_* settings) or mtls (MTLS_CA_CERT).`,
  );
}

@Module({
  imports: [
    TypeOrmModule.forRoot(typeormConfig),
    ThrottlerModule.forRoot(getRateLimitConfig()),
    ...(authMethod === 'oidc' ? [OidcModule] : []),
    AgentsModule,
    AgenstraOtelModule,
    MonitoringModule,
  ],
  providers: [
    // api-key: static API key guard; mtls: client certificate guard; oidc: API key guard (pass-through) + OIDC guard
    ...getHybridAuthGuards(),
    // Apply rate limiting globally to all routes
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
