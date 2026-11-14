import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { MigrationInterface } from 'typeorm';
import { DataSource } from 'typeorm';

import type { ContributorJobSource } from '../utils/contributor-job.types';

import { AddonModuleRegistryService } from './addon-module-registry.service';
import { CloudInitModuleRegistryService } from './cloud-init-module-registry.service';
import { IntegratedStackRegistryService } from './integrated-stack-registry.service';
import { ProviderModuleRegistryService } from './provider-module-registry.service';

export interface RegisteredPluginMigration {
  name: string;
  factory: new () => MigrationInterface;
}

const SOURCE_KEY_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const CLASS_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;

export function buildPluginMigrationName(source: ContributorJobSource, sourceKey: string, className: string): string {
  const key = sourceKey.trim().toLowerCase();

  if (!SOURCE_KEY_PATTERN.test(key)) {
    throw new Error('Invalid plugin migration source key');
  }

  if (!CLASS_NAME_PATTERN.test(className)) {
    throw new Error('Invalid plugin migration class name');
  }

  return `plugin__${source}__${key}__${className}`;
}

@Injectable()
export class ContributorMigrationService {
  private readonly logger = new Logger(ContributorMigrationService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly addonModuleRegistry: AddonModuleRegistryService,
    private readonly integratedStackRegistry: IntegratedStackRegistryService,
    private readonly cloudInitModuleRegistry: CloudInitModuleRegistryService,
    private readonly providerModuleRegistry: ProviderModuleRegistryService,
  ) {}

  listRegistered(): RegisteredPluginMigration[] {
    const listed: RegisteredPluginMigration[] = [];
    const seen = new Set<string>();

    this.append(listed, seen, 'provider', this.providerModuleRegistry.list());
    this.append(listed, seen, 'addon', this.addonModuleRegistry.list());
    this.append(listed, seen, 'integrated', this.integratedStackRegistry.list());
    this.append(listed, seen, 'cloud-init', this.cloudInitModuleRegistry.list());

    return listed;
  }

  async runPending(): Promise<void> {
    const registered = this.listRegistered();

    if (registered.length === 0) {
      return;
    }

    for (const entry of registered) {
      await this.runOne(entry);
    }
  }

  private append(
    target: RegisteredPluginMigration[],
    seen: Set<string>,
    source: ContributorJobSource,
    modules: ReadonlyArray<{ key?: string; id?: string; migrations?: Array<new () => MigrationInterface> }>,
  ): void {
    for (const module of modules) {
      const sourceKey = module.key ?? module.id ?? '';

      for (const factory of module.migrations ?? []) {
        const name = buildPluginMigrationName(source, sourceKey, factory.name);

        if (seen.has(name)) {
          throw new Error('Duplicate plugin migration registration');
        }

        seen.add(name);
        target.push({ name, factory });
      }
    }
  }

  private async runOne(entry: RegisteredPluginMigration): Promise<void> {
    const queryRunner = this.dataSource.createQueryRunner();

    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const applied = (await queryRunner.query(`SELECT "name" FROM "migrations" WHERE "name" = $1`, [
        entry.name,
      ])) as Array<{ name: string }>;

      if (applied.length > 0) {
        await queryRunner.rollbackTransaction();

        return;
      }

      const instance = new entry.factory();

      await instance.up(queryRunner);
      await queryRunner.query(`INSERT INTO "migrations"("timestamp", "name") VALUES ($1, $2)`, [
        Date.now(),
        entry.name,
      ]);
      await queryRunner.commitTransaction();
      this.logger.log(`Applied plugin migration ${entry.name}`);
    } catch (error: unknown) {
      await queryRunner.rollbackTransaction();
      this.logger.error(`Plugin migration failed: ${entry.name}`);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
}
