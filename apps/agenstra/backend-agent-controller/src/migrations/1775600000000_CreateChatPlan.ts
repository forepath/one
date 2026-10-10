import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

/**
 * Durable chat-scoped plan aggregates for Agenstra chat plan mode.
 */
export class CreateChatPlan1775500000000 implements MigrationInterface {
  name = 'CreateChatPlan1775500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TYPE "statistics_interaction_kind_enum" ADD VALUE IF NOT EXISTS 'chat_plan_turn'
    `);
    await queryRunner.query(`
      ALTER TYPE "statistics_interaction_kind_enum" ADD VALUE IF NOT EXISTS 'chat_plan_execute'
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "chat_plan_status_enum" AS ENUM (
          'pending', 'exploring', 'ready', 'refining', 'executing', 'executed', 'failed', 'cancelled'
        );
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "chat_plan_phase_enum" AS ENUM (
          'explore', 'draft', 'refine', 'ready'
        );
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);

    await queryRunner.createTable(
      new Table({
        name: 'chat_plan',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'client_id', type: 'uuid', isNullable: false },
          { name: 'agent_id', type: 'uuid', isNullable: false },
          { name: 'chat_id', type: 'uuid', isNullable: false },
          {
            name: 'status',
            type: 'enum',
            enum: ['pending', 'exploring', 'ready', 'refining', 'executing', 'executed', 'failed', 'cancelled'],
            enumName: 'chat_plan_status_enum',
            isNullable: false,
          },
          {
            name: 'phase',
            type: 'enum',
            enum: ['explore', 'draft', 'refine', 'ready'],
            enumName: 'chat_plan_phase_enum',
            isNullable: false,
          },
          { name: 'source_prompt', type: 'text', isNullable: false },
          { name: 'plan_markdown', type: 'text', isNullable: true },
          { name: 'summary', type: 'varchar', length: '512', isNullable: true },
          { name: 'context_injection', type: 'jsonb', isNullable: true },
          { name: 'model', type: 'varchar', length: '256', isNullable: true },
          { name: 'resume_session_suffix', type: 'varchar', length: '128', isNullable: false },
          { name: 'completion_signal_seen', type: 'boolean', default: false, isNullable: false },
          { name: 'failure_code', type: 'varchar', length: '64', isNullable: true },
          { name: 'failure_message', type: 'varchar', length: '512', isNullable: true },
          { name: 'created_by_user_id', type: 'uuid', isNullable: true },
          { name: 'started_at', type: 'timestamptz', isNullable: false },
          { name: 'finished_at', type: 'timestamptz', isNullable: true },
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

    await queryRunner.createIndex(
      'chat_plan',
      new TableIndex({
        name: 'IDX_chat_plan_client_agent_chat',
        columnNames: ['client_id', 'agent_id', 'chat_id'],
      }),
    );
    await queryRunner.createIndex(
      'chat_plan',
      new TableIndex({
        name: 'IDX_chat_plan_agent_chat_status',
        columnNames: ['agent_id', 'chat_id', 'status'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('chat_plan', 'IDX_chat_plan_agent_chat_status');
    await queryRunner.dropIndex('chat_plan', 'IDX_chat_plan_client_agent_chat');
    await queryRunner.dropTable('chat_plan', true);
    await queryRunner.query(`DROP TYPE IF EXISTS "chat_plan_phase_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "chat_plan_status_enum"`);
    // Postgres cannot remove enum values from statistics_interaction_kind_enum safely.
  }
}
