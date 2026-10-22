import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Container isolation level `microvm` (KVM microVM): last observed state per workspace host, so
 * `isolation.microvm_available` / `isolation.microvm_unavailable` transitions are published once. `NULL` for
 * snapshots recorded before the level existed.
 */
export class AddClientIsolationSnapshotMicrovmState1793100000000 implements MigrationInterface {
  name = 'AddClientIsolationSnapshotMicrovmState1793100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "client_isolation_snapshots" ADD COLUMN IF NOT EXISTS "microvm_state" VARCHAR(32)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "client_isolation_snapshots" DROP COLUMN IF EXISTS "microvm_state"`);
  }
}
