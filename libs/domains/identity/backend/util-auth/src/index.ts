// Existing exports
export * from './lib/authentication-method';
export * from './lib/bull-board-request-path';
export * from './lib/otel-metrics-request-path';
export * from './lib/bull-board-throttler.guard';
export * from './lib/http-request-path.util';
export * from './lib/hybrid-auth.guard';
export * from './lib/oidc';
export * from './lib/origin-allowlist.middleware';
export * from './lib/service-socket-auth';
export * from './lib/secret-compare';
export * from './lib/trust-proxy.config';
export * from './lib/rate-limit.config';

// Phase 2a: New exports
export * from './lib/client-access.utils';
export * from './lib/decorators/public.decorator';
export * from './lib/decorators/users-roles.decorator';
export * from './lib/entities/authentication-type.enum';
export * from './lib/entities/client-user.entity';
export * from './lib/entities/client.entity.types';
export * from './lib/entities/revoked-user-token.entity';
export * from './lib/entities/user-personal-access-token.entity';
export * from './lib/entities/identity-app.entity';
export * from './lib/entities/identity-app-grant.entity';
export * from './lib/entities/identity-app-session.entity';
export * from './lib/entities/identity-app-authorization-code.entity';
export * from './lib/entities/external-auth-state.entity';
export * from './lib/entities/user.entity';
export * from './lib/password.service';
export * from './lib/statistics.interface';
export * from './lib/notification.interface';
export * from './lib/identity-notification.events';
export * from './lib/identity-pat.scopes';
export * from './lib/socket-scope.utils';
export * from './lib/email-dispatcher.interface';

export * from './lib/token.utils';

// Migrations
export * from './lib/migrations/1765000000000_CreateUsersTable';
export * from './lib/migrations/1770550000000_AddTenantIdToUsers';
export * from './lib/migrations/1775000000000_AddUserTokenVersion';
export * from './lib/migrations/1775000000001_CreateRevokedUserTokensTable';
export * from './lib/migrations/1776100000000_CreateUserPersonalAccessTokensTable';
export * from './lib/migrations/1778000000000_AddUserLogin2faColumns';
export * from './lib/migrations/1778000000001_EncryptUserTotpSecretColumn';
export * from './lib/migrations/1793700000000_CreateIdentityAppsTables';
export * from './lib/migrations/1793900000000_ReplaceKeycloakSubWithExternalIdentity';
export * from './lib/migrations/1793900000001_CreateExternalAuthStatesTable';
