import { hostname } from 'os';

import type { InstanceDependencyHealth } from '@forepath/shared/backend';
import { getInstalledVersion, resolveInstanceId, resolveServiceRole } from '@forepath/shared/backend';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { InstanceStatusResponseDto } from '../dto/instance-status-response.dto';

@Injectable()
export class InstanceStatusService implements OnModuleInit {
  private startedAt = new Date();

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  onModuleInit(): void {
    this.startedAt = new Date();
  }

  async getStatus(): Promise<InstanceStatusResponseDto> {
    const role = resolveServiceRole(process.env);
    const installedVersion = getInstalledVersion(process.env);
    const resolvedHostname = process.env.HOSTNAME?.trim() || hostname();
    const uptimeSeconds = Math.floor((Date.now() - this.startedAt.getTime()) / 1000);

    return {
      instanceId: resolveInstanceId({
        serviceName: 'agent-manager',
        role,
      }),
      serviceName: 'agent-manager',
      role,
      hostname: resolvedHostname,
      installedVersion,
      startedAt: this.startedAt.toISOString(),
      uptimeSeconds,
      dependencies: await this.probeDependencies(),
    };
  }

  private async probeDependencies(): Promise<InstanceDependencyHealth> {
    let database: InstanceDependencyHealth['database'] = 'not_applicable';

    try {
      await this.dataSource.query('SELECT 1');
      database = 'healthy';
    } catch {
      database = 'degraded';
    }

    return {
      redis: 'not_applicable',
      queue: 'not_applicable',
      database,
      opensearch: 'not_applicable',
    };
  }
}
