import { MigrationInterface, QueryRunner, TableForeignKey } from 'typeorm';

/**
 * OpenCode config / layer-file sync targets had no foreign key on `client_id`: deleting a workspace left
 * orphaned targets that every reconcile cycle retried (and logged) forever. Removes orphans, then cascades
 * target rows with their client.
 */
export class CascadeSyncTargetsOnClientDelete1792300000000 implements MigrationInterface {
  name = 'CascadeSyncTargetsOnClientDelete1792300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const { table, foreignKey } of [
      { table: 'opencode_config_sync_targets', foreignKey: 'FK_opencode_config_sync_targets_client' },
      { table: 'opencode_layer_file_sync_targets', foreignKey: 'FK_opencode_layer_file_sync_targets_client' },
    ]) {
      if (!(await queryRunner.hasTable(table))) {
        continue;
      }

      await queryRunner.query(
        `DELETE FROM "${table}" AS t WHERE NOT EXISTS (SELECT 1 FROM "clients" AS c WHERE c."id" = t."client_id")`,
      );
      await queryRunner.createForeignKey(
        table,
        new TableForeignKey({
          name: foreignKey,
          columnNames: ['client_id'],
          referencedTableName: 'clients',
          referencedColumnNames: ['id'],
          onDelete: 'CASCADE',
        }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const { table, foreignKey } of [
      { table: 'opencode_layer_file_sync_targets', foreignKey: 'FK_opencode_layer_file_sync_targets_client' },
      { table: 'opencode_config_sync_targets', foreignKey: 'FK_opencode_config_sync_targets_client' },
    ]) {
      if (await queryRunner.hasTable(table)) {
        await queryRunner.dropForeignKey(table, foreignKey);
      }
    }
  }
}
