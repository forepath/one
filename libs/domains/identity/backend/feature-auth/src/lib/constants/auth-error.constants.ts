/** Stable machine-readable code for unconfirmed email on interactive login. */
export const EMAIL_NOT_CONFIRMED_CODE = 'EMAIL_NOT_CONFIRMED';

export const EMAIL_NOT_CONFIRMED_MESSAGE = 'Email not confirmed. Please confirm your email before logging in.';

/** Stable machine-readable code when a second factor is required on interactive login. */
export const LOGIN_2FA_REQUIRED_CODE = 'LOGIN_2FA_REQUIRED';

export const LOGIN_2FA_REQUIRED_MESSAGE =
  'Two-factor authentication required. Enter the verification code to continue.';

/** Submitted second-factor code was wrong or expired (not a fresh challenge). */
export const LOGIN_2FA_INVALID_CODE = 'LOGIN_2FA_INVALID';

export const LOGIN_2FA_INVALID_MESSAGE = 'Invalid verification code. Please try again.';

export type Login2faMethod = 'email' | 'totp';

/** Force login 2FA is on unless DISABLE_FORCE_LOGIN_2FA is exactly "true". */
export function isForceLogin2faEnabled(): boolean {
  return process.env.DISABLE_FORCE_LOGIN_2FA !== 'true';
}
