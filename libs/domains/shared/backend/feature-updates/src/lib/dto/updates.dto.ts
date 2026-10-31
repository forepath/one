import type {
  ChangelogEntry,
  DependencyHealthStatus,
  InstanceDependencyHealth,
  ReleaseSnapshot,
  ScopedChangelog,
  ServiceInstanceRecord,
  UpdateCheckTriggerResult,
  UpdateState,
  UpdatesFullState,
  UpdatesStatusSummary,
} from '../interfaces/updates.interfaces';

export class ChangelogEntryDto implements ChangelogEntry {
  text!: string;
  scope!: 'product' | 'shared';
  product?: 'agenstra' | 'decabill' | 'loadweaver';
  category?: string;
}

export class ScopedChangelogDto implements ScopedChangelog {
  product!: ChangelogEntryDto[];
  shared!: ChangelogEntryDto[];
}

export class InstanceDependencyHealthDto implements InstanceDependencyHealth {
  redis!: DependencyHealthStatus;
  queue!: DependencyHealthStatus;
  database!: DependencyHealthStatus;
  opensearch!: DependencyHealthStatus;
}

export class ServiceInstanceRecordDto implements ServiceInstanceRecord {
  instanceId!: string;
  serviceName!: string;
  role!: string;
  hostname!: string;
  installedVersion!: string;
  updateState!: UpdateState;
  lastHeartbeatAt!: string;
  dependencies!: InstanceDependencyHealthDto;
}

export class ReleaseSnapshotDto implements ReleaseSnapshot {
  tagName!: string;
  name!: string;
  body!: string;
  htmlUrl!: string;
  publishedAt!: string;
  changelog!: ChangelogEntryDto[];
  scopedChangelog!: ScopedChangelogDto;
  prerelease?: boolean;
}

export class UpdatesStatusSummaryDto implements UpdatesStatusSummary {
  installedVersion!: string;
  latestVersion!: string | null;
  updateState!: UpdateState;
  lastCheckAt!: string | null;
  lastCheckStatus!: 'success' | 'failed' | 'pending' | 'unknown';
  instanceCount!: number;
  outdatedInstanceCount!: number;
  channel?: 'stable' | 'beta';
}

export class UpdatesFullStateDto implements UpdatesFullState {
  installedVersion!: string;
  latestVersion!: string | null;
  updateState!: UpdateState;
  lastCheckAt!: string | null;
  lastCheckStatus!: 'success' | 'failed' | 'pending' | 'unknown';
  instanceCount!: number;
  outdatedInstanceCount!: number;
  release!: ReleaseSnapshotDto | null;
  instances!: ServiceInstanceRecordDto[];
  scopedChangelog!: ScopedChangelogDto;
}

export class UpdateCheckTriggerResultDto implements UpdateCheckTriggerResult {
  jobId!: string;
  enqueuedAt!: string;
}
