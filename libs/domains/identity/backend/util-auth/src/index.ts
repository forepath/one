// Existing exports
export * from './lib/bull-board-keycloak.guards';
export * from './lib/bull-board-request-path';
export * from './lib/bull-board-throttler.guard';
export * from './lib/http-request-path.util';
export * from './lib/hybrid-auth.guard';
export * from './lib/keycloak.guard';
export * from './lib/keycloak.module';
export * from './lib/keycloak.service';
export * from './lib/keycloak.types';
export * from './lib/origin-allowlist.middleware';
export * from './lib/rate-limit.config';

// Phase 2a: New exports
export * from './lib/client-access.utils';
export * from './lib/decorators/keycloak-roles.decorator';
export * from './lib/decorators/public.decorator';
export * from './lib/decorators/users-roles.decorator';
export * from './lib/entities/authentication-type.enum';
export * from './lib/entities/client-user.entity';
export * from './lib/entities/client.entity.types';
export * from './lib/entities/revoked-user-token.entity';
export * from './lib/entities/user.entity';
export * from './lib/password.service';
export * from './lib/statistics.interface';
export * from './lib/token.utils';

// Migrations
export * from './lib/migrations/1765000000000_CreateUsersTable';
export * from './lib/migrations/1770550000000_AddTenantIdToUsers';
export * from './lib/migrations/1775000000000_AddUserTokenVersion';
export * from './lib/migrations/1775000000001_CreateRevokedUserTokensTable';
