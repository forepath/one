import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMigrationState1800000000003 implements MigrationInterface {
  name = 'AddMigrationState1800000000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "lw_workload_placements" ADD COLUMN IF NOT EXISTS "target_node" varchar(63)`);
    await queryRunner.query(
      `ALTER TABLE "lw_workload_placements" ADD COLUMN IF NOT EXISTS "target_addresses" jsonb NOT NULL DEFAULT '[]'`,
    );
    await queryRunner.query(`ALTER TABLE "lw_workload_placements" ADD COLUMN IF NOT EXISTS "migration" jsonb`);
    await queryRunner.query(
      `ALTER TABLE "lw_volume_placements" ADD COLUMN IF NOT EXISTS "pending_primary" varchar(63)`,
    );
    await queryRunner.query(`ALTER TABLE "lw_nodes" ADD COLUMN IF NOT EXISTS "lost_confirmed_at" TIMESTAMPTZ`);
    await queryRunner.query(`ALTER TABLE "lw_workload_placements" ADD COLUMN IF NOT EXISTS "gate" varchar(16)`);
    await queryRunner.query(`ALTER TABLE "lw_workload_placements" ADD COLUMN IF NOT EXISTS "released_spec" jsonb`);
    await queryRunner.query(
      `ALTER TABLE "lw_deployment_states" ADD COLUMN IF NOT EXISTS "generation" integer NOT NULL DEFAULT 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "lw_deployment_states" DROP COLUMN IF EXISTS "generation"`);
    await queryRunner.query(`ALTER TABLE "lw_workload_placements" DROP COLUMN IF EXISTS "released_spec"`);
    await queryRunner.query(`ALTER TABLE "lw_workload_placements" DROP COLUMN IF EXISTS "gate"`);
    await queryRunner.query(`ALTER TABLE "lw_nodes" DROP COLUMN IF EXISTS "lost_confirmed_at"`);
    await queryRunner.query(`ALTER TABLE "lw_volume_placements" DROP COLUMN IF EXISTS "pending_primary"`);
    await queryRunner.query(`ALTER TABLE "lw_workload_placements" DROP COLUMN IF EXISTS "migration"`);
    await queryRunner.query(`ALTER TABLE "lw_workload_placements" DROP COLUMN IF EXISTS "target_addresses"`);
    await queryRunner.query(`ALTER TABLE "lw_workload_placements" DROP COLUMN IF EXISTS "target_node"`);
  }
}
