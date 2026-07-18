/**
 * Injection token for an optional notification publisher.
 * Consuming apps can provide their own implementation via this token.
 * If not provided, notification publishing is silently skipped.
 */
export const IDENTITY_NOTIFICATION_PUBLISHER = Symbol('IDENTITY_NOTIFICATION_PUBLISHER');

/**
 * Minimal interface for publishing identity lifecycle events to webhooks.
 * Implementations should be fire-and-forget (errors logged, not thrown).
 * Event type strings live in IDENTITY_NOTIFICATION_EVENTS.
 */
export interface IIdentityNotificationPublisher {
  publishUserCreated(data: Record<string, unknown>): void;

  publishUserUpdated(data: Record<string, unknown>): void;

  publishUserDeleted(data: Record<string, unknown>): void;

  publishClientUserCreated(data: Record<string, unknown>, clientId: string): void;

  publishClientUserDeleted(data: Record<string, unknown>, clientId: string): void;
}
