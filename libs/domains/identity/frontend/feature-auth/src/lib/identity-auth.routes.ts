import { Route } from '@angular/router';
import {
  adminClearTotp$,
  AuthenticationFacade,
  authenticationReducer,
  changePassword$,
  checkAuthentication$,
  confirmEmail$,
  confirmEmailSuccessRedirect$,
  confirmTotp$,
  createPersonalAccessToken$,
  createUser$,
  deleteUser$,
  disableEmail2fa$,
  disableTotp$,
  enableEmail2fa$,
  loadPersonalAccessTokenScopes$,
  loadPersonalAccessTokens$,
  loadTwoFactorStatus$,
  loadUsers$,
  loadUsersBatch$,
  lockUser$,
  login$,
  loginEmailNotConfirmedRedirect$,
  loginSuccessRedirect$,
  loginTwoFactorRequiredRedirect$,
  logout$,
  logoutSuccessRedirect$,
  PersonalAccessTokensFacade,
  personalAccessTokensReducer,
  register$,
  registerSuccessRedirect$,
  reloadTwoFactorStatusAfterMutation$,
  requestPasswordReset$,
  requestPasswordResetSuccessRedirect$,
  resetPassword$,
  resetPasswordSuccessRedirect$,
  revokePersonalAccessToken$,
  setupTotp$,
  unlockUser$,
  updatePersonalAccessToken$,
  updateUser$,
} from '@forepath/identity/frontend';
import { buildPageTitle } from '@forepath/shared/frontend/util-configuration';
import { provideEffects } from '@ngrx/effects';
import { provideState } from '@ngrx/store';

import { IdentityConfirmEmailComponent } from './confirm-email/confirm-email.component';
import { adminGuard } from './guards/admin.guard';
import { authGuard } from './guards/auth.guard';
import { loginGuard } from './guards/login.guard';
import { patUiGuard } from './guards/pat-ui.guard';
import { signupDisabledGuard } from './guards/signup-disabled.guard';
import { IdentityLoginComponent } from './login/login.component';
import { IdentityLogin2faComponent } from './login-2fa/login-2fa.component';
import { IdentityRegisterComponent } from './register/register.component';
import { IdentityRequestPasswordResetComponent } from './request-password-reset/request-password-reset.component';
import { IdentityRequestPasswordResetConfirmationComponent } from './request-password-reset-confirmation/request-password-reset-confirmation.component';
import { IdentityResetPasswordComponent } from './reset-password/reset-password.component';
import { IdentitySecuritySettingsComponent } from './settings/security/security-settings.component';
import { IdentityTokenManagerComponent } from './token-manager/token-manager.component';
import { IdentityUserManagerComponent } from './user-manager/user-manager.component';

/**
 * Identity auth routes for use in consuming applications.
 * These routes provide login, registration, password reset, email confirmation,
 * and user management functionality.
 *
 * The consuming application must provide:
 * - `IDENTITY_AUTH_ENVIRONMENT` token with `IdentityAuthEnvironment` value
 *
 * @example
 * ```typescript
 * import { identityAuthRoutes } from '@forepath/identity/frontend';
 *
 * const appRoutes: Route[] = [
 *   {
 *     path: '',
 *     children: [
 *       ...identityAuthRoutes,
 *       // ... other app routes
 *     ],
 *   },
 * ];
 * ```
 */
export const identityAuthRoutes: Route[] = [
  {
    path: 'login',
    component: IdentityLoginComponent,
    canActivate: [loginGuard],
    title: () => buildPageTitle($localize`:@@featureAuth-loginPage:Login`),
  },
  {
    path: 'login-2fa',
    component: IdentityLogin2faComponent,
    canActivate: [loginGuard],
    title: () => buildPageTitle($localize`:@@featureAuth-login2faPage:Two-Factor Authentication`),
  },
  {
    path: 'register',
    component: IdentityRegisterComponent,
    canActivate: [signupDisabledGuard, loginGuard],
    title: () => buildPageTitle($localize`:@@featureAuth-registerPage:Register`),
  },
  {
    path: 'request-password-reset',
    component: IdentityRequestPasswordResetComponent,
    canActivate: [loginGuard],
    title: () => buildPageTitle($localize`:@@featureAuth-requestPasswordResetPage:Request Password Reset`),
  },
  {
    path: 'request-password-reset-confirmation',
    component: IdentityRequestPasswordResetConfirmationComponent,
    canActivate: [loginGuard],
    title: () =>
      buildPageTitle($localize`:@@featureAuth-requestPasswordResetConfirmationPage:Password Reset Requested`),
  },
  {
    path: 'reset-password',
    component: IdentityResetPasswordComponent,
    canActivate: [loginGuard],
    title: () => buildPageTitle($localize`:@@featureAuth-resetPasswordPage:Reset Password`),
  },
  {
    path: 'confirm-email',
    component: IdentityConfirmEmailComponent,
    canActivate: [loginGuard],
    title: () => buildPageTitle($localize`:@@featureAuth-confirmEmailPage:Confirm Email`),
  },
  {
    path: 'users',
    canActivate: [authGuard, adminGuard],
    component: IdentityUserManagerComponent,
    title: () => buildPageTitle($localize`:@@featureAuth-usersPage:User Management`),
  },
  {
    path: 'settings/tokens',
    canActivate: [authGuard, patUiGuard],
    component: IdentityTokenManagerComponent,
    title: () => buildPageTitle($localize`:@@featureAuth-tokensPage:Personal Access Tokens`),
  },
  {
    path: 'settings/security',
    canActivate: [authGuard],
    component: IdentitySecuritySettingsComponent,
    title: () => buildPageTitle($localize`:@@featureAuth-securityPage:Security Settings`),
  },
];

/**
 * NgRx providers for identity authentication state.
 * Include these in the route providers of the parent route
 * that contains the identity auth routes.
 *
 * @example
 * ```typescript
 * import { identityAuthRoutes, identityAuthProviders } from '@forepath/identity/frontend';
 *
 * const appRoutes: Route[] = [
 *   {
 *     path: '',
 *     children: [
 *       ...identityAuthRoutes,
 *       // ... other app routes
 *     ],
 *     providers: [
 *       ...identityAuthProviders,
 *       // ... other providers
 *     ],
 *   },
 * ];
 * ```
 */
export const identityAuthProviders = [
  AuthenticationFacade,
  PersonalAccessTokensFacade,
  provideState('authentication', authenticationReducer),
  provideState('personalAccessTokens', personalAccessTokensReducer),
  provideEffects({
    login$,
    loginSuccessRedirect$,
    loginEmailNotConfirmedRedirect$,
    loginTwoFactorRequiredRedirect$,
    register$,
    registerSuccessRedirect$,
    confirmEmail$,
    confirmEmailSuccessRedirect$,
    requestPasswordReset$,
    requestPasswordResetSuccessRedirect$,
    resetPassword$,
    resetPasswordSuccessRedirect$,
    logout$,
    logoutSuccessRedirect$,
    checkAuthentication$,
    changePassword$,
    loadUsers$,
    loadUsersBatch$,
    createUser$,
    updateUser$,
    deleteUser$,
    lockUser$,
    unlockUser$,
    loadTwoFactorStatus$,
    enableEmail2fa$,
    disableEmail2fa$,
    setupTotp$,
    confirmTotp$,
    disableTotp$,
    adminClearTotp$,
    reloadTwoFactorStatusAfterMutation$,
    loadPersonalAccessTokens$,
    loadPersonalAccessTokenScopes$,
    createPersonalAccessToken$,
    updatePersonalAccessToken$,
    revokePersonalAccessToken$,
  }),
];
