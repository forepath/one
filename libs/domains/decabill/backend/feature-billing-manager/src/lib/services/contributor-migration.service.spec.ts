import type { MigrationInterface, QueryRunner } from 'typeorm';

import { AddonModuleRegistryService, type BillingAddonModule } from './addon-module-registry.service';
import { CloudInitModuleRegistryService } from './cloud-init-module-registry.service';
import { buildPluginMigrationName, ContributorMigrationService } from './contributor-migration.service';
import { IntegratedStackRegistryService } from './integrated-stack-registry.service';
import { ProviderModuleRegistryService } from './provider-module-registry.service';

class SamplePluginMigration implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('SELECT 1');
  }

  async down(): Promise<void> {
    return;
  }
}

describe('ContributorMigrationService', () => {
  const createAddon = (migrations?: BillingAddonModule['migrations']): BillingAddonModule => ({
    key: 'container-manager',
    displayName: 'CM',
    migrations,
    provision: jest.fn().mockResolvedValue(undefined),
    teardown: jest.fn().mockResolvedValue(undefined),
  });

  function createService(appliedNames: string[] = []) {
    const providers = new ProviderModuleRegistryService();
    const addons = new AddonModuleRegistryService();
    const stacks = new IntegratedStackRegistryService();
    const cloudInit = new CloudInitModuleRegistryService();

    addons.register(createAddon([SamplePluginMigration]));

    const query = jest.fn(async (sql: string) => {
      if (sql.includes('SELECT')) {
        return appliedNames.map((name) => ({ name }));
      }

      return [];
    });
    const queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      query,
    };
    const dataSource = {
      createQueryRunner: jest.fn(() => queryRunner),
    };
    const service = new ContributorMigrationService(dataSource as never, addons, stacks, cloudInit, providers);

    return { service, query, queryRunner };
  }

  it('builds a collision-resistant plugin migration name', () => {
    expect(buildPluginMigrationName('addon', 'container-manager', 'SamplePluginMigration')).toBe(
      'plugin__addon__container-manager__SamplePluginMigration',
    );
  });

  it('runs a pending plugin migration once and records the name', async () => {
    const { service, query, queryRunner } = createService([]);

    await service.runPending();

    expect(query).toHaveBeenCalledWith(expect.stringContaining('SELECT "name" FROM "migrations"'), [
      'plugin__addon__container-manager__SamplePluginMigration',
    ]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO "migrations"'), [
      expect.any(Number),
      'plugin__addon__container-manager__SamplePluginMigration',
    ]);
    expect(queryRunner.commitTransaction).toHaveBeenCalled();
  });

  it('skips already applied plugin migrations', async () => {
    const { service, queryRunner } = createService(['plugin__addon__container-manager__SamplePluginMigration']);

    await service.runPending();

    expect(queryRunner.commitTransaction).not.toHaveBeenCalled();
    expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
  });

  it('fails closed when up throws', async () => {
    const providers = new ProviderModuleRegistryService();
    const addons = new AddonModuleRegistryService();
    const stacks = new IntegratedStackRegistryService();
    const cloudInit = new CloudInitModuleRegistryService();

    class FailingMigration implements MigrationInterface {
      async up(): Promise<void> {
        throw new Error('boom');
      }

      async down(): Promise<void> {
        return;
      }
    }

    addons.register(createAddon([FailingMigration]));

    const queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockResolvedValue([]),
    };
    const service = new ContributorMigrationService(
      { createQueryRunner: () => queryRunner } as never,
      addons,
      stacks,
      cloudInit,
      providers,
    );

    await expect(service.runPending()).rejects.toThrow('boom');
    expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
    expect(queryRunner.commitTransaction).not.toHaveBeenCalled();
  });
});
