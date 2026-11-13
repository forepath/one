// DTOs - Auth
export * from './lib/dto/auth/login.dto';
export * from './lib/dto/auth/logout.dto';
export * from './lib/dto/auth/personal-access-token.dto';
export * from './lib/dto/auth/identity-app.dto';
export * from './lib/dto/auth/saml-token-exchange.dto';
export * from './lib/dto/auth/register.dto';
export * from './lib/dto/auth/change-password.dto';
export * from './lib/dto/auth/confirm-email.dto';
export * from './lib/dto/auth/create-user.dto';
export * from './lib/dto/auth/request-password-reset.dto';
export * from './lib/dto/auth/reset-password.dto';
export * from './lib/dto/auth/update-user.dto';
export * from './lib/dto/auth/user-response.dto';

// DTOs - Client Users
export * from './lib/dto/add-client-user.dto';
export * from './lib/dto/client-user-response.dto';

// Entities
export * from './lib/entities/client.entity';
export * from './lib/entities/client-agent-credential.entity';

// Constants / decorators
export * from './lib/constants/pat.constants';
export * from './lib/constants/app.constants';
export * from './lib/constants/oidc.constants';
export * from './lib/constants/saml.constants';
export * from './lib/decorators/require-scopes.decorator';

// Repositories
export * from './lib/repositories/revoked-user-tokens.repository';
export * from './lib/repositories/personal-access-tokens.repository';
export * from './lib/repositories/identity-apps.repository';
export * from './lib/repositories/external-auth-states.repository';
export * from './lib/repositories/users.repository';
export * from './lib/repositories/client-users.repository';
export * from './lib/repositories/client-agent-credentials.repository';

// Guards
export * from './lib/guards/users-auth.guard';
export * from './lib/guards/users-roles.guard';
export * from './lib/guards/pat-scopes.guard';
export * from './lib/guards/pat-bearer-auth.guard';
export * from './lib/guards/external-identity-auth.guard';

// Middleware
export * from './lib/middleware/pat-bearer-exchange.middleware';

// Services
export * from './lib/services/auth.service';
export * from './lib/services/users.service';
export * from './lib/services/personal-access-token.service';
export * from './lib/services/identity-apps.service';
export * from './lib/services/identity-app-authorization.service';
export * from './lib/services/socket-auth.service';
export * from './lib/services/oidc-client-credentials.service';
export * from './lib/services/external-identity.service';
export * from './lib/saml/saml.config';
export * from './lib/saml/saml-auth.service';
export * from './lib/services/client-agent-credentials.service';
export * from './lib/services/client-users.service';

// Controllers
export * from './lib/controllers/auth.controller';
export * from './lib/controllers/users.controller';
export * from './lib/controllers/personal-access-tokens.controller';
export * from './lib/controllers/pat-token-exchange.controller';
export * from './lib/controllers/identity-apps.controller';
export * from './lib/controllers/identity-app-authorization.controller';
export * from './lib/controllers/identity-app-token.controller';
export * from './lib/controllers/saml-auth.controller';

// Modules
export * from './lib/modules/pat-auth.module';
export * from './lib/modules/users-auth.module';
export * from './lib/modules/oidc-auth.module';
export * from './lib/modules/saml-auth.module';
export * from './lib/utils/audit-pat-route-scopes';
export * from './lib/utils/get-identity-auth-guards';
export * from './lib/utils/identity-app.utils';
export * from './lib/utils/machine-jwt-session.util';
export * from './lib/utils/machine-socket-session.util';
