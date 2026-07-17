/**
 * Injection token for an optional email dispatcher used by identity auth flows.
 * Consuming apps provide EmailNotificationDispatcherService (or a thin adapter).
 */
export const IDENTITY_EMAIL_DISPATCHER = Symbol('IDENTITY_EMAIL_DISPATCHER');

export interface IdentityEmailPublishInput {
  eventType: 'user.email_confirmation_requested' | 'user.password_reset_requested';
  to: string;
  templateKey: 'email-confirmation' | 'password-reset';
  templateContext: Record<string, unknown>;
}

/**
 * Fire-and-forget email enqueue for identity transactional mail.
 */
export interface IIdentityEmailDispatcher {
  publishEmail(input: IdentityEmailPublishInput): void;
}
