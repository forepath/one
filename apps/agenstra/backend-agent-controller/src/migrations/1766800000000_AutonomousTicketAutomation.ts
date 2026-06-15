import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex } from 'typeorm';

/**
 * Client/agent autonomy, ticket automation config, leases, runs, and run steps for autonomous prototyping.
 */
export class AutonomousTicketAutomation1766800000000 implements MigrationInterface {
  name = 'AutonomousTicketAutomation1766800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TYPE "statistics_interaction_kind_enum" ADD VALUE IF NOT EXISTS 'autonomous_ticket_run'
    `);
    await queryRunner.query(`
      ALTER TYPE "statistics_interaction_kind_enum" ADD VALUE IF NOT EXISTS 'autonomous_ticket_run_turn'
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "ticket_automation_run_status_enum" AS ENUM (
          'pending', 'running', 'succeeded', 'failed', 'timed_out', 'escalated', 'cancelled'
        );
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "ticket_automation_run_phase_enum" AS ENUM (
          'pre_improve', 'workspace_prep', 'agent_loop', 'verify', 'finalize'
        );
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "ticket_automation_lease_status_enum" AS ENUM ('active', 'released', 'expired');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);

    await queryRunner.createTable(
      new Table({
        name: 'client_agent_autonomy',
        columns: [
          { name: 'client_id', type: 'uuid', isNullable: false, isPrimary: true },
          { name: 'agent_id', type: 'uuid', isNullable: false, isPrimary: true },
          { name: 'enabled', type: 'boolean', default: false, isNullable: false },
          { name: 'pre_improve_ticket', type: 'boolean', default: false, isNullable: false },
          { name: 'max_runtime_ms', type: 'int', default: 3600000, isNullable: false },
          { name: 'max_iterations', type: 'int', default: 20, isNullable: false },
          { name: 'token_budget_limit', type: 'int', isNullable: true },
          { name: 'created_at', type: 'timestamptz', default: 'CURRENT_TIMESTAMP', isNullable: false },
          { name: 'updated_at', type: 'timestamptz', default: 'CURRENT_TIMESTAMP', isNullable: false },
        ],
      }),
      true,
    );
    await queryRunner.createForeignKey(
      'client_agent_autonomy',
      new TableForeignKey({
        columnNames: ['client_id'],
        referencedTableName: 'clients',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'ticket_automation',
        columns: [
          { name: 'ticket_id', type: 'uuid', isPrimary: true },
          { name: 'eligible', type: 'boolean', default: false, isNullable: false },
          { name: 'allowed_agent_ids', type: 'jsonb', isNullable: false, default: "'[]'" },
          { name: 'verifier_profile', type: 'jsonb', isNullable: true },
          { name: 'requires_approval', type: 'boolean', default: false, isNullable: false },
          { name: 'approved_at', type: 'timestamptz', isNullable: true },
          { name: 'approved_by_user_id', type: 'uuid', isNullable: true },
          { name: 'approval_baseline_ticket_updated_at', type: 'timestamptz', isNullable: true },
          { name: 'default_branch_override', type: 'varchar', length: '256', isNullable: true },
          { name: 'next_retry_at', type: 'timestamptz', isNullable: true },
          { name: 'consecutive_failure_count', type: 'int', default: 0, isNullable: false },
          { name: 'created_at', type: 'timestamptz', default: 'CURRENT_TIMESTAMP', isNullable: false },
          { name: 'updated_at', type: 'timestamptz', default: 'CURRENT_TIMESTAMP', isNullable: false },
        ],
      }),
      true,
    );
    await queryRunner.createForeignKey(
      'ticket_automation',
      new TableForeignKey({
        columnNames: ['ticket_id'],
        referencedTableName: 'tickets',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
    await queryRunner.createForeignKey(
      'ticket_automation',
      new TableForeignKey({
        columnNames: ['approved_by_user_id'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'ticket_automation_run',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'ticket_id', type: 'uuid', isNullable: false },
          { name: 'client_id', type: 'uuid', isNullable: false },
          { name: 'agent_id', type: 'uuid', isNullable: false },
          {
            name: 'status',
            type: 'enum',
            enum: ['pending', 'running', 'succeeded', 'failed', 'timed_out', 'escalated', 'cancelled'],
            enumName: 'ticket_automation_run_status_enum',
            isNullable: false,
          },
          {
            name: 'phase',
            type: 'enum',
            enum: ['pre_improve', 'workspace_prep', 'agent_loop', 'verify', 'finalize'],
            enumName: 'ticket_automation_run_phase_enum',
            isNullable: false,
          },
          { name: 'ticket_status_before', type: 'varchar', length: '32', isNullable: false },
          { name: 'branch_name', type: 'varchar', length: '512', isNullable: true },
          { name: 'base_branch', type: 'varchar', length: '256', isNullable: true },
          { name: 'base_sha', type: 'varchar', length: '64', isNullable: true },
          { name: 'started_at', type: 'timestamptz', isNullable: false },
          { name: 'finished_at', type: 'timestamptz', isNullable: true },
          { name: 'updated_at', type: 'timestamptz', default: 'CURRENT_TIMESTAMP', isNullable: false },
          { name: 'iteration_count', type: 'int', default: 0, isNullable: false },
          { name: 'completion_marker_seen', type: 'boolean', default: false, isNullable: false },
          { name: 'verification_passed', type: 'boolean', isNullable: true },
          { name: 'failure_code', type: 'varchar', length: '64', isNullable: true },
          { name: 'summary', type: 'jsonb', isNullable: true },
          { name: 'cancel_requested_at', type: 'timestamptz', isNullable: true },
          { name: 'cancelled_by_user_id', type: 'uuid', isNullable: true },
          { name: 'cancellation_reason', type: 'varchar', length: '64', isNullable: true },
        ],
      }),
      true,
    );
    await queryRunner.createForeignKey(
      'ticket_automation_run',
      new TableForeignKey({
        columnNames: ['ticket_id'],
        referencedTableName: 'tickets',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
    await queryRunner.createForeignKey(
      'ticket_automation_run',
      new TableForeignKey({
        columnNames: ['client_id'],
        referencedTableName: 'clients',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
    await queryRunner.createForeignKey(
      'ticket_automation_run',
      new TableForeignKey({
        columnNames: ['cancelled_by_user_id'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
      }),
    );
    await queryRunner.createIndex(
      'ticket_automation_run',
      new TableIndex({
        name: 'IDX_ticket_automation_run_ticket_started',
        columnNames: ['ticket_id', 'started_at'],
      }),
    );
    await queryRunner.createIndex(
      'ticket_automation_run',
      new TableIndex({ name: 'IDX_ticket_automation_run_client_status', columnNames: ['client_id', 'status'] }),
    );
    await queryRunner.createIndex(
      'ticket_automation_run',
      new TableIndex({ name: 'IDX_ticket_automation_run_agent_status', columnNames: ['agent_id', 'status'] }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'ticket_automation_lease',
        columns: [
          { name: 'ticket_id', type: 'uuid', isPrimary: true },
          { name: 'holder_agent_id', type: 'uuid', isNullable: false },
          { name: 'run_id', type: 'uuid', isNullable: false },
          { name: 'lease_version', type: 'int', default: 0, isNullable: false },
          { name: 'expires_at', type: 'timestamptz', isNullable: false },
          {
            name: 'status',
            type: 'enum',
            enum: ['active', 'released', 'expired'],
            enumName: 'ticket_automation_lease_status_enum',
            isNullable: false,
          },
          { name: 'created_at', type: 'timestamptz', default: 'CURRENT_TIMESTAMP', isNullable: false },
          { name: 'updated_at', type: 'timestamptz', default: 'CURRENT_TIMESTAMP', isNullable: false },
        ],
      }),
      true,
    );
    await queryRunner.createForeignKey(
      'ticket_automation_lease',
      new TableForeignKey({
        columnNames: ['ticket_id'],
        referencedTableName: 'tickets',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
    await queryRunner.createForeignKey(
      'ticket_automation_lease',
      new TableForeignKey({
        columnNames: ['run_id'],
        referencedTableName: 'ticket_automation_run',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'ticket_automation_run_step',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'run_id', type: 'uuid', isNullable: false },
          { name: 'step_index', type: 'int', isNullable: false },
          { name: 'phase', type: 'varchar', length: '32', isNullable: false },
          { name: 'kind', type: 'varchar', length: '64', isNullable: false },
          { name: 'payload', type: 'jsonb', isNullable: true },
          { name: 'excerpt', type: 'text', isNullable: true },
          { name: 'created_at', type: 'timestamptz', default: 'CURRENT_TIMESTAMP', isNullable: false },
        ],
      }),
      true,
    );
    await queryRunner.createForeignKey(
      'ticket_automation_run_step',
      new TableForeignKey({
        columnNames: ['run_id'],
        referencedTableName: 'ticket_automation_run',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
    await queryRunner.createIndex(
      'ticket_automation_run_step',
      new TableIndex({
        name: 'IDX_ticket_automation_run_step_run_index',
        columnNames: ['run_id', 'step_index'],
        isUnique: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('ticket_automation_run_step', true);
    await queryRunner.dropTable('ticket_automation_lease', true);
    await queryRunner.dropTable('ticket_automation_run', true);
    await queryRunner.dropTable('ticket_automation', true);
    await queryRunner.dropTable('client_agent_autonomy', true);
    await queryRunner.query(`DROP TYPE IF EXISTS "ticket_automation_lease_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "ticket_automation_run_phase_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "ticket_automation_run_status_enum"`);
  }
}
