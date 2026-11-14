import { hostname } from 'os';

import { OpenSearchService } from '@forepath/shared/backend/util-opensearch';
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { Queue } from 'bullmq';
import { DataSource } from 'typeorm';


import { DEFAULT_HEARTBEAT_INTERVAL_MS, UPDATES_MODULE_OPTIONS } from '../constants/updates.constants';
import type { UpdatesModuleOptions } from '../interfaces/updates-module.options';
import type {
  DependencyHealthStatus,
  InstanceDependencyHealth,
  ServiceInstanceRecord,
} from '../interfaces/updates.interfaces';
import { resolveInstanceId, resolveServiceRole } from '../utils/instance-id.utils';
import { getInstalledVersion, resolveUpdateState } from '../utils/version.utils';

import { UpdatesRedisStore } from './updates-redis.store';

@Injectable()
export class InstanceHeartbeatService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InstanceHeartbeatService.name);
  private intervalHandle: NodeJS.Timeout | null = null;
  private lastDependencyHealth: InstanceDependencyHealth | null = null;
  private readonly instanceId: string;
  private readonly role: string;

  constructor(
    private readonly store: UpdatesRedisStore,
    @Inject(UPDATES_MODULE_OPTIONS) private readonly options: UpdatesModuleOptions,
    @Optional() private readonly queue: Queue | null,
    @Optional() private readonly dataSource: DataSource | null,
    @Optional() private readonly openSearch: OpenSearchService | null = null,
  ) {
    this.role = resolveServiceRole(process.env, options.resolveServiceRole);
    this.instanceId = resolveInstanceId({
      serviceName: options.serviceName,
      role: this.role,
    });
  }

  getInstanceId(): string {
    return this.instanceId;
  }

  onModuleInit(): void {
    const intervalMs = this.options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;

    void this.registerHeartbeat();

    this.intervalHandle = setInterval(() => {
      void this.registerHeartbeat();
    }, intervalMs);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  async registerHeartbeat(): Promise<void> {
    const dependencies = await this.probeDependencies();
    const installedVersion = getInstalledVersion(process.env, this.options.versionEnv);
    const release = await this.store.getRelease();
    const updateState = resolveUpdateState(installedVersion, release?.tagName ?? null);
    const record: ServiceInstanceRecord = {
      instanceId: this.instanceId,
      serviceName: this.options.serviceName,
      role: this.role,
      hostname: process.env.HOSTNAME?.trim() || hostname(),
      installedVersion,
      updateState,
      lastHeartbeatAt: new Date().toISOString(),
      dependencies,
    };

    await this.store.upsertInstance(record);
    this.emitDependencyHealthChanges(dependencies);
  }

  private async probeDependencies(): Promise<InstanceDependencyHealth> {
    const [redisHealthy, queueHealthy, databaseHealthy, openSearchHealthy] = await Promise.all([
      this.probeRedis(),
      this.probeQueue(),
      this.probeDatabase(),
      this.probeOpenSearch(),
    ]);

    return {
      redis: this.toHealthStatus(redisHealthy, true),
      queue: this.toHealthStatus(queueHealthy, Boolean(this.queue)),
      database: this.toHealthStatus(databaseHealthy, Boolean(this.dataSource)),
      opensearch: this.toHealthStatus(openSearchHealthy, this.isOpenSearchApplicable()),
    };
  }

  private isOpenSearchApplicable(): boolean {
    if (!this.openSearch) {
      return false;
    }

    return this.openSearch.isEnabled();
  }

  private async probeOpenSearch(): Promise<boolean> {
    if (!this.isOpenSearchApplicable() || !this.openSearch) {
      return false;
    }

    return this.openSearch.ping();
  }

  private toHealthStatus(isHealthy: boolean, isApplicable: boolean): DependencyHealthStatus {
    if (!isApplicable) {
      return 'not_applicable';
    }

    return isHealthy ? 'healthy' : 'degraded';
  }

  private async probeRedis(): Promise<boolean> {
    return await this.store.ping();
  }

  private async probeQueue(): Promise<boolean> {
    if (!this.queue) {
      return true;
    }

    try {
      await this.queue.getJobCounts();

      return true;
    } catch (error) {
      this.logger.warn(`Queue health probe failed: ${(error as Error).message}`);

      return false;
    }
  }

  private async probeDatabase(): Promise<boolean> {
    if (!this.dataSource) {
      return true;
    }

    try {
      await this.dataSource.query('SELECT 1');

      return true;
    } catch (error) {
      this.logger.warn(`Database health probe failed: ${(error as Error).message}`);

      return false;
    }
  }

  private emitDependencyHealthChanges(current: InstanceDependencyHealth): void {
    const publish = this.options.publishNotification;

    if (!publish) {
      this.lastDependencyHealth = current;

      return;
    }

    const previous = this.lastDependencyHealth;

    if (!previous) {
      this.lastDependencyHealth = current;

      return;
    }

    for (const dependency of ['redis', 'queue', 'database', 'opensearch'] as const) {
      if (previous[dependency] === current[dependency]) {
        continue;
      }

      publish('application.dependency_health_changed', {
        instanceId: this.instanceId,
        serviceName: this.options.serviceName,
        dependency,
        previousStatus: previous[dependency],
        currentStatus: current[dependency],
        scopeKey: this.options.resolveScopeKey(),
      });
    }

    this.lastDependencyHealth = current;
  }
}
