// Components
export { IdentityConfirmEmailComponent } from './lib/confirm-email/confirm-email.component';
export { IdentityLoginComponent } from './lib/login/login.component';
export { IdentityLogin2faComponent } from './lib/login-2fa/login-2fa.component';
export { FpcOtpInputComponent as IdentityOtpInputComponent } from '@forepath/shared/frontend/ui-components';
export { IdentityRegisterComponent } from './lib/register/register.component';
export { IdentityRequestPasswordResetConfirmationComponent } from './lib/request-password-reset-confirmation/request-password-reset-confirmation.component';
export { IdentityRequestPasswordResetComponent } from './lib/request-password-reset/request-password-reset.component';
export { IdentityResetPasswordComponent } from './lib/reset-password/reset-password.component';
export { IdentitySamlCallbackComponent } from './lib/saml-callback/saml-callback.component';
export { IdentityLogoutConfirmModalComponent } from './lib/logout-confirm/logout-confirm-modal.component';
export type { LogoutConfirmResult } from './lib/logout-confirm/logout-confirm-modal.component';
export { IdentitySecuritySettingsComponent } from './lib/settings/security/security-settings.component';
export { IdentityTokenManagerComponent } from './lib/token-manager/token-manager.component';
export { IdentityUserManagerComponent } from './lib/user-manager/user-manager.component';
export { IdentityAppManagerComponent } from './lib/app-manager/app-manager.component';
export { IdentityAuthorizedAppsComponent } from './lib/authorized-apps/authorized-apps.component';
export { IdentityAppAuthorizeComponent } from './lib/app-authorize/app-authorize.component';

// Guards
export { adminGuard } from './lib/guards/admin.guard';
export { appAuthorizeGuard } from './lib/guards/app-authorize.guard';
export { authGuard } from './lib/guards/auth.guard';
export { loginGuard } from './lib/guards/login.guard';
export { signupDisabledGuard } from './lib/guards/signup-disabled.guard';

// Routes
export { identityAuthProviders, identityAuthRoutes } from './lib/identity-auth.routes';
