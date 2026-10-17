/** Webhook events Loadweaver publishes (3.18 alert delivery, 3.19 apply results, 3.26 updates). */
export const LOADWEAVER_NOTIFICATION_EVENTS = [
  'alert.firing',
  'alert.resolved',
  'alert.acknowledged',
  'plan.applied',
  'plan.rolled-back',
  'plan.rollback-failed',
  // Update rollout (3.26): releases, update plans and their outcome.
  'update.available',
  'update.planned',
  'update.paused',
  'update.completed',
  'update.rolled-back',
  'update.rollback-failed',
] as const;
export type LoadweaverNotificationEvent = (typeof LOADWEAVER_NOTIFICATION_EVENTS)[number];

/** Email events (templates in `../templates`). */
export const LOADWEAVER_EMAIL_EVENTS = ['alert.firing', 'alert.resolved'] as const;

/** The control plane's job queue: notification deliveries and their retention. */
export const LOADWEAVER_QUEUE_NAME = 'loadweaver-control-plane';
