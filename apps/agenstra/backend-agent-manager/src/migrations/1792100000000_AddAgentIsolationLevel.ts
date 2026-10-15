import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Container isolation levels.
 * - `isolation_level`: Docker runtime class of the worker container (`standard` = runc,
 *   `sandboxed` = gVisor). Existing environments keep running exactly as before (`standard`).
 * - `isolation_selection`: audit record of how the level was selected (recommendation, user override,
 *   capability revision).
 */
export class AddAgentIsolationLevel1792100000000 implements MigrationInterface {
  name = 'AddAgentIsolationLevel1792100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumns('agents', [
      new TableColumn({
        name: 'isolation_level',
        type: 'varchar',
        length: '16',
        isNullable: false,
        default: "'standard'",
      }),
      new TableColumn({ name: 'isolation_selection', type: 'jsonb', isNullable: true }),
    ]);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('agents', 'isolation_selection');
    await queryRunner.dropColumn('agents', 'isolation_level');
  }
}
