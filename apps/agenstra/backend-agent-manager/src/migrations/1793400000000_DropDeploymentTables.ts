import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drops the per-environment deployment manager tables. CI/CD configuration and run history moved to the
 * agent-controller as workspace-level deployments backed by admin-managed connections.
 */
export class DropDeploymentTables1793400000000 implements MigrationInterface {
  name = 'DropDeploymentTables1793400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "deployment_runs"');
    await queryRunner.query('DROP TABLE IF EXISTS "deployment_configurations"');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "deployment_configurations" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "agent_id" uuid NOT NULL REFERENCES "agents"("id") ON DELETE CASCADE,
        "provider_type" varchar(50) NOT NULL,
        "repository_id" varchar(255) NOT NULL,
        "default_branch" varchar(255),
        "workflow_id" varchar(255),
        "provider_token" varchar(2048) NOT NULL,
        "provider_base_url" varchar(512),
        "created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
        "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await queryRunner.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS "idx_deployment_configurations_agent_id" ON "deployment_configurations" ("agent_id")',
    );
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "idx_deployment_configurations_provider_type" ON "deployment_configurations" ("provider_type")',
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "deployment_runs" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "configuration_id" uuid NOT NULL REFERENCES "deployment_configurations"("id") ON DELETE CASCADE,
        "provider_run_id" varchar(255) NOT NULL,
        "run_name" varchar(255) NOT NULL,
        "status" varchar(50) NOT NULL,
        "conclusion" varchar(50),
        "ref" varchar(255) NOT NULL,
        "sha" varchar(40) NOT NULL,
        "workflow_id" varchar(255),
        "workflow_name" varchar(255),
        "started_at" timestamp,
        "completed_at" timestamp,
        "html_url" text,
        "created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
        "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "idx_deployment_runs_configuration_id" ON "deployment_runs" ("configuration_id")',
    );
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "idx_deployment_runs_provider_run_id" ON "deployment_runs" ("provider_run_id")',
    );
    await queryRunner.query('CREATE INDEX IF NOT EXISTS "idx_deployment_runs_status" ON "deployment_runs" ("status")');
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "idx_deployment_runs_created_at" ON "deployment_runs" ("created_at")',
    );
  }
}
