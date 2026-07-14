import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex } from 'typeorm';

export class CreateWebhookNotificationTables1774300000000 implements MigrationInterface {
  name = 'CreateWebhookNotificationTables1774300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "webhook_http_method_enum" AS ENUM ('POST', 'GET');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "webhook_auth_type_enum" AS ENUM ('none', 'authorization', 'custom_header', 'query_param');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.createTable(
      new Table({
        name: 'webhook_endpoints',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'scope_key', type: 'varchar', length: '64' },
          { name: 'client_id', type: 'uuid', isNullable: true },
          { name: 'name', type: 'varchar', length: '255' },
          { name: 'url', type: 'text' },
          { name: 'http_method', type: 'enum', enumName: 'webhook_http_method_enum', default: "'POST'" },
          { name: 'subscribed_events', type: 'jsonb', default: "'[]'::jsonb" },
          { name: 'enabled', type: 'boolean', default: true },
          { name: 'auth_type', type: 'enum', enumName: 'webhook_auth_type_enum', default: "'none'" },
          { name: 'auth_header_name', type: 'varchar', length: '255', isNullable: true },
          { name: 'auth_value', type: 'text', isNullable: true },
          { name: 'signing_secret', type: 'text' },
          { name: 'consecutive_failures', type: 'int', default: 0 },
          { name: 'disabled_reason', type: 'text', isNullable: true },
          { name: 'created_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
          { name: 'updated_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'webhook_endpoints',
      new TableIndex({
        name: 'uq_webhook_endpoints_scope_name',
        columnNames: ['scope_key', 'name'],
        isUnique: true,
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'webhook_deliveries',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'endpoint_id', type: 'uuid' },
          { name: 'event_id', type: 'uuid' },
          { name: 'event_type', type: 'varchar', length: '128' },
          { name: 'payload', type: 'jsonb', default: "'{}'::jsonb" },
          { name: 'http_status', type: 'int', isNullable: true },
          { name: 'response_body', type: 'text', isNullable: true },
          { name: 'success', type: 'boolean' },
          { name: 'attempt', type: 'int' },
          { name: 'error_message', type: 'text', isNullable: true },
          { name: 'created_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
        ],
      }),
      true,
    );

    await queryRunner.createForeignKey(
      'webhook_deliveries',
      new TableForeignKey({
        name: 'fk_webhook_deliveries_endpoint_id',
        columnNames: ['endpoint_id'],
        referencedTableName: 'webhook_endpoints',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createIndex(
      'webhook_deliveries',
      new TableIndex({
        name: 'idx_webhook_deliveries_endpoint_created_at',
        columnNames: ['endpoint_id', 'created_at'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('webhook_deliveries', true);
    await queryRunner.dropTable('webhook_endpoints', true);
    await queryRunner.query('DROP TYPE IF EXISTS "webhook_auth_type_enum"');
    await queryRunner.query('DROP TYPE IF EXISTS "webhook_http_method_enum"');
  }
}
