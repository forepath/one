/**
 * Shared identity lifecycle webhook event types.
 * Domain catalogs (Agenstra, Decabill, …) should spread this into their event catalogs.
 */
export const IDENTITY_NOTIFICATION_EVENTS = ['user.created', 'user.updated', 'user.deleted'] as const;

export type IdentityNotificationEventType = (typeof IDENTITY_NOTIFICATION_EVENTS)[number];
