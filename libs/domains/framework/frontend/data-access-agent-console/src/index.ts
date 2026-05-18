// Re-export auth symbols from identity for backward compatibility
export {
  // Interceptor
  getAuthInterceptor,
  getUsersSessionInvalidationInterceptor,
  // Service
  AuthService,
  // Facade
  AuthenticationFacade,
  // Reducer
  authenticationReducer,
  // Actions
  login,
  loginSuccess,
  loginFailure,
  logout,
  logoutSuccess,
  logoutFailure,
  checkAuthentication,
  checkAuthenticationSuccess,
  checkAuthenticationFailure,
  register,
  registerSuccess,
  registerFailure,
  confirmEmail,
  confirmEmailSuccess,
  confirmEmailFailure,
  requestPasswordReset,
  requestPasswordResetSuccess,
  requestPasswordResetFailure,
  resetPassword,
  resetPasswordSuccess,
  resetPasswordFailure,
  changePassword,
  changePasswordSuccess,
  changePasswordFailure,
  clearError,
  clearSuccessMessage,
  loadUsers,
  loadUsersSuccess,
  loadUsersFailure,
  loadUsersBatch,
  createUser,
  createUserSuccess,
  createUserFailure,
  updateUser,
  updateUserSuccess,
  updateUserFailure,
  deleteUser,
  deleteUserSuccess,
  deleteUserFailure,
  // Selectors
  selectAuthenticationState,
  selectIsAuthenticated,
  selectAuthenticationType,
  selectUser,
  selectAuthenticationLoading,
  selectAuthenticationError,
  selectSuccessMessage,
  selectIsNotAuthenticated,
  selectRegistering,
  selectConfirmingEmail,
  selectRequestingPasswordReset,
  selectResettingPassword,
  selectChangingPassword,
  selectUsers,
  selectUsersLoading,
  selectUsersError,
  selectCreatingUser,
  selectUpdatingUser,
  selectDeletingUser,
  selectIsAdmin,
  selectCanAccessUserManager,
  // Effects
  login$,
  loginSuccessRedirect$,
  logout$,
  logoutSuccessRedirect$,
  checkAuthentication$,
  register$,
  registerSuccessRedirect$,
  confirmEmail$,
  confirmEmailSuccessRedirect$,
  requestPasswordReset$,
  requestPasswordResetSuccessRedirect$,
  resetPassword$,
  resetPasswordSuccessRedirect$,
  changePassword$,
  loadUsers$,
  loadUsersBatch$,
  createUser$,
  updateUser$,
  deleteUser$,
  // Types
  type AuthenticationState,
  type UserInfo,
  type UserRole,
  type LoginResponse,
  type RegisterResponse,
  type UserResponseDto,
  type CreateUserDto,
  type UpdateUserDto,
  type ListUsersParams,
} from '@forepath/identity/frontend';

export * from './lib/utils/ticket-automation-chat-run-mapper';
export * from './lib/services/agents.service';
export * from './lib/services/clients.service';
export * from './lib/services/deployments.service';
export * from './lib/services/env.service';
export * from './lib/services/files.service';
export * from './lib/services/statistics.service';
export * from './lib/services/tickets.service';
export * from './lib/services/vcs.service';
export * from './lib/services/workspace-config.service';
export * from './lib/state/agents/agents.actions';
export * from './lib/state/agents/agents.effects';
export * from './lib/state/agents/agents.facade';
export * from './lib/state/agents/agents.reducer';
export * from './lib/state/agents/agents.selectors';
export * from './lib/state/agents/agents.types';
export * from './lib/state/client-agent-autonomy/client-agent-autonomy.actions';
export * from './lib/state/client-agent-autonomy/client-agent-autonomy.effects';
export * from './lib/state/client-agent-autonomy/client-agent-autonomy.facade';
export * from './lib/state/client-agent-autonomy/client-agent-autonomy.reducer';
export * from './lib/state/client-agent-autonomy/client-agent-autonomy.selectors';
export * from './lib/state/client-agent-autonomy/client-agent-autonomy.types';
export * from './lib/state/clients/clients.actions';
export * from './lib/state/clients/clients.effects';
export * from './lib/state/clients/clients.facade';
export * from './lib/state/clients/clients.reducer';
export * from './lib/state/clients/clients.selectors';
export * from './lib/state/clients/clients.types';
export * from './lib/state/deployments/deployments.actions';
export * from './lib/state/deployments/deployments.effects';
export * from './lib/state/deployments/deployments.facade';
export * from './lib/state/deployments/deployments.reducer';
export * from './lib/state/deployments/deployments.selectors';
export * from './lib/state/deployments/deployments.types';
export * from './lib/state/env/env.actions';
export * from './lib/state/env/env.effects';
export * from './lib/state/env/env.facade';
export * from './lib/state/env/env.reducer';
export * from './lib/state/env/env.selectors';
export * from './lib/state/env/env.types';
export * from './lib/services/filter-rules.service';
export * from './lib/services/knowledge.service';
export * from './lib/state/filter-rules/filter-rules.actions';
export * from './lib/state/filter-rules/filter-rules.effects';
export * from './lib/state/filter-rules/filter-rules.facade';
export * from './lib/state/filter-rules/filter-rules.reducer';
export * from './lib/state/filter-rules/filter-rules.selectors';
export * from './lib/state/filter-rules/filter-rules.types';
export * from './lib/services/context-import-admin.service';
export * from './lib/state/context-import/context-import.actions';
export * from './lib/state/context-import/context-import.effects';
export * from './lib/state/context-import/context-import.facade';
export * from './lib/state/context-import/context-import.reducer';
export * from './lib/state/context-import/context-import.selectors';
export * from './lib/state/context-import/context-import.types';
export * from './lib/state/files/files.actions';
export * from './lib/state/files/files.effects';
export * from './lib/state/files/files.facade';
export * from './lib/state/files/files.reducer';
export * from './lib/state/files/files.selectors';
export * from './lib/state/files/files.types';
export * from './lib/state/knowledge/knowledge.actions';
export * from './lib/state/knowledge/knowledge.effects';
export * from './lib/state/knowledge/knowledge.facade';
export * from './lib/state/knowledge/knowledge.reducer';
export * from './lib/state/knowledge/knowledge.selectors';
export * from './lib/state/knowledge/knowledge.types';
export * from './lib/state/sockets/client-chat-automation.constants';
export * from './lib/state/sockets/sockets.actions';
export * from './lib/state/sockets/sockets.effects';
export * from './lib/state/sockets/sockets.facade';
export * from './lib/state/sockets/sockets.reducer';
export * from './lib/state/sockets/sockets.selectors';
export * from './lib/state/sockets/sockets.types';
export * from './lib/state/tickets-board-socket/tickets-board-socket.actions';
export * from './lib/state/tickets-board-socket/tickets-board-socket.constants';
export * from './lib/state/tickets-board-socket/tickets-board-socket.effects';
export * from './lib/state/tickets-board-socket/tickets-board-socket.facade';
export * from './lib/state/tickets-board-socket/tickets-board-socket.reducer';
export * from './lib/state/tickets-board-socket/tickets-board-socket.selectors';
export * from './lib/state/knowledge-board-socket/knowledge-board-socket.actions';
export * from './lib/state/knowledge-board-socket/knowledge-board-socket.constants';
export * from './lib/state/knowledge-board-socket/knowledge-board-socket.effects';
export * from './lib/state/knowledge-board-socket/knowledge-board-socket.facade';
export * from './lib/state/knowledge-board-socket/knowledge-board-socket.reducer';
export * from './lib/state/knowledge-board-socket/knowledge-board-socket.selectors';
export * from './lib/state/notifications/notifications-attention.util';
export * from './lib/state/notifications/notifications.actions';
export * from './lib/state/notifications/notifications.effects';
export * from './lib/state/notifications/notifications.facade';
export * from './lib/state/notifications/notifications.reducer';
export * from './lib/state/notifications/notifications.selectors';
export * from './lib/state/notifications/notifications.types';
export * from './lib/state/notifications/status-socket.constants';
export * from './lib/state/statistics/statistics.actions';
export * from './lib/state/statistics/statistics.effects';
export * from './lib/state/statistics/statistics.facade';
export * from './lib/state/statistics/statistics.reducer';
export * from './lib/state/statistics/statistics.selectors';
export * from './lib/state/statistics/statistics.types';
export * from './lib/state/ticket-automation/ticket-automation.actions';
export * from './lib/state/ticket-automation/ticket-automation.effects';
export * from './lib/state/ticket-automation/ticket-automation.facade';
export * from './lib/state/ticket-automation/ticket-automation.reducer';
export * from './lib/state/ticket-automation/ticket-automation.selectors';
export * from './lib/state/ticket-automation/ticket-automation.types';
export * from './lib/state/tickets/tickets.actions';
export * from './lib/state/tickets/tickets.effects';
export * from './lib/state/tickets/tickets.facade';
export * from './lib/state/tickets/tickets.reducer';
export * from './lib/state/tickets/tickets.constants';
export * from './lib/state/tickets/ticket-global-search.utils';
export * from './lib/state/tickets/tickets.selectors';
export * from './lib/state/tickets/tickets.types';
export * from './lib/state/stats/stats.actions';
export * from './lib/state/stats/stats.effects';
export * from './lib/state/stats/stats.facade';
export * from './lib/state/stats/stats.reducer';
export * from './lib/state/stats/stats.selectors';
export * from './lib/state/stats/stats.types';
export * from './lib/state/vcs/vcs.actions';
export * from './lib/state/vcs/vcs.effects';
export * from './lib/state/vcs/vcs.facade';
export * from './lib/state/vcs/vcs.reducer';
export * from './lib/state/vcs/vcs.selectors';
export * from './lib/state/vcs/vcs.types';
export * from './lib/state/workspace-config/workspace-config.actions';
export * from './lib/state/workspace-config/workspace-config.effects';
export * from './lib/state/workspace-config/workspace-config.facade';
export * from './lib/state/workspace-config/workspace-config.reducer';
export * from './lib/state/workspace-config/workspace-config.selectors';
export * from './lib/state/workspace-config/workspace-config.types';
