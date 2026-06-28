import { MigrationInterface, QueryRunner, Table, TableColumn, TableForeignKey, TableIndex } from 'typeorm';

export class CreateProjectTables1773000000000 implements MigrationInterface {
  name = 'CreateProjectTables1773000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "project_status_enum" AS ENUM ('active', 'archived');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "project_ticket_status_enum" AS ENUM ('draft', 'todo', 'in_progress', 'prototype', 'done', 'closed');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "project_ticket_priority_enum" AS ENUM ('low', 'medium', 'high', 'critical');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "project_ticket_actor_type_enum" AS ENUM ('human', 'ai', 'system');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.createTable(
      new Table({
        name: 'billing_projects',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'user_id', type: 'uuid' },
          { name: 'name', type: 'varchar', length: '255' },
          { name: 'description', type: 'text', isNullable: true },
          {
            name: 'status',
            type: 'enum',
            enumName: 'project_status_enum',
            default: "'active'",
          },
          { name: 'hourly_rate_net', type: 'numeric', precision: 12, scale: 4 },
          { name: 'currency', type: 'varchar', length: '10', default: "'EUR'" },
          { name: 'created_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
          { name: 'updated_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
        ],
        indices: [new TableIndex({ name: 'IDX_billing_projects_user_id', columnNames: ['user_id'] })],
      }),
      true,
    );

    await queryRunner.createTable(
      new Table({
        name: 'billing_project_milestones',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'project_id', type: 'uuid' },
          { name: 'name', type: 'varchar', length: '255' },
          { name: 'description', type: 'text', isNullable: true },
          { name: 'target_date', type: 'date', isNullable: true },
          { name: 'sort_order', type: 'int', default: 0 },
          { name: 'locked_at', type: 'timestamp', isNullable: true },
          { name: 'created_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
          { name: 'updated_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
        ],
        foreignKeys: [
          {
            columnNames: ['project_id'],
            referencedTableName: 'billing_projects',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
        ],
        indices: [new TableIndex({ name: 'IDX_billing_project_milestones_project_id', columnNames: ['project_id'] })],
      }),
      true,
    );

    await queryRunner.createTable(
      new Table({
        name: 'billing_project_tickets',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'project_id', type: 'uuid' },
          { name: 'milestone_id', type: 'uuid', isNullable: true },
          { name: 'parent_id', type: 'uuid', isNullable: true },
          { name: 'title', type: 'varchar', length: '500' },
          { name: 'content', type: 'text', isNullable: true },
          { name: 'long_sha', type: 'varchar', length: '40', isNullable: true },
          {
            name: 'priority',
            type: 'enum',
            enumName: 'project_ticket_priority_enum',
            default: "'medium'",
          },
          {
            name: 'status',
            type: 'enum',
            enumName: 'project_ticket_status_enum',
            default: "'draft'",
          },
          { name: 'locked', type: 'boolean', default: false },
          { name: 'created_by_user_id', type: 'uuid', isNullable: true },
          { name: 'created_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
          { name: 'updated_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
        ],
        foreignKeys: [
          {
            columnNames: ['project_id'],
            referencedTableName: 'billing_projects',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
          {
            columnNames: ['milestone_id'],
            referencedTableName: 'billing_project_milestones',
            referencedColumnNames: ['id'],
            onDelete: 'SET NULL',
          },
          {
            columnNames: ['parent_id'],
            referencedTableName: 'billing_project_tickets',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
        ],
        indices: [
          new TableIndex({ name: 'IDX_billing_project_tickets_project_id', columnNames: ['project_id'] }),
          new TableIndex({ name: 'IDX_billing_project_tickets_milestone_id', columnNames: ['milestone_id'] }),
          new TableIndex({ name: 'IDX_billing_project_tickets_parent_id', columnNames: ['parent_id'] }),
        ],
      }),
      true,
    );

    await queryRunner.createTable(
      new Table({
        name: 'billing_project_ticket_comments',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'ticket_id', type: 'uuid' },
          { name: 'user_id', type: 'uuid' },
          { name: 'body', type: 'text' },
          { name: 'created_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
        ],
        foreignKeys: [
          {
            columnNames: ['ticket_id'],
            referencedTableName: 'billing_project_tickets',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
        ],
        indices: [
          new TableIndex({ name: 'IDX_billing_project_ticket_comments_ticket_id', columnNames: ['ticket_id'] }),
        ],
      }),
      true,
    );

    await queryRunner.createTable(
      new Table({
        name: 'billing_project_ticket_activities',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'ticket_id', type: 'uuid' },
          { name: 'occurred_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
          {
            name: 'actor_type',
            type: 'enum',
            enumName: 'project_ticket_actor_type_enum',
            default: "'human'",
          },
          { name: 'actor_user_id', type: 'uuid', isNullable: true },
          { name: 'action_type', type: 'varchar', length: '64' },
          { name: 'payload', type: 'jsonb', default: "'{}'::jsonb" },
        ],
        foreignKeys: [
          {
            columnNames: ['ticket_id'],
            referencedTableName: 'billing_project_tickets',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
        ],
        indices: [
          new TableIndex({ name: 'IDX_billing_project_ticket_activities_ticket_id', columnNames: ['ticket_id'] }),
        ],
      }),
      true,
    );

    await queryRunner.createTable(
      new Table({
        name: 'billing_project_time_entries',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'project_id', type: 'uuid' },
          { name: 'ticket_id', type: 'uuid', isNullable: true },
          { name: 'recorded_by_user_id', type: 'uuid' },
          { name: 'duration_minutes', type: 'int' },
          { name: 'description', type: 'varchar', length: '500', isNullable: true },
          { name: 'recorded_at', type: 'timestamp' },
          { name: 'invoice_id', type: 'uuid', isNullable: true },
          { name: 'billed_at', type: 'timestamp', isNullable: true },
          { name: 'created_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
        ],
        foreignKeys: [
          {
            columnNames: ['project_id'],
            referencedTableName: 'billing_projects',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
          {
            columnNames: ['ticket_id'],
            referencedTableName: 'billing_project_tickets',
            referencedColumnNames: ['id'],
            onDelete: 'SET NULL',
          },
          {
            columnNames: ['invoice_id'],
            referencedTableName: 'billing_invoices',
            referencedColumnNames: ['id'],
            onDelete: 'SET NULL',
          },
        ],
        indices: [
          new TableIndex({ name: 'IDX_billing_project_time_entries_project_id', columnNames: ['project_id'] }),
          new TableIndex({ name: 'IDX_billing_project_time_entries_invoice_id', columnNames: ['invoice_id'] }),
        ],
      }),
      true,
    );

    const invoicesTable = await queryRunner.getTable('billing_invoices');

    if (invoicesTable && !invoicesTable.findColumnByName('project_id')) {
      await queryRunner.addColumn(
        'billing_invoices',
        new TableColumn({ name: 'project_id', type: 'uuid', isNullable: true }),
      );
      await queryRunner.createForeignKey(
        'billing_invoices',
        new TableForeignKey({
          columnNames: ['project_id'],
          referencedTableName: 'billing_projects',
          referencedColumnNames: ['id'],
          onDelete: 'SET NULL',
        }),
      );
      await queryRunner.createIndex(
        'billing_invoices',
        new TableIndex({ name: 'IDX_billing_invoices_project_id', columnNames: ['project_id'] }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const invoicesTable = await queryRunner.getTable('billing_invoices');

    if (invoicesTable?.findColumnByName('project_id')) {
      const fk = invoicesTable.foreignKeys.find((f) => f.columnNames.includes('project_id'));

      if (fk) {
        await queryRunner.dropForeignKey('billing_invoices', fk);
      }

      await queryRunner.dropIndex('billing_invoices', 'IDX_billing_invoices_project_id');
      await queryRunner.dropColumn('billing_invoices', 'project_id');
    }

    await queryRunner.dropTable('billing_project_time_entries');
    await queryRunner.dropTable('billing_project_ticket_activities');
    await queryRunner.dropTable('billing_project_ticket_comments');
    await queryRunner.dropTable('billing_project_tickets');
    await queryRunner.dropTable('billing_project_milestones');
    await queryRunner.dropTable('billing_projects');

    await queryRunner.query(`DROP TYPE IF EXISTS "project_ticket_actor_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "project_ticket_priority_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "project_ticket_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "project_status_enum"`);
  }
}
