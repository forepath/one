/** Matches backend `EMAIL_NOT_CONFIRMED_CODE` on interactive login 401 responses. */
export const EMAIL_NOT_CONFIRMED_CODE = 'EMAIL_NOT_CONFIRMED';

/** Matches backend `LOGIN_2FA_REQUIRED_CODE` on interactive login 401 responses. */
export const LOGIN_2FA_REQUIRED_CODE = 'LOGIN_2FA_REQUIRED';

/** Matches backend `LOGIN_2FA_INVALID_CODE` when a submitted 2FA code was wrong or expired. */
export const LOGIN_2FA_INVALID_CODE = 'LOGIN_2FA_INVALID';

/** sessionStorage key for the password while completing login 2FA. */
export const PENDING_LOGIN_PASSWORD_STORAGE_KEY = 'identity-pending-login-password';
