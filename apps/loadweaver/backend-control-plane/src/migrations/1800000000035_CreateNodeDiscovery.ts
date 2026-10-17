import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Import of existing Docker hosts and former nodes (3.21, M6 step 4): the latest read-only discovery of each node that
 * joined for an import (`pending`), the import wizard's selections with their join plan, the plan it was turned into
 * and the progress of its steps; and the host ports a node keeps for itself (WireGuard listen ports skip them).
 */
export class CreateNodeDiscovery1800000000035 implements MigrationInterface {
  name = 'CreateNodeDiscovery1800000000035';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_node_discoveries" (
        "node" varchar(63) PRIMARY KEY,
        "id" uuid NOT NULL,
        "report" jsonb NOT NULL,
        "source" varchar(16) NOT NULL,
        "request_id" uuid,
        "requested_at" timestamptz,
        "received_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_import_selections" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "node" varchar(63) NOT NULL,
        "discovery_id" uuid NOT NULL,
        "selections" jsonb NOT NULL,
        "join_plan" jsonb NOT NULL,
        "status" varchar(20) NOT NULL DEFAULT 'draft',
        "plan_id" uuid,
        "steps" jsonb NOT NULL DEFAULT '{}',
        "restart_policies" jsonb NOT NULL DEFAULT '{}',
        "released" jsonb NOT NULL DEFAULT '[]',
        "error" text,
        "created_by" varchar(255),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    // One open import per node; finished / discarded ones stay as history.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_lw_import_selections_open" ON "lw_import_selections" ("node") WHERE "status" IN ('draft', 'planned', 'running')`,
    );
    await queryRunner.query(`ALTER TABLE "lw_nodes" ADD COLUMN IF NOT EXISTS "reserved_ports" jsonb`);
    // `pending`: joined for an import, no desired state yet; `importing`: its join plan is applied.
    await queryRunner.query(`ALTER TABLE "lw_nodes" DROP CONSTRAINT IF EXISTS "CHK_lw_nodes_lifecycle"`);
    await queryRunner.query(
      `ALTER TABLE "lw_nodes" ADD CONSTRAINT "CHK_lw_nodes_lifecycle" CHECK ("lifecycle" IN ('pending', 'importing', 'active', 'cordoned', 'draining', 'leaving', 'left'))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE "lw_nodes" SET "lifecycle" = 'left' WHERE "lifecycle" IN ('pending', 'importing')`);
    await queryRunner.query(`ALTER TABLE "lw_nodes" DROP CONSTRAINT IF EXISTS "CHK_lw_nodes_lifecycle"`);
    await queryRunner.query(
      `ALTER TABLE "lw_nodes" ADD CONSTRAINT "CHK_lw_nodes_lifecycle" CHECK ("lifecycle" IN ('active', 'cordoned', 'draining', 'leaving', 'left'))`,
    );
    await queryRunner.query(`ALTER TABLE "lw_nodes" DROP COLUMN IF EXISTS "reserved_ports"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_import_selections"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_node_discoveries"`);
  }
}
