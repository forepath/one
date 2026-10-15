import { MigrationInterface, QueryRunner, Table, TableForeignKey } from 'typeorm';

/**
 * Container isolation levels: last observed isolation capabilities per workspace host. Transitions
 * (sandbox available / unavailable, runc baseline failed) are published as notifications.
 */
export class CreateClientIsolationSnapshots1792100000000 implements MigrationInterface {
  name = 'CreateClientIsolationSnapshots1792100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'client_isolation_snapshots',
        columns: [
          { name: 'client_id', type: 'uuid', isPrimary: true },
          { name: 'revision', type: 'varchar', length: '80', isNullable: true },
          { name: 'standard_state', type: 'varchar', length: '32', isNullable: true },
          { name: 'sandboxed_state', type: 'varchar', length: '32', isNullable: true },
          { name: 'recommended_level', type: 'varchar', length: '16', isNullable: true },
          { name: 'capabilities', type: 'jsonb', isNullable: true },
          { name: 'probed_at', type: 'timestamp', isNullable: true },
          { name: 'checked_at', type: 'timestamp', isNullable: true },
          { name: 'updated_at', type: 'timestamp', isNullable: false, default: 'CURRENT_TIMESTAMP' },
        ],
      }),
      true,
    );
    await queryRunner.createForeignKey(
      'client_isolation_snapshots',
      new TableForeignKey({
        columnNames: ['client_id'],
        referencedTableName: 'clients',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('client_isolation_snapshots', true, true);
  }
}
