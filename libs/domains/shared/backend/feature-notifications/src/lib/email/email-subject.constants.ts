import type { EmailSubjectRegistry } from '@forepath/shared/backend/util-email';

export const IDENTITY_EMAIL_SUBJECTS: EmailSubjectRegistry = {
  'email-confirmation': 'Confirm your email',
  'password-reset': 'Reset your password',
  'login-2fa': 'Your login verification code',
};

export const IDENTITY_EMAIL_EVENTS = [
  'user.email_confirmation_requested',
  'user.password_reset_requested',
  'user.login_2fa_requested',
] as const;

export type IdentityEmailEventType = (typeof IDENTITY_EMAIL_EVENTS)[number];
