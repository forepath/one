import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex } from 'typeorm';

/**
 * Migration to create statistics shadow tables and event tables.
 * Shadow tables store references to original entities without secrets.
 * Event tables record chat I/O, filter drops, and entity lifecycle events.
 */
export class CreateStatisticsTables1766000000000 implements MigrationInterface {
  name = 'CreateStatisticsTables1766000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create statistics_users
    await queryRunner.createTable(
      new Table({
        name: 'statistics_users',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'original_user_id', type: 'uuid', isNullable: true },
          { name: 'role', type: 'varchar', length: '50', isNullable: false, default: "'user'" },
          { name: 'created_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP', isNullable: false },
          { name: 'updated_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP', isNullable: false },
        ],
      }),
      true,
    );
    await queryRunner.createIndex(
      'statistics_users',
      new TableIndex({
        name: 'IDX_statistics_users_original_user_id',
        columnNames: ['original_user_id'],
        isUnique: true,
      }),
    );

    // Create statistics_clients
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "statistics_authentication_type_enum" AS ENUM ('api_key', 'keycloak');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    await queryRunner.createTable(
      new Table({
        name: 'statistics_clients',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'original_client_id', type: 'uuid', isNullable: false },
          { name: 'name', type: 'varchar', length: '255', isNullable: false },
          { name: 'endpoint', type: 'varchar', length: '255', isNullable: false },
          {
            name: 'authentication_type',
            type: 'enum',
            enum: ['api_key', 'keycloak'],
            enumName: 'statistics_authentication_type_enum',
            isNullable: false,
          },
          { name: 'created_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP', isNullable: false },
          { name: 'updated_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP', isNullable: false },
        ],
      }),
      true,
    );
    await queryRunner.createIndex(
      'statistics_clients',
      new TableIndex({
        name: 'IDX_statistics_clients_original_client_id',
        columnNames: ['original_client_id'],
        isUnique: true,
      }),
    );

    // Create statistics_agents
    await queryRunner.createTable(
      new Table({
        name: 'statistics_agents',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'original_agent_id', type: 'uuid', isNullable: false },
          { name: 'statistics_client_id', type: 'uuid', isNullable: false },
          { name: 'agent_type', type: 'varchar', length: '50', isNullable: false, default: "'cursor'" },
          { name: 'container_type', type: 'varchar', length: '50', isNullable: false, default: "'generic'" },
          { name: 'name', type: 'varchar', length: '255', isNullable: true },
          { name: 'description', type: 'text', isNullable: true },
          { name: 'created_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP', isNullable: false },
          { name: 'updated_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP', isNullable: false },
        ],
      }),
      true,
    );
    await queryRunner.createIndex(
      'statistics_agents',
      new TableIndex({
        name: 'IDX_statistics_agents_original_agent_id',
        columnNames: ['original_agent_id'],
        isUnique: true,
      }),
    );
    await queryRunner.createIndex(
      'statistics_agents',
      new TableIndex({
        name: 'IDX_statistics_agents_statistics_client_id',
        columnNames: ['statistics_client_id'],
      }),
    );
    await queryRunner.createForeignKey(
      'statistics_agents',
      new TableForeignKey({
        columnNames: ['statistics_client_id'],
        referencedTableName: 'statistics_clients',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
        name: 'FK_statistics_agents_statistics_client_id',
      }),
    );

    // Create statistics_provisioning_references
    await queryRunner.createTable(
      new Table({
        name: 'statistics_provisioning_references',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'original_provisioning_reference_id', type: 'uuid', isNullable: false },
          { name: 'statistics_client_id', type: 'uuid', isNullable: false },
          { name: 'provider_type', type: 'varchar', length: '50', isNullable: false },
          { name: 'server_id', type: 'varchar', length: '255', isNullable: false },
          { name: 'server_name', type: 'varchar', length: '255', isNullable: true },
          { name: 'public_ip', type: 'varchar', length: '45', isNullable: true },
          { name: 'private_ip', type: 'varchar', length: '45', isNullable: true },
          { name: 'provider_metadata', type: 'text', isNullable: true },
          { name: 'created_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP', isNullable: false },
          { name: 'updated_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP', isNullable: false },
        ],
      }),
      true,
    );
    await queryRunner.createIndex(
      'statistics_provisioning_references',
      new TableIndex({
        name: 'IDX_statistics_provisioning_refs_original_id',
        columnNames: ['original_provisioning_reference_id'],
        isUnique: true,
      }),
    );
    await queryRunner.createIndex(
      'statistics_provisioning_references',
      new TableIndex({
        name: 'IDX_statistics_provisioning_refs_statistics_client_id',
        columnNames: ['statistics_client_id'],
      }),
    );
    await queryRunner.createForeignKey(
      'statistics_provisioning_references',
      new TableForeignKey({
        columnNames: ['statistics_client_id'],
        referencedTableName: 'statistics_clients',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
        name: 'FK_statistics_provisioning_refs_statistics_client_id',
      }),
    );

    // Create statistics_client_users
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "statistics_client_user_role_enum" AS ENUM ('admin', 'user');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    await queryRunner.createTable(
      new Table({
        name: 'statistics_client_users',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'original_client_user_id', type: 'uuid', isNullable: false },
          { name: 'statistics_client_id', type: 'uuid', isNullable: false },
          { name: 'statistics_user_id', type: 'uuid', isNullable: false },
          {
            name: 'role',
            type: 'enum',
            enum: ['admin', 'user'],
            enumName: 'statistics_client_user_role_enum',
            isNullable: false,
            default: "'user'",
          },
          { name: 'created_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP', isNullable: false },
          { name: 'updated_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP', isNullable: false },
        ],
      }),
      true,
    );
    await queryRunner.createIndex(
      'statistics_client_users',
      new TableIndex({
        name: 'IDX_statistics_client_users_original_id',
        columnNames: ['original_client_user_id'],
        isUnique: true,
      }),
    );
    await queryRunner.createIndex(
      'statistics_client_users',
      new TableIndex({
        name: 'IDX_statistics_client_users_statistics_client_id',
        columnNames: ['statistics_client_id'],
      }),
    );
    await queryRunner.createForeignKey(
      'statistics_client_users',
      new TableForeignKey({
        columnNames: ['statistics_client_id'],
        referencedTableName: 'statistics_clients',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
        name: 'FK_statistics_client_users_statistics_client_id',
      }),
    );
    await queryRunner.createForeignKey(
      'statistics_client_users',
      new TableForeignKey({
        columnNames: ['statistics_user_id'],
        referencedTableName: 'statistics_users',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
        name: 'FK_statistics_client_users_statistics_user_id',
      }),
    );

    // Create statistics_chat_io
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "statistics_chat_direction_enum" AS ENUM ('input', 'output');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    await queryRunner.createTable(
      new Table({
        name: 'statistics_chat_io',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'statistics_agent_id', type: 'uuid', isNullable: true },
          { name: 'statistics_client_id', type: 'uuid', isNullable: false },
          { name: 'statistics_user_id', type: 'uuid', isNullable: true },
          {
            name: 'direction',
            type: 'enum',
            enum: ['input', 'output'],
            enumName: 'statistics_chat_direction_enum',
            isNullable: false,
          },
          { name: 'word_count', type: 'int', isNullable: false },
          { name: 'char_count', type: 'int', isNullable: false },
          { name: 'occurred_at', type: 'timestamp', isNullable: false },
        ],
      }),
      true,
    );
    await queryRunner.createIndex(
      'statistics_chat_io',
      new TableIndex({
        name: 'IDX_statistics_chat_io_statistics_agent_id_occurred_at',
        columnNames: ['statistics_agent_id', 'occurred_at'],
      }),
    );
    await queryRunner.createIndex(
      'statistics_chat_io',
      new TableIndex({
        name: 'IDX_statistics_chat_io_statistics_client_id_occurred_at',
        columnNames: ['statistics_client_id', 'occurred_at'],
      }),
    );
    await queryRunner.createForeignKey(
      'statistics_chat_io',
      new TableForeignKey({
        columnNames: ['statistics_agent_id'],
        referencedTableName: 'statistics_agents',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
        name: 'FK_statistics_chat_io_statistics_agent_id',
      }),
    );
    await queryRunner.createForeignKey(
      'statistics_chat_io',
      new TableForeignKey({
        columnNames: ['statistics_client_id'],
        referencedTableName: 'statistics_clients',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
        name: 'FK_statistics_chat_io_statistics_client_id',
      }),
    );
    await queryRunner.createForeignKey(
      'statistics_chat_io',
      new TableForeignKey({
        columnNames: ['statistics_user_id'],
        referencedTableName: 'statistics_users',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
        name: 'FK_statistics_chat_io_statistics_user_id',
      }),
    );

    // Create statistics_chat_filter_drops
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "statistics_filter_drop_direction_enum" AS ENUM ('incoming', 'outgoing');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    await queryRunner.createTable(
      new Table({
        name: 'statistics_chat_filter_drops',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'statistics_agent_id', type: 'uuid', isNullable: true },
          { name: 'statistics_client_id', type: 'uuid', isNullable: false },
          { name: 'statistics_user_id', type: 'uuid', isNullable: true },
          { name: 'filter_type', type: 'varchar', length: '100', isNullable: false },
          { name: 'filter_display_name', type: 'varchar', length: '255', isNullable: false },
          { name: 'filter_reason', type: 'text', isNullable: true },
          {
            name: 'direction',
            type: 'enum',
            enum: ['incoming', 'outgoing'],
            enumName: 'statistics_filter_drop_direction_enum',
            isNullable: false,
          },
          { name: 'word_count', type: 'int', isNullable: false, default: 0 },
          { name: 'char_count', type: 'int', isNullable: false, default: 0 },
          { name: 'occurred_at', type: 'timestamp', isNullable: false },
        ],
      }),
      true,
    );
    await queryRunner.createIndex(
      'statistics_chat_filter_drops',
      new TableIndex({
        name: 'IDX_statistics_chat_filter_drops_statistics_agent_id_occurred_at',
        columnNames: ['statistics_agent_id', 'occurred_at'],
      }),
    );
    await queryRunner.createIndex(
      'statistics_chat_filter_drops',
      new TableIndex({
        name: 'IDX_statistics_chat_filter_drops_filter_type_occurred_at',
        columnNames: ['filter_type', 'occurred_at'],
      }),
    );
    await queryRunner.createForeignKey(
      'statistics_chat_filter_drops',
      new TableForeignKey({
        columnNames: ['statistics_agent_id'],
        referencedTableName: 'statistics_agents',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
        name: 'FK_statistics_chat_filter_drops_statistics_agent_id',
      }),
    );
    await queryRunner.createForeignKey(
      'statistics_chat_filter_drops',
      new TableForeignKey({
        columnNames: ['statistics_client_id'],
        referencedTableName: 'statistics_clients',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
        name: 'FK_statistics_chat_filter_drops_statistics_client_id',
      }),
    );
    await queryRunner.createForeignKey(
      'statistics_chat_filter_drops',
      new TableForeignKey({
        columnNames: ['statistics_user_id'],
        referencedTableName: 'statistics_users',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
        name: 'FK_statistics_chat_filter_drops_statistics_user_id',
      }),
    );

    // Create statistics_entity_events
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "statistics_entity_event_type_enum" AS ENUM ('created', 'deleted');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "statistics_entity_type_enum" AS ENUM ('user', 'client', 'agent', 'client_user', 'provisioning_reference');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    await queryRunner.createTable(
      new Table({
        name: 'statistics_entity_events',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          {
            name: 'event_type',
            type: 'enum',
            enum: ['created', 'deleted'],
            enumName: 'statistics_entity_event_type_enum',
            isNullable: false,
          },
          {
            name: 'entity_type',
            type: 'enum',
            enum: ['user', 'client', 'agent', 'client_user', 'provisioning_reference'],
            enumName: 'statistics_entity_type_enum',
            isNullable: false,
          },
          { name: 'original_entity_id', type: 'uuid', isNullable: false },
          { name: 'statistics_user_id', type: 'uuid', isNullable: true },
          { name: 'statistics_users_id', type: 'uuid', isNullable: true },
          { name: 'statistics_clients_id', type: 'uuid', isNullable: true },
          { name: 'statistics_agents_id', type: 'uuid', isNullable: true },
          { name: 'statistics_client_users_id', type: 'uuid', isNullable: true },
          { name: 'statistics_provisioning_references_id', type: 'uuid', isNullable: true },
          { name: 'occurred_at', type: 'timestamp', isNullable: false },
        ],
      }),
      true,
    );
    await queryRunner.createIndex(
      'statistics_entity_events',
      new TableIndex({
        name: 'IDX_statistics_entity_events_entity_type_occurred_at',
        columnNames: ['entity_type', 'occurred_at'],
      }),
    );
    await queryRunner.createIndex(
      'statistics_entity_events',
      new TableIndex({
        name: 'IDX_statistics_entity_events_original_entity_id',
        columnNames: ['original_entity_id'],
      }),
    );
    await queryRunner.createForeignKey(
      'statistics_entity_events',
      new TableForeignKey({
        columnNames: ['statistics_user_id'],
        referencedTableName: 'statistics_users',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
        name: 'FK_statistics_entity_events_statistics_user_id',
      }),
    );
    await queryRunner.createForeignKey(
      'statistics_entity_events',
      new TableForeignKey({
        columnNames: ['statistics_users_id'],
        referencedTableName: 'statistics_users',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
        name: 'FK_statistics_entity_events_statistics_users_id',
      }),
    );
    await queryRunner.createForeignKey(
      'statistics_entity_events',
      new TableForeignKey({
        columnNames: ['statistics_clients_id'],
        referencedTableName: 'statistics_clients',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
        name: 'FK_statistics_entity_events_statistics_clients_id',
      }),
    );
    await queryRunner.createForeignKey(
      'statistics_entity_events',
      new TableForeignKey({
        columnNames: ['statistics_agents_id'],
        referencedTableName: 'statistics_agents',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
        name: 'FK_statistics_entity_events_statistics_agents_id',
      }),
    );
    await queryRunner.createForeignKey(
      'statistics_entity_events',
      new TableForeignKey({
        columnNames: ['statistics_client_users_id'],
        referencedTableName: 'statistics_client_users',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
        name: 'FK_statistics_entity_events_statistics_client_users_id',
      }),
    );
    await queryRunner.createForeignKey(
      'statistics_entity_events',
      new TableForeignKey({
        columnNames: ['statistics_provisioning_references_id'],
        referencedTableName: 'statistics_provisioning_references',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
        name: 'FK_statistics_entity_events_statistics_provisioning_refs_id',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop statistics_entity_events (and its FKs)
    const entityEventsTable = await queryRunner.getTable('statistics_entity_events');

    if (entityEventsTable) {
      for (const fk of entityEventsTable.foreignKeys) {
        await queryRunner.dropForeignKey('statistics_entity_events', fk);
      }

      await queryRunner.dropIndex('statistics_entity_events', 'IDX_statistics_entity_events_original_entity_id');
      await queryRunner.dropIndex('statistics_entity_events', 'IDX_statistics_entity_events_entity_type_occurred_at');
      await queryRunner.dropTable('statistics_entity_events');
      await queryRunner.query('DROP TYPE IF EXISTS "statistics_entity_type_enum"');
      await queryRunner.query('DROP TYPE IF EXISTS "statistics_entity_event_type_enum"');
    }

    // Drop statistics_chat_filter_drops
    const filterDropsTable = await queryRunner.getTable('statistics_chat_filter_drops');

    if (filterDropsTable) {
      for (const fk of filterDropsTable.foreignKeys) {
        await queryRunner.dropForeignKey('statistics_chat_filter_drops', fk);
      }

      await queryRunner.dropIndex(
        'statistics_chat_filter_drops',
        'IDX_statistics_chat_filter_drops_filter_type_occurred_at',
      );
      await queryRunner.dropIndex(
        'statistics_chat_filter_drops',
        'IDX_statistics_chat_filter_drops_statistics_agent_id_occurred_at',
      );
      await queryRunner.dropTable('statistics_chat_filter_drops');
      await queryRunner.query('DROP TYPE IF EXISTS "statistics_filter_drop_direction_enum"');
    }

    // Drop statistics_chat_io
    const chatIoTable = await queryRunner.getTable('statistics_chat_io');

    if (chatIoTable) {
      for (const fk of chatIoTable.foreignKeys) {
        await queryRunner.dropForeignKey('statistics_chat_io', fk);
      }

      await queryRunner.dropIndex('statistics_chat_io', 'IDX_statistics_chat_io_statistics_client_id_occurred_at');
      await queryRunner.dropIndex('statistics_chat_io', 'IDX_statistics_chat_io_statistics_agent_id_occurred_at');
      await queryRunner.dropTable('statistics_chat_io');
      await queryRunner.query('DROP TYPE IF EXISTS "statistics_chat_direction_enum"');
    }

    // Drop statistics_client_users
    const clientUsersTable = await queryRunner.getTable('statistics_client_users');

    if (clientUsersTable) {
      for (const fk of clientUsersTable.foreignKeys) {
        await queryRunner.dropForeignKey('statistics_client_users', fk);
      }

      await queryRunner.dropIndex('statistics_client_users', 'IDX_statistics_client_users_statistics_client_id');
      await queryRunner.dropIndex('statistics_client_users', 'IDX_statistics_client_users_original_id');
      await queryRunner.dropTable('statistics_client_users');
      await queryRunner.query('DROP TYPE IF EXISTS "statistics_client_user_role_enum"');
    }

    // Drop statistics_provisioning_references
    const provRefsTable = await queryRunner.getTable('statistics_provisioning_references');

    if (provRefsTable) {
      for (const fk of provRefsTable.foreignKeys) {
        await queryRunner.dropForeignKey('statistics_provisioning_references', fk);
      }

      await queryRunner.dropIndex(
        'statistics_provisioning_references',
        'IDX_statistics_provisioning_refs_statistics_client_id',
      );
      await queryRunner.dropIndex('statistics_provisioning_references', 'IDX_statistics_provisioning_refs_original_id');
      await queryRunner.dropTable('statistics_provisioning_references');
    }

    // Drop statistics_agents
    const agentsTable = await queryRunner.getTable('statistics_agents');

    if (agentsTable) {
      for (const fk of agentsTable.foreignKeys) {
        await queryRunner.dropForeignKey('statistics_agents', fk);
      }

      await queryRunner.dropIndex('statistics_agents', 'IDX_statistics_agents_statistics_client_id');
      await queryRunner.dropIndex('statistics_agents', 'IDX_statistics_agents_original_agent_id');
      await queryRunner.dropTable('statistics_agents');
    }

    // Drop statistics_clients
    await queryRunner.dropTable('statistics_clients');
    await queryRunner.query('DROP TYPE IF EXISTS "statistics_authentication_type_enum"');

    // Drop statistics_users
    await queryRunner.dropIndex('statistics_users', 'IDX_statistics_users_original_user_id');
    await queryRunner.dropTable('statistics_users');
  }
}
