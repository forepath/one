// Components
export { IdentityConfirmEmailComponent } from './lib/confirm-email/confirm-email.component';
export { IdentityLoginComponent } from './lib/login/login.component';
export { IdentityOtpInputComponent } from './lib/otp-input/otp-input.component';
export { IdentityRegisterComponent } from './lib/register/register.component';
export { IdentityRequestPasswordResetConfirmationComponent } from './lib/request-password-reset-confirmation/request-password-reset-confirmation.component';
export { IdentityRequestPasswordResetComponent } from './lib/request-password-reset/request-password-reset.component';
export { IdentityResetPasswordComponent } from './lib/reset-password/reset-password.component';
export { IdentityLogoutConfirmModalComponent } from './lib/logout-confirm/logout-confirm-modal.component';
export type { LogoutConfirmResult } from './lib/logout-confirm/logout-confirm-modal.component';
export { IdentityTokenManagerComponent } from './lib/token-manager/token-manager.component';
export { IdentityUserManagerComponent } from './lib/user-manager/user-manager.component';

// Guards
export { adminGuard } from './lib/guards/admin.guard';
export { authGuard } from './lib/guards/auth.guard';
export { loginGuard } from './lib/guards/login.guard';
export { signupDisabledGuard } from './lib/guards/signup-disabled.guard';

// Routes
export { identityAuthProviders, identityAuthRoutes } from './lib/identity-auth.routes';
