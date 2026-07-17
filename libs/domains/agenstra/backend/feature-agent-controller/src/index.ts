// Re-export identity auth symbols for backward compatibility
// Consumers should migrate to importing directly from @forepath/identity/backend
export {
  // Decorators
  KeycloakRoles,
  UsersRoles,
  Public,
  // Entities
  UserEntity,
  UserRole,
  ClientUserEntity,
  ClientUserRole,
  ClientEntity,
  AuthenticationType,
  ClientEntityLike,
  ClientAgentCredentialEntity,
  // Repositories
  UsersRepository,
  ClientUsersRepository,
  ClientAgentCredentialsRepository,
  // Guards
  UsersAuthGuard,
  UsersRolesGuard,
  KeycloakAuthGuard,
  KeycloakRolesGuard,
  // Services
  AuthService,
  UsersService,
  SocketAuthService,
  KeycloakTokenService,
  ClientAgentCredentialsService,
  ClientUsersService,
  PasswordService,
  // Controllers
  AuthController,
  UsersController,
  // Modules
  UsersAuthModule,
  KeycloakUserSyncModule,
  // DTOs
  LoginDto,
  RegisterDto,
  ChangePasswordDto,
  ConfirmEmailDto,
  CreateUserDto,
  RequestPasswordResetDto,
  ResetPasswordDto,
  UpdateUserDto,
  UserResponseDto,
  AddClientUserDto,
  ClientUserResponseDto,
  // Utils
  ensureClientAccess,
  checkClientAccess,
  getUserFromRequest,
  RequestWithUser,
  // Statistics interface
  IIdentityStatisticsService,
  IDENTITY_STATISTICS_SERVICE,
  // Notification interface
  IIdentityNotificationPublisher,
  IDENTITY_NOTIFICATION_PUBLISHER,
  // Token utils
  createConfirmationCode,
  validateConfirmationCode,
} from '@forepath/identity/backend';

// Framework-owned exports (files that stay in this library)
export * from './lib/dto/client-response.dto';
export * from './lib/dto/create-client-response.dto';
export * from './lib/dto/filter-rules';
export * from './lib/dto/create-client.dto';
export * from './lib/dto/update-client.dto';
export * from './lib/entities/agent-console-regex-filter-rule-client.entity';
export * from './lib/entities/agent-console-regex-filter-rule-sync-target.entity';
export * from './lib/entities/agent-console-regex-filter-rule.entity';
export * from './lib/entities/atlassian-site-connection.entity';
export * from './lib/entities/external-import-config.entity';
export * from './lib/entities/external-import-sync-marker.entity';
export * from './lib/entities/external-import.enums';
export * from './lib/entities/client-agent-autonomy.entity';
export * from './lib/entities/knowledge-node-embedding.entity';
export * from './lib/entities/knowledge-node.entity';
export * from './lib/entities/knowledge-page-activity.entity';
export * from './lib/entities/knowledge-relation.entity';
export * from './lib/entities/provisioning-reference.entity';
export * from './lib/entities/ticket-automation-lease.entity';
export * from './lib/entities/ticket-automation-run-step.entity';
export * from './lib/entities/ticket-automation-run.entity';
export * from './lib/entities/ticket-automation.entity';
export * from './lib/entities/ticket-automation.enums';
export * from './lib/entities/ticket-activity.entity';
export * from './lib/entities/ticket-body-generation-session.entity';
export * from './lib/entities/ticket-comment.entity';
export * from './lib/entities/ticket.entity';
export * from './lib/entities/user-environment-read-state.entity';
export * from './lib/entities/ticket.enums';
export * from './lib/entities/statistics-agent.entity';
export * from './lib/entities/statistics-chat-filter-drop.entity';
export * from './lib/entities/statistics-chat-filter-flag.entity';
export * from './lib/entities/statistics-chat-io.entity';
export * from './lib/entities/statistics-client-user.entity';
export * from './lib/entities/statistics-client.entity';
export * from './lib/entities/statistics-entity-event.entity';
export * from './lib/entities/statistics-provisioning-reference.entity';
export * from './lib/entities/statistics-user.entity';
export * from './lib/controllers/filter-rules.controller';
export * from './lib/controllers/client-agent-autonomy.controller';
export * from './lib/controllers/clients-agent-automation-proxy.controller';
export * from './lib/controllers/ticket-automation.controller';
export * from './lib/controllers/tickets.controller';
export * from './lib/modules/filter-rules.module';
export * from './lib/modules/context-import.module';
export * from './lib/modules/clients.module';
export * from './lib/modules/agenstra-notifications.module';
export * from './lib/modules/identity-notification-bridge.module';
export * from './lib/modules/identity-email-bridge.module';
export * from './lib/modules/identity-statistics-bridge.module';
export * from './lib/modules/statistics.module';
export * from './lib/repositories/clients.repository';
export * from './lib/repositories/statistics.repository';
export * from './lib/dto/ticket-automation';
export * from './lib/services/autonomous-run-orchestrator.service';
export * from './lib/services/agent-manager-filter-rules-client.service';
export * from './lib/services/filter-rules.service';
export * from './lib/services/filter-rules-sync.service';
export * from './lib/services/autonomous-run-orchestrator.service';
export * from './lib/services/context-import-orchestrator.service';
export * from './lib/services/external-import-config.service';
export * from './lib/modules/clients.module';
export * from './lib/modules/context-import.module';
export * from './lib/modules/filter-rules.module';
export * from './lib/services/client-agent-autonomy.service';
export * from './lib/services/client-agent-proxy.service';
export * from './lib/services/auto-context-resolver.service';
export * from './lib/services/embeddings/knowledge-embedding-index.service';
export * from './lib/services/embeddings/local-embedding.provider';
export * from './lib/services/remote-agents-session.service';
export * from './lib/services/ticket-automation.service';
export * from './lib/services/clients.service';
export * from './lib/services/tickets.service';
export * from './lib/services/statistics.service';
export * from './lib/notifications/agenstra-notification.events';
export * from './lib/notifications/agenstra-notification.publisher';
export * from './lib/utils/client-endpoint-security';
