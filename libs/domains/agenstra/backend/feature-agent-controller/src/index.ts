// Re-export identity auth symbols for backward compatibility
// Consumers should migrate to importing directly from @forepath/identity/backend
export {
  // Decorators
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
  ExternalIdentityAuthGuard,
  // Services
  AuthService,
  UsersService,
  SocketAuthService,
  OidcClientCredentialsService,
  ClientAgentCredentialsService,
  ClientUsersService,
  PasswordService,
  // Controllers
  AuthController,
  UsersController,
  // Modules
  UsersAuthModule,
  OidcAuthModule,
  SamlAuthModule,
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
export * from './lib/dto/client-ping-response.dto';
export * from './lib/dto/client-isolation.dto';
export * from './lib/dto/create-client-response.dto';
export * from './lib/dto/create-client.dto';
export * from './lib/dto/update-client.dto';
export * from './lib/entities/atlassian-site-connection.entity';
export * from './lib/entities/deployment-connection.entity';
export * from './lib/entities/deployment-workflow.entity';
export * from './lib/entities/deployment-run.entity';
export * from './lib/entities/external-import-config.entity';
export * from './lib/entities/external-import-sync-marker.entity';
export * from './lib/entities/external-import.enums';
export * from './lib/entities/client-agent-autonomy.entity';
export * from './lib/entities/knowledge-node-embedding.entity';
export * from './lib/entities/knowledge-node.entity';
export * from './lib/entities/agenstra-attachment.entity';
export * from './lib/entities/attachment.enums';
export * from './lib/entities/knowledge-page-activity.entity';
export * from './lib/entities/knowledge-relation.entity';
export * from './lib/entities/provisioning-reference.entity';
export * from './lib/entities/ticket-automation-lease.entity';
export * from './lib/entities/ticket-automation-run-step.entity';
export * from './lib/entities/ticket-automation-run.entity';
export * from './lib/entities/ticket-automation.entity';
export * from './lib/entities/ticket-automation.enums';
export * from './lib/entities/chat-plan.entity';
export * from './lib/entities/chat-plan-activity.entity';
export * from './lib/entities/chat-plan.enums';
export * from './lib/entities/initiative.entity';
export * from './lib/entities/initiative-artifact.entity';
export * from './lib/entities/initiative-artifact-version.entity';
export * from './lib/entities/initiative-work-item.entity';
export * from './lib/entities/initiative-work-item-dependency.entity';
export * from './lib/entities/initiative-unknown.entity';
export * from './lib/entities/initiative-run.entity';
export * from './lib/entities/initiative-run-turn.entity';
export * from './lib/entities/initiative-change-proposal.entity';
export * from './lib/entities/initiative-decision.entity';
export * from './lib/entities/initiative-finding.entity';
export * from './lib/entities/initiative-activity.entity';
export * from './lib/entities/initiative.enums';
export * from './lib/entities/initiative.entities';
export * from './lib/entities/agent-task.entity';
export * from './lib/entities/agent-task-run.entity';
export * from './lib/entities/agent-handoff.entity';
export * from './lib/entities/ticket-activity.entity';
export * from './lib/entities/ticket-body-generation-session.entity';
export * from './lib/entities/ticket-comment.entity';
export * from './lib/entities/ticket.entity';
export * from './lib/entities/user-chat-session-read-state.entity';
export * from './lib/entities/user-environment-read-state.entity';
export * from './lib/entities/ticket.enums';
export * from './lib/dto/attachment.dto';
export * from './lib/entities/statistics-agent.entity';
export * from './lib/entities/statistics-chat-filter-drop.entity';
export * from './lib/entities/statistics-chat-filter-flag.entity';
export * from './lib/entities/statistics-egress-event.entity';
export * from './lib/entities/egress-event-ingest-cursor.entity';
export * from './lib/entities/client-isolation-snapshot.entity';
export * from './lib/entities/workspace-graph-snapshot.entity';
export * from './lib/entities/statistics-chat-io.entity';
export * from './lib/entities/statistics-client-user.entity';
export * from './lib/entities/statistics-client.entity';
export * from './lib/entities/statistics-entity-event.entity';
export * from './lib/entities/statistics-provisioning-reference.entity';
export * from './lib/entities/statistics-user.entity';
export * from './lib/entities/global-opencode-config.entity';
export * from './lib/entities/client-opencode-config.entity';
export * from './lib/entities/opencode-provider.entity';
export * from './lib/entities/opencode-mcp-server.entity';
export * from './lib/entities/opencode-layer-file.entity';
export * from './lib/entities/opencode-layer-file-sync-target.entity';
export * from './lib/entities/opencode-config-sync-target.entity';
export * from './lib/constants/opencode-providers.constants';
export * from './lib/constants/opencode-mcp-servers.constants';
export * from './lib/dto/opencode-providers.dto';
export * from './lib/dto/opencode-mcp-servers.dto';
export * from './lib/services/opencode-providers-catalog.service';
export * from './lib/services/opencode-providers-bootstrap.service';
export * from './lib/services/opencode-mcp-servers-catalog.service';
export * from './lib/services/opencode-mcp-servers-bootstrap.service';
export * from './lib/services/opencode-effective-config-sync.service';
export * from './lib/services/opencode-config-sync-targets.service';
export * from './lib/services/egress-events-ingest.service';
export * from './lib/services/client-isolation.service';
export * from './lib/services/opencode-layer-files.service';
export * from './lib/controllers/opencode-providers.controller';
export * from './lib/controllers/opencode-mcp-servers.controller';
export * from './lib/controllers/client-agent-autonomy.controller';
export * from './lib/controllers/clients-agent-automation-proxy.controller';
export * from './lib/controllers/ticket-automation.controller';
export * from './lib/controllers/chat-plan.controller';
export * from './lib/controllers/initiatives.controller';
export * from './lib/controllers/tickets.controller';
export * from './lib/modules/context-import.module';
export * from './lib/modules/clients.module';
export * from './lib/modules/agenstra-notifications.module';
export * from './lib/modules/agenstra-updates.module';
export * from './lib/modules/agenstra-otel.module';
export * from './lib/modules/identity-notification-bridge.module';
export * from './lib/modules/identity-email-bridge.module';
export * from './lib/modules/identity-statistics-bridge.module';
export * from './lib/modules/statistics.module';
export * from './lib/search/agenstra-search.module';
export * from './lib/search/agenstra-search-index.service';
export * from './lib/search/agenstra-search.types';
export * from './lib/search/agenstra-search-document.mapper';
export * from './lib/repositories/clients.repository';
export * from './lib/repositories/statistics.repository';
export * from './lib/dto/ticket-automation';
export * from './lib/dto/chat-plan';
export * from './lib/dto/initiatives';
export * from './lib/dto/agent-tasks';
export * from './lib/constants/agent-tasks.constants';
export * from './lib/utils/agent-task-queue.utils';
export * from './lib/services/agent-tasks.service';
export * from './lib/services/agent-task-runner.service';
export * from './lib/controllers/agent-tasks.controller';
export * from './lib/dto/deployments';
export * from './lib/services/deployment-workflows.service';
export * from './lib/services/agent-deployment-sources.service';
export * from './lib/services/deployment-runs.service';
export * from './lib/services/deployment-connections.service';
export * from './lib/providers/deployment/deployment-provider.interface';
export * from './lib/providers/deployment/deployment-provider.registry';
export * from './lib/constants/agent-handoffs.constants';
export * from './lib/utils/agent-handoff-queue.utils';
export * from './lib/services/agent-handoffs.service';
export * from './lib/services/agent-handoff-runner.service';
export * from './lib/services/autonomous-run-orchestrator.service';
export * from './lib/services/autonomous-run-orchestrator.service';
export * from './lib/services/context-import-orchestrator.service';
export * from './lib/services/external-import-config.service';
export * from './lib/modules/clients.module';
export * from './lib/modules/context-import.module';
export * from './lib/services/client-agent-autonomy.service';
export * from './lib/services/client-agent-proxy.service';
export * from './lib/services/auto-context-resolver.service';
export * from './lib/services/embeddings/knowledge-embedding-index.service';
export * from './lib/services/embeddings/local-embedding.provider';
export * from './lib/services/remote-agents-session.service';
export * from './lib/services/ticket-automation.service';
export * from './lib/services/chat-plan.service';
export * from './lib/services/chat-plan-activity.service';
export * from './lib/services/chat-plan-orchestrator.service';
export * from './lib/services/chat-plan-chat-sync.service';
export * from './lib/services/chat-plan-realtime.service';
export * from './lib/services/initiatives.service';
export * from './lib/services/initiative-artifacts.service';
export * from './lib/services/initiative-work-items.service';
export * from './lib/services/initiative-learn.service';
export * from './lib/services/initiative-context.service';
export * from './lib/services/initiative-build.service';
export * from './lib/services/initiative-runs.service';
export * from './lib/services/initiative-run-orchestrator.service';
export * from './lib/services/initiative-automation-hooks';
export * from './lib/services/initiative-board-realtime.service';
export * from './lib/services/initiative-board-realtime.constants';
export * from './lib/services/client-chat-plan.constants';
export * from './lib/services/clients.service';
export * from './lib/services/tickets.service';
export * from './lib/services/statistics.service';
export * from './lib/notifications/agenstra-notification.events';
export * from './lib/auth/agenstra-pat.scopes';
export * from './lib/notifications/agenstra-notification.publisher';
export * from './lib/utils/mcp-oauth-callback-global-prefix';
export * from './lib/utils/client-endpoint-security';
export * from './lib/controllers/client-agent-egress.controller';
export * from './lib/controllers/client-isolation.controller';
export * from './lib/controllers/clients-graph.controller';
export * from './lib/services/client-agent-graph-proxy.service';
export * from './lib/constants/workspace-graph-snapshot.constants';
export * from './lib/services/workspace-graph-snapshot.service';
export * from './lib/services/workspace-graph-view.service';
export * from './lib/repositories/workspace-graph-snapshots.repository';
