import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Deployment actions of environments (`agenstra_deployments_*` tools):
 * - `agent_tasks.allowed_deployment_operations` / `ticket_automation.allowed_deployment_operations`: run actions
 *   (`deployment.trigger`, `deployment.cancel`) unattended runs may request, approved content, empty by default
 *   (visible chats ask the user per action instead)
 * - `deployment_workflows` approval + actor columns: environments may propose workflows for themselves, which wait
 *   for a workspace admin (`approved_at` null) before runs can be started. Existing workflows were created by users and
 *   count as approved.
 */
export class AddDeploymentAgentActions1794500000000 implements MigrationInterface {
  name = 'AddDeploymentAgentActions1794500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "agent_tasks" ADD COLUMN IF NOT EXISTS "allowed_deployment_operations" JSONB NOT NULL DEFAULT '[]'::jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "ticket_automation" ADD COLUMN IF NOT EXISTS "allowed_deployment_operations" JSONB NOT NULL DEFAULT '[]'::jsonb`,
    );
    await queryRunner.query(`
      ALTER TABLE "deployment_workflows"
        ADD COLUMN IF NOT EXISTS "approved_at" TIMESTAMPTZ NULL,
        ADD COLUMN IF NOT EXISTS "approved_by_user_id" UUID NULL,
        ADD COLUMN IF NOT EXISTS "created_by_type" VARCHAR(16) NOT NULL DEFAULT 'user',
        ADD COLUMN IF NOT EXISTS "updated_by_type" VARCHAR(16) NOT NULL DEFAULT 'user',
        ADD COLUMN IF NOT EXISTS "created_by_agent_id" UUID NULL
    `);
    await queryRunner.query(
      `UPDATE "deployment_workflows" SET "approved_at" = "created_at" WHERE "approved_at" IS NULL`,
    );
    await queryRunner.query(`
      ALTER TABLE "deployment_workflows"
        DROP CONSTRAINT IF EXISTS "CHK_deployment_workflows_created_by_type",
        ADD CONSTRAINT "CHK_deployment_workflows_created_by_type" CHECK ("created_by_type" IN ('user', 'agent'))
    `);
    await queryRunner.query(`
      ALTER TABLE "deployment_workflows"
        DROP CONSTRAINT IF EXISTS "CHK_deployment_workflows_updated_by_type",
        ADD CONSTRAINT "CHK_deployment_workflows_updated_by_type" CHECK ("updated_by_type" IN ('user', 'agent'))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "deployment_workflows"
        DROP CONSTRAINT IF EXISTS "CHK_deployment_workflows_updated_by_type",
        DROP CONSTRAINT IF EXISTS "CHK_deployment_workflows_created_by_type",
        DROP COLUMN IF EXISTS "created_by_agent_id",
        DROP COLUMN IF EXISTS "updated_by_type",
        DROP COLUMN IF EXISTS "created_by_type",
        DROP COLUMN IF EXISTS "approved_by_user_id",
        DROP COLUMN IF EXISTS "approved_at"
    `);
    await queryRunner.query(`ALTER TABLE "ticket_automation" DROP COLUMN IF EXISTS "allowed_deployment_operations"`);
    await queryRunner.query(`ALTER TABLE "agent_tasks" DROP COLUMN IF EXISTS "allowed_deployment_operations"`);
  }
}
