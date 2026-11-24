/**
 * Webhook events of the action center (products spread them into their catalogs and publish them from
 * `ActionCenterService.onSilenceChange`). Payload: `{ silenceId, itemType, itemId, audience, until, actorUserId }`.
 */
export const ACTION_CENTER_NOTIFICATION_EVENTS = [
  'action_center.silence.created',
  'action_center.silence.removed',
] as const;

export type ActionCenterNotificationEventType = (typeof ACTION_CENTER_NOTIFICATION_EVENTS)[number];

/** Webhook payload of a silence change. */
export function toActionCenterSilenceWebhookPayload(change: {
  actor: { userId: string };
  silence: { id: string; itemType: string; itemId: string | null; audience: string; until: string | null };
}): Record<string, unknown> {
  return {
    silenceId: change.silence.id,
    itemType: change.silence.itemType,
    itemId: change.silence.itemId,
    audience: change.silence.audience,
    until: change.silence.until,
    actorUserId: change.actor.userId,
  };
}

/** DI token of {@link ActionCenterModuleOptions}. */
export const ACTION_CENTER_MODULE_OPTIONS = Symbol('ACTION_CENTER_MODULE_OPTIONS');

/** Server → client: the viewer's current {@link ActionCenterView}. */
export const ACTION_CENTER_SNAPSHOT_EVENT = 'actionCenterSnapshot';

/** Server → client: connection-level problems (`{ message }`). */
export const ACTION_CENTER_ERROR_EVENT = 'error';

/** Client → server: ask for a fresh view (e.g. after the panel opened); answered with a snapshot event. */
export const ACTION_CENTER_REFRESH_EVENT = 'refreshActionCenter';

/** Default Socket.IO namespace (each product may override it via env). */
export const ACTION_CENTER_DEFAULT_NAMESPACE = 'socket/action-center';

/** Items per group in a view (the panel shows a stack; the full list lives on the linked page). */
export const ACTION_CENTER_VIEW_ITEM_LIMIT = 25;

/** Items a source may return per group: more than the view shows, so item silences can be subtracted. */
export const ACTION_CENTER_SOURCE_ITEM_LIMIT = 200;

/** Upper bound of silences for everyone per scope. */
export const ACTION_CENTER_MAX_SILENCES_PER_SCOPE = 2000;

/** Upper bound of personal silences per user (so one user cannot exhaust the scope limit). */
export const ACTION_CENTER_MAX_SILENCES_PER_USER = 300;

/** Item types follow `<application>.<area>.<condition>` in lowercase. */
export const ACTION_CENTER_ITEM_TYPE_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,4}$/;

/** Item ids are entity ids or composite keys (`<uuid>:<uuid>`). */
export const ACTION_CENTER_ITEM_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;

/** Socket room of all action center viewers of a scope. */
export function actionCenterScopeRoom(applicationId: string, scopeKey: string): string {
  return `action-center:${applicationId}:${scopeKey}`;
}

/** Valkey key holding the latest change revision of a scope (polled by every API process). */
export function buildActionCenterRevisionKey(keyPrefix: string, applicationId: string, scopeKey: string): string {
  return `${keyPrefix}action-center:${applicationId}:${scopeKey}:rev`;
}

interface IntervalSetting {
  env: string;
  defaultMs: number;
  minMs: number;
  maxMs: number;
}

/** How often API processes look for change revisions written by other processes (queue workers, replicas). */
export const ACTION_CENTER_REVISION_POLL: IntervalSetting = {
  env: 'ACTION_CENTER_REVISION_POLL_INTERVAL_MS',
  defaultMs: 2_000,
  minMs: 500,
  maxMs: 60_000,
};

/** Full recompute of every watched scope (time-based conditions such as overdue / expiring documents). */
export const ACTION_CENTER_REFRESH: IntervalSetting = {
  env: 'ACTION_CENTER_REFRESH_INTERVAL_MS',
  defaultMs: 60_000,
  minMs: 10_000,
  maxMs: 3_600_000,
};

/** Re-validation of connected sessions (expiry, lock, revocation, role change). */
export const ACTION_CENTER_SESSION_REVALIDATE: IntervalSetting = {
  env: 'ACTION_CENTER_SESSION_REVALIDATE_INTERVAL_MS',
  defaultMs: 60_000,
  minMs: 10_000,
  maxMs: 600_000,
};

/** Debounce between a change signal and the recompute (coalesces bursts such as bulk actions). */
export const ACTION_CENTER_RECOMPUTE_DEBOUNCE: IntervalSetting = {
  env: 'ACTION_CENTER_RECOMPUTE_DEBOUNCE_MS',
  defaultMs: 400,
  minMs: 0,
  maxMs: 10_000,
};

/** Reads an interval from env, clamped to its bounds; invalid values fall back to the default. */
export function readActionCenterInterval(setting: IntervalSetting, env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[setting.env]?.trim();

  if (!raw) {
    return setting.defaultMs;
  }

  const parsed = Number.parseInt(raw, 10);

  if (!Number.isFinite(parsed)) {
    return setting.defaultMs;
  }

  return Math.min(setting.maxMs, Math.max(setting.minMs, parsed));
}
