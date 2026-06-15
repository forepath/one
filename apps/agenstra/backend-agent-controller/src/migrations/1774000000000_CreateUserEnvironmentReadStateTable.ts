import { MigrationInterface, QueryRunner, Table, TableIndex, TableUnique } from 'typeorm';

/**
 * Per-user read cursors for agent console environment chat notifications.
 */
export class CreateUserEnvironmentReadStateTable1774000000000 implements MigrationInterface {
  name = 'CreateUserEnvironmentReadStateTable1774000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'user_environment_read_state',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'user_id',
            type: 'varchar',
            length: '64',
            isNullable: false,
          },
          {
            name: 'client_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'agent_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'last_read_at',
            type: 'timestamptz',
            isNullable: true,
          },
          {
            name: 'last_read_agent_message_id',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'created_at',
            type: 'timestamptz',
            default: 'CURRENT_TIMESTAMP',
            isNullable: false,
          },
          {
            name: 'updated_at',
            type: 'timestamptz',
            default: 'CURRENT_TIMESTAMP',
            isNullable: false,
          },
        ],
      }),
      true,
    );

    await queryRunner.createUniqueConstraint(
      'user_environment_read_state',
      new TableUnique({
        name: 'uq_user_environment_read_state_user_client_agent',
        columnNames: ['user_id', 'client_id', 'agent_id'],
      }),
    );

    await queryRunner.createIndex(
      'user_environment_read_state',
      new TableIndex({
        name: 'IDX_user_environment_read_state_user_id',
        columnNames: ['user_id'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('user_environment_read_state', 'IDX_user_environment_read_state_user_id');
    await queryRunner.dropUniqueConstraint(
      'user_environment_read_state',
      'uq_user_environment_read_state_user_client_agent',
    );
    await queryRunner.dropTable('user_environment_read_state');
  }
}
