import { Inject, Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { enqueueUnitJob, buildJobId } from '@forepath/shared/backend/util-queue';

import { UPDATE_CHECK_JOB_NAME, UPDATES_MODULE_OPTIONS } from '../constants/updates.constants';
import type {
  ReleaseSnapshot,
  ServiceInstanceRecord,
  UpdateCheckJobMeta,
  UpdateCheckJobPayload,
  UpdateCheckTriggerResult,
} from '../interfaces/updates.interfaces';
import type { UpdatesModuleOptions } from '../interfaces/updates-module.options';
import { parseChangelogMarkdown, scopeChangelogEntries } from '../utils/changelog-scope.parser';
import { getInstalledVersion, normalizeVersion, resolveUpdateState } from '../utils/version.utils';
import { GitHubReleasesClient } from './github-releases.client';
import { UpdatesRedisStore } from './updates-redis.store';

@Injectable()
export class UpdateCheckService {
  private readonly logger = new Logger(UpdateCheckService.name);

  constructor(
    private readonly store: UpdatesRedisStore,
    private readonly githubReleasesClient: GitHubReleasesClient,
    @Inject(UPDATES_MODULE_OPTIONS) private readonly options: UpdatesModuleOptions,
    private readonly queue: Queue,
  ) {}

  async runCheck(): Promise<void> {
    const scopeKey = this.options.resolveScopeKey();
    const previousMeta = await this.store.getCheckJobMeta();
    const previousRelease = await this.store.getRelease();
    const previousLatest = previousRelease
      ? (normalizeVersion(previousRelease.tagName) ?? previousRelease.tagName)
      : null;

    await this.store.setCheckJobMeta({
      lastTriggeredAt: previousMeta?.lastTriggeredAt ?? null,
      lastCompletedAt: previousMeta?.lastCompletedAt ?? null,
      lastStatus: 'pending',
      lastError: null,
    });

    try {
      if (this.options.refreshRemoteInstances) {
        await this.options.refreshRemoteInstances();
      }

      const channel = (await this.options.resolveChannel?.()) ?? 'stable';
      const includePrereleases = channel === 'beta';
      const latestRelease = await this.githubReleasesClient.fetchLatestRelease(
        ...(includePrereleases ? [{ includePrereleases }] : []),
      );

      if (!latestRelease) {
        throw new Error('Latest GitHub release could not be resolved');
      }

      const installedVersion = getInstalledVersion(process.env, this.options.versionEnv);
      const releasesNewerThanInstalled = await this.githubReleasesClient.fetchReleasesNewerThan(
        installedVersion,
        ...(includePrereleases ? [{ includePrereleases }] : []),
      );
      const changelogSourceReleases =
        releasesNewerThanInstalled === null
          ? [latestRelease]
          : releasesNewerThanInstalled.length > 0
            ? releasesNewerThanInstalled
            : [];

      const changelog = changelogSourceReleases.flatMap((release) => parseChangelogMarkdown(release.body));
      const scopedChangelog = scopeChangelogEntries(changelog, this.options.productScope);
      const releaseSnapshot: ReleaseSnapshot = {
        ...latestRelease,
        changelog,
        scopedChangelog,
      };
      const latestVersion = normalizeVersion(releaseSnapshot.tagName) ?? releaseSnapshot.tagName;

      await this.store.setRelease(releaseSnapshot);
      await this.recomputeInstanceUpdateStates(releaseSnapshot.tagName);

      const updateState = resolveUpdateState(installedVersion, releaseSnapshot.tagName);
      const latestChanged = previousLatest !== latestVersion;

      if (updateState === 'update_available' && latestChanged) {
        this.publishNotification('application.update_available', {
          scopeKey,
          installedVersion,
          latestVersion,
          htmlUrl: releaseSnapshot.htmlUrl,
        });
      }

      await this.store.setCheckJobMeta({
        lastTriggeredAt: previousMeta?.lastTriggeredAt ?? new Date().toISOString(),
        lastCompletedAt: new Date().toISOString(),
        lastStatus: 'success',
        lastError: null,
      });
    } catch (error) {
      const message = (error as Error).message;

      this.logger.warn(`Update check failed: ${message}`);
      this.publishNotification('application.update_check_failed', {
        scopeKey,
        error: message,
      });

      await this.store.setCheckJobMeta({
        lastTriggeredAt: previousMeta?.lastTriggeredAt ?? new Date().toISOString(),
        lastCompletedAt: new Date().toISOString(),
        lastStatus: 'failed',
        lastError: message,
      });
    }
  }

  async triggerCheck(triggeredBy?: string): Promise<UpdateCheckTriggerResult> {
    const scopeKey = this.options.resolveScopeKey();
    const triggeredAt = new Date().toISOString();
    const payload: UpdateCheckJobPayload = {
      scopeKey,
      triggeredAt,
      ...(triggeredBy ? { triggeredBy } : {}),
    };

    await enqueueUnitJob({
      queue: this.queue,
      jobName: UPDATE_CHECK_JOB_NAME,
      payload,
      jobIdNamespace: 'updates',
      jobIdParts: [scopeKey, triggeredAt],
    });

    const jobId = buildJobId('updates', scopeKey, triggeredAt);

    await this.store.setCheckJobMeta({
      lastTriggeredAt: triggeredAt,
      lastCompletedAt: null,
      lastStatus: 'pending',
      lastError: null,
    });

    return {
      jobId,
      enqueuedAt: triggeredAt,
    };
  }

  private async recomputeInstanceUpdateStates(latestVersion: string): Promise<void> {
    const instances = await this.store.listInstances();

    await Promise.all(
      instances.map(async (instance) => {
        const previousState = instance.updateState;
        const updateState = resolveUpdateState(instance.installedVersion, latestVersion);
        const nextRecord: ServiceInstanceRecord = {
          ...instance,
          updateState,
        };

        await this.store.upsertInstance(nextRecord);

        if (updateState === 'update_available' && previousState !== 'update_available') {
          this.publishNotification('application.instance_outdated', {
            scopeKey: this.options.resolveScopeKey(),
            instanceId: instance.instanceId,
            serviceName: instance.serviceName,
            installedVersion: instance.installedVersion,
            latestVersion: normalizeVersion(latestVersion) ?? latestVersion,
          });
        }
      }),
    );
  }

  private publishNotification(type: string, data: Record<string, unknown>): void {
    this.options.publishNotification?.(type, data);
  }
}
