export type UpdateState = 'up_to_date' | 'update_available' | 'unknown';

export type DependencyHealthStatus = 'healthy' | 'degraded' | 'unknown' | 'not_applicable';

export type ProductScope = 'agenstra' | 'decabill' | 'loadweaver';

/** Release channel: `beta` includes GitHub prereleases. */
export type UpdateChannel = 'stable' | 'beta';

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
  /** A GitHub prerelease (beta channel). */
  prerelease?: boolean;
}

export interface UpdatesStatusSummary {
  installedVersion: string;
  latestVersion: string | null;
  updateState: UpdateState;
  lastCheckAt: string | null;
  lastCheckStatus: 'success' | 'failed' | 'pending' | 'unknown';
  instanceCount: number;
  outdatedInstanceCount: number;
  /** The channel the check follows (products with channels). */
  channel?: UpdateChannel;
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

export type UpdatesPublishNotification = (type: string, data: Record<string, unknown>) => void;

export interface GitHubLatestRelease {
  tagName: string;
  name: string;
  body: string;
  htmlUrl: string;
  publishedAt: string;
  /** Set for GitHub prereleases (only returned for the beta channel). */
  prerelease?: boolean;
}
