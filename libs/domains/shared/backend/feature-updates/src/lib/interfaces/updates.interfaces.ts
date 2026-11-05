export type UpdateState = 'up_to_date' | 'update_available' | 'unknown';

export type DependencyHealthStatus = 'healthy' | 'degraded' | 'unknown' | 'not_applicable';

export type ProductScope = 'agenstra' | 'decabill';

export interface InstanceDependencyHealth {
  redis: DependencyHealthStatus;
  queue: DependencyHealthStatus;
  database: DependencyHealthStatus;
  opensearch: DependencyHealthStatus;
}

export interface ServiceInstanceRecord {
  instanceId: string;
  serviceName: string;
  role: string;
  hostname: string;
  installedVersion: string;
  updateState: UpdateState;
  lastHeartbeatAt: string;
  dependencies: InstanceDependencyHealth;
}

export interface ChangelogEntry {
  text: string;
  scope: 'product' | 'shared';
  product?: ProductScope;
  category?: string;
}

export interface ScopedChangelog {
  product: ChangelogEntry[];
  shared: ChangelogEntry[];
}

export interface ReleaseSnapshot {
  tagName: string;
  name: string;
  body: string;
  htmlUrl: string;
  publishedAt: string;
  changelog: ChangelogEntry[];
  scopedChangelog: ScopedChangelog;
}

export interface UpdatesStatusSummary {
  installedVersion: string;
  latestVersion: string | null;
  updateState: UpdateState;
  lastCheckAt: string | null;
  lastCheckStatus: 'success' | 'failed' | 'pending' | 'unknown';
  instanceCount: number;
  outdatedInstanceCount: number;
}

export interface UpdatesFullState extends UpdatesStatusSummary {
  release: ReleaseSnapshot | null;
  instances: ServiceInstanceRecord[];
  scopedChangelog: ScopedChangelog;
}

export interface UpdateCheckJobMeta {
  lastTriggeredAt: string | null;
  lastCompletedAt: string | null;
  lastStatus: 'success' | 'failed' | 'pending' | 'unknown';
  lastError: string | null;
}

export interface UpdateCheckJobPayload {
  scopeKey: string;
  triggeredAt: string;
  triggeredBy?: string;
}

export interface UpdateCheckTriggerResult {
  jobId: string;
  enqueuedAt: string;
}

/**
 * Application update webhook event types. Shared by every product; domain catalogs spread this in
 * (same idea as `IDENTITY_NOTIFICATION_EVENTS`).
 */
export const APPLICATION_NOTIFICATION_EVENTS = [
  'application.update_available',
  'application.update_check_failed',
  'application.instance_outdated',
  'application.dependency_health_changed',
] as const;

export type ApplicationNotificationEventType = (typeof APPLICATION_NOTIFICATION_EVENTS)[number];

export type UpdatesPublishNotification = (
  type: ApplicationNotificationEventType,
  data: Record<string, unknown>,
) => void;

export interface GitHubLatestRelease {
  tagName: string;
  name: string;
  body: string;
  htmlUrl: string;
  publishedAt: string;
}
