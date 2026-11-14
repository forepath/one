import { isOtelEffectivelyEnabled, resolveOtelRuntimeConfig, setGauge } from '@forepath/shared/backend/util-otel';
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { UPDATES_MODULE_OPTIONS } from '../constants/updates.constants';
import type { UpdatesModuleOptions } from '../interfaces/updates-module.options';

import { UpdatesQueryService } from './updates-query.service';

const METER_NAME = 'forepath.updates';
const POLL_INTERVAL_MS = 60_000;

@Injectable()
export class UpdatesMetricsCollector implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(UpdatesMetricsCollector.name);
  private intervalHandle: NodeJS.Timeout | undefined;

  constructor(
    private readonly updatesQuery: UpdatesQueryService,
    @Inject(UPDATES_MODULE_OPTIONS) private readonly options: UpdatesModuleOptions,
  ) {}

  onModuleInit(): void {
    const config = resolveOtelRuntimeConfig(process.env, this.options.serviceName);

    if (!isOtelEffectivelyEnabled(config)) {
      return;
    }

    void this.collectMetrics();
    this.intervalHandle = setInterval(() => {
      void this.collectMetrics();
    }, POLL_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = undefined;
    }
  }

  /** Exposed for unit tests. */
  async collectMetrics(): Promise<void> {
    try {
      const full = await this.updatesQuery.getFullState();
      const baseAttrs = {
        application_id: this.options.applicationId,
        service_name: this.options.serviceName,
      };

      setGauge(METER_NAME, 'updates.info', 1, {
        ...baseAttrs,
        installed_version: full.installedVersion,
        latest_version: full.latestVersion ?? 'unknown',
        update_state: full.updateState,
        last_check_status: full.lastCheckStatus,
      });

      setGauge(METER_NAME, 'updates.update_available', full.updateState === 'update_available' ? 1 : 0, baseAttrs);

      setGauge(METER_NAME, 'updates.instance_count', full.instanceCount, baseAttrs);
      setGauge(METER_NAME, 'updates.outdated_instance_count', full.outdatedInstanceCount, baseAttrs);

      const lastCheckAtSeconds = full.lastCheckAt ? Math.floor(Date.parse(full.lastCheckAt) / 1000) : 0;

      setGauge(METER_NAME, 'updates.last_check_timestamp_seconds', lastCheckAtSeconds, baseAttrs);

      for (const instance of full.instances) {
        setGauge(METER_NAME, 'updates.instance_outdated', instance.updateState === 'update_available' ? 1 : 0, {
          ...baseAttrs,
          instance_id: instance.instanceId,
          role: instance.role,
          instance_service: instance.serviceName,
          installed_version: instance.installedVersion,
          update_state: instance.updateState,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';

      this.logger.warn(`Failed to collect updates OTEL metrics: ${message}`);
    }
  }
}
