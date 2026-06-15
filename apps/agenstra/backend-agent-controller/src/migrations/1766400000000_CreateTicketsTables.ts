import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex } from 'typeorm';

/**
 * Creates tickets, comments, activity log, and AI body generation session tables.
 */
export class CreateTicketsTables1766400000000 implements MigrationInterface {
  name = 'CreateTicketsTables1766400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "ticket_priority_enum" AS ENUM ('low', 'medium', 'high', 'critical');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "ticket_status_enum" AS ENUM ('draft', 'todo', 'prototype', 'done');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "ticket_actor_type_enum" AS ENUM ('human', 'ai', 'system');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.createTable(
      new Table({
        name: 'tickets',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'client_id', type: 'uuid', isNullable: false },
          { name: 'parent_id', type: 'uuid', isNullable: true },
          { name: 'title', type: 'varchar', length: '500', isNullable: false },
          { name: 'content', type: 'text', isNullable: true },
          {
            name: 'priority',
            type: 'enum',
            enum: ['low', 'medium', 'high', 'critical'],
            enumName: 'ticket_priority_enum',
            isNullable: false,
          },
          {
            name: 'status',
            type: 'enum',
            enum: ['draft', 'todo', 'prototype', 'done'],
            enumName: 'ticket_status_enum',
            isNullable: false,
          },
          { name: 'created_by_user_id', type: 'uuid', isNullable: true },
          { name: 'created_at', type: 'timestamptz', default: 'CURRENT_TIMESTAMP', isNullable: false },
          { name: 'updated_at', type: 'timestamptz', default: 'CURRENT_TIMESTAMP', isNullable: false },
        ],
      }),
      true,
    );

    await queryRunner.createForeignKey(
      'tickets',
      new TableForeignKey({
        columnNames: ['client_id'],
        referencedTableName: 'clients',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
    await queryRunner.createForeignKey(
      'tickets',
      new TableForeignKey({
        columnNames: ['parent_id'],
        referencedTableName: 'tickets',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
    await queryRunner.createForeignKey(
      'tickets',
      new TableForeignKey({
        columnNames: ['created_by_user_id'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
      }),
    );

    await queryRunner.createIndex(
      'tickets',
      new TableIndex({ name: 'IDX_tickets_client_id', columnNames: ['client_id'] }),
    );
    await queryRunner.createIndex(
      'tickets',
      new TableIndex({ name: 'IDX_tickets_parent_id', columnNames: ['parent_id'] }),
    );
    await queryRunner.createIndex('tickets', new TableIndex({ name: 'IDX_tickets_status', columnNames: ['status'] }));

    await queryRunner.createTable(
      new Table({
        name: 'ticket_comments',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'ticket_id', type: 'uuid', isNullable: false },
          { name: 'author_user_id', type: 'uuid', isNullable: true },
          { name: 'body', type: 'text', isNullable: false },
          { name: 'created_at', type: 'timestamptz', default: 'CURRENT_TIMESTAMP', isNullable: false },
        ],
      }),
      true,
    );

    await queryRunner.createForeignKey(
      'ticket_comments',
      new TableForeignKey({
        columnNames: ['ticket_id'],
        referencedTableName: 'tickets',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
    await queryRunner.createForeignKey(
      'ticket_comments',
      new TableForeignKey({
        columnNames: ['author_user_id'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
      }),
    );
    await queryRunner.createIndex(
      'ticket_comments',
      new TableIndex({ name: 'IDX_ticket_comments_ticket_id', columnNames: ['ticket_id'] }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'ticket_activity',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'ticket_id', type: 'uuid', isNullable: false },
          { name: 'occurred_at', type: 'timestamptz', default: 'CURRENT_TIMESTAMP', isNullable: false },
          {
            name: 'actor_type',
            type: 'enum',
            enum: ['human', 'ai', 'system'],
            enumName: 'ticket_actor_type_enum',
            isNullable: false,
          },
          { name: 'actor_user_id', type: 'uuid', isNullable: true },
          { name: 'action_type', type: 'varchar', length: '64', isNullable: false },
          { name: 'payload', type: 'jsonb', isNullable: false },
        ],
      }),
      true,
    );

    await queryRunner.createForeignKey(
      'ticket_activity',
      new TableForeignKey({
        columnNames: ['ticket_id'],
        referencedTableName: 'tickets',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
    await queryRunner.createForeignKey(
      'ticket_activity',
      new TableForeignKey({
        columnNames: ['actor_user_id'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
      }),
    );
    await queryRunner.createIndex(
      'ticket_activity',
      new TableIndex({
        name: 'IDX_ticket_activity_ticket_occurred',
        columnNames: ['ticket_id', 'occurred_at'],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'ticket_body_generation_sessions',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'ticket_id', type: 'uuid', isNullable: false },
          { name: 'user_id', type: 'uuid', isNullable: true },
          { name: 'agent_id', type: 'uuid', isNullable: true },
          { name: 'expires_at', type: 'timestamptz', isNullable: false },
          { name: 'consumed_at', type: 'timestamptz', isNullable: true },
          { name: 'created_at', type: 'timestamptz', default: 'CURRENT_TIMESTAMP', isNullable: false },
        ],
      }),
      true,
    );

    await queryRunner.createForeignKey(
      'ticket_body_generation_sessions',
      new TableForeignKey({
        columnNames: ['ticket_id'],
        referencedTableName: 'tickets',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
    await queryRunner.createForeignKey(
      'ticket_body_generation_sessions',
      new TableForeignKey({
        columnNames: ['user_id'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
    await queryRunner.createIndex(
      'ticket_body_generation_sessions',
      new TableIndex({ name: 'IDX_ticket_body_gen_ticket_id', columnNames: ['ticket_id'] }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('ticket_body_generation_sessions', true);
    await queryRunner.dropTable('ticket_activity', true);
    await queryRunner.dropTable('ticket_comments', true);
    await queryRunner.dropTable('tickets', true);
    await queryRunner.query(`DROP TYPE IF EXISTS "ticket_actor_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "ticket_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "ticket_priority_enum"`);
  }
}
