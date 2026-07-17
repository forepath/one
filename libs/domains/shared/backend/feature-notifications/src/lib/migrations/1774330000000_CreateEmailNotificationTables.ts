import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateEmailNotificationTables1774330000000 implements MigrationInterface {
  name = 'CreateEmailNotificationTables1774330000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'email_deliveries',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'event_id', type: 'uuid' },
          { name: 'event_type', type: 'varchar', length: '128' },
          { name: 'scope_key', type: 'varchar', length: '64' },
          { name: 'template_key', type: 'varchar', length: '128' },
          { name: 'recipient', type: 'text' },
          { name: 'template_context', type: 'text', isNullable: true },
          { name: 'success', type: 'boolean' },
          { name: 'attempt', type: 'int' },
          { name: 'error_message', type: 'text', isNullable: true },
          { name: 'created_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'email_deliveries',
      new TableIndex({
        name: 'idx_email_deliveries_scope_created_at',
        columnNames: ['scope_key', 'created_at'],
      }),
    );

    await queryRunner.createIndex(
      'email_deliveries',
      new TableIndex({
        name: 'idx_email_deliveries_event_id',
        columnNames: ['event_id'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('email_deliveries', true);
  }
}
