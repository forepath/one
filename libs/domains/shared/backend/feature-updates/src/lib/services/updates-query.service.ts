import { Inject, Injectable } from '@nestjs/common';

import { UPDATES_MODULE_OPTIONS } from '../constants/updates.constants';
import type { ScopedChangelog, UpdatesFullState, UpdatesStatusSummary } from '../interfaces/updates.interfaces';
import type { UpdatesModuleOptions } from '../interfaces/updates-module.options';
import { getInstalledVersion, resolveUpdateState } from '../utils/version.utils';
import { UpdatesRedisStore } from './updates-redis.store';

@Injectable()
export class UpdatesQueryService {
  constructor(
    private readonly store: UpdatesRedisStore,
    @Inject(UPDATES_MODULE_OPTIONS) private readonly options: UpdatesModuleOptions,
  ) {}

  async getStatusSummary(): Promise<UpdatesStatusSummary> {
    const [release, instances, checkJobMeta] = await Promise.all([
      this.store.getRelease(),
      this.store.listInstances(),
      this.store.getCheckJobMeta(),
    ]);
    const installedVersion = getInstalledVersion(process.env, this.options.versionEnv);
    const latestVersion = release?.tagName ?? null;
    const updateState = resolveUpdateState(installedVersion, latestVersion);
    const outdatedInstanceCount = instances.filter((instance) => instance.updateState === 'update_available').length;

    const channel = this.options.resolveChannel ? await this.options.resolveChannel() : undefined;

    return {
      installedVersion,
      latestVersion,
      updateState,
      ...(channel ? { channel } : {}),
      lastCheckAt: checkJobMeta?.lastCompletedAt ?? checkJobMeta?.lastTriggeredAt ?? null,
      lastCheckStatus: checkJobMeta?.lastStatus ?? 'unknown',
      instanceCount: instances.length,
      outdatedInstanceCount,
    };
  }

  async getFullState(): Promise<UpdatesFullState> {
    const [summary, release, instances] = await Promise.all([
      this.getStatusSummary(),
      this.store.getRelease(),
      this.store.listInstances(),
    ]);

    const scopedChangelog: ScopedChangelog = release?.scopedChangelog ?? {
      product: [],
      shared: [],
    };

    return {
      ...summary,
      release,
      instances,
      scopedChangelog,
    };
  }
}
