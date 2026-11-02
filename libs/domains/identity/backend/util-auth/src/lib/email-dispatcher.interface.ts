/**
 * Injection token for an optional email dispatcher used by identity auth flows.
 * Consuming apps provide EmailNotificationDispatcherService (or a thin adapter).
 */
export const IDENTITY_EMAIL_DISPATCHER = Symbol('IDENTITY_EMAIL_DISPATCHER');

export interface IdentityEmailPublishInput {
  eventType: 'user.email_confirmation_requested' | 'user.password_reset_requested' | 'user.login_2fa_requested';
  to: string;
  templateKey: 'email-confirmation' | 'password-reset' | 'login-2fa';
  templateContext: Record<string, unknown>;
}

/**
 * Enqueues identity transactional mail; callers should await so Redis failures surface.
 */
export interface IIdentityEmailDispatcher {
  publishEmail(input: IdentityEmailPublishInput): Promise<void>;
  /**
   * Opt-in: whether the app can actually deliver email (e.g. SMTP is configured). Apps that implement it and return
   * false get email-based login 2FA (forced and user-enabled) not enforced, because no code could ever arrive. Apps
   * that don't implement it keep the strict behaviour (email 2FA enforced, issuing a code fails closed).
   */
  isDeliveryConfigured?(): boolean;
}

/** True only when the app's dispatcher opted in ({@link IIdentityEmailDispatcher.isDeliveryConfigured}) and reports no delivery. */
export function isIdentityEmailDeliveryUnavailable(dispatcher: IIdentityEmailDispatcher | null | undefined): boolean {
  return dispatcher?.isDeliveryConfigured?.() === false;
}
