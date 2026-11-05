/**
 * Webhook event type naming convention (shared by every Forepath application).
 *
 * Modeled on the Stripe / Standard Webhooks style: dot-delimited, lowercase `snake_case` segments.
 *
 * - `<resource>.<action>` — e.g. `ticket.created`, `invoice.paid`, `customer_trust.level_changed`
 * - `<resource>.<child>.<action>` — only when `<child>` is a dependent record with its own id that lives
 *   under `<resource>` (e.g. `ticket.comment.created`, `offer.line.fulfilled`, `subscription.service.started`).
 *   Modes, kinds or plugin keys are never a segment; they belong in the payload (e.g. `mode: "auto"`).
 *
 * `<resource>` is the singular form of the matching PAT scope resource (`tickets:read` → `ticket.*`) or entity.
 * `<action>` is a past-tense verb (`created`, `updated`, `deleted`, `failed`) or the resulting state
 * (`available`, `exhausted`); attribute / relationship changes use `<noun>_<verb>` (`meter_attached`).
 * The same concept carries the same event type in every application.
 */
export const WEBHOOK_EVENT_TYPE_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*){1,2}$/;

export function isWebhookEventTypeName(type: string): boolean {
  return WEBHOOK_EVENT_TYPE_PATTERN.test(type) && !type.split('.').some((segment) => segment.endsWith('_'));
}

/** Catalog violations: names that break the convention and duplicate entries. */
export function findWebhookEventCatalogViolations(catalog: readonly string[]): {
  invalid: string[];
  duplicates: string[];
} {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const type of catalog) {
    if (seen.has(type)) {
      duplicates.add(type);
    }

    seen.add(type);
  }

  return {
    invalid: catalog.filter((type) => !isWebhookEventTypeName(type)),
    duplicates: [...duplicates],
  };
}

/** Throws when a webhook event catalog contains malformed or duplicate event types (fail fast at bootstrap). */
export function assertWebhookEventCatalog(catalog: readonly string[]): void {
  const { invalid, duplicates } = findWebhookEventCatalogViolations(catalog);

  if (invalid.length > 0 || duplicates.length > 0) {
    throw new Error(
      `Invalid webhook event catalog${invalid.length ? `; malformed: ${invalid.join(', ')}` : ''}${
        duplicates.length ? `; duplicate: ${duplicates.join(', ')}` : ''
      }`,
    );
  }
}
