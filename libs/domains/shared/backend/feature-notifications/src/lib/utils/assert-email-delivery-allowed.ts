import type { NotificationsEmailOptions } from '../interfaces/notifications-module.options';

const TEMPLATE_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Enforces email event/template allowlists at enqueue and delivery time.
 */
export function assertEmailDeliveryAllowed(
  emailOptions: NotificationsEmailOptions,
  eventType: string,
  templateKey: string,
): void {
  if (!TEMPLATE_KEY_PATTERN.test(templateKey)) {
    throw new Error(`Invalid email template key: ${templateKey}`);
  }

  if (!emailOptions.emailEventCatalog.includes(eventType)) {
    throw new Error(`Email event type is not allowlisted: ${eventType}`);
  }

  if (!(templateKey in emailOptions.subjectRegistry)) {
    throw new Error(`Email template key is not allowlisted: ${templateKey}`);
  }
}
