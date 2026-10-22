import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Container isolation level `sandboxed-kvm` (gVisor on its KVM platform): last observed state per
 * workspace host, so `isolation.sandbox_kvm_available` / `isolation.sandbox_kvm_unavailable`
 * transitions are published once. `NULL` for snapshots recorded before the level existed.
 */
export class AddClientIsolationSnapshotSandboxedKvmState1793000000000 implements MigrationInterface {
  name = 'AddClientIsolationSnapshotSandboxedKvmState1793000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "client_isolation_snapshots" ADD COLUMN IF NOT EXISTS "sandboxed_kvm_state" VARCHAR(32)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "client_isolation_snapshots" DROP COLUMN IF EXISTS "sandboxed_kvm_state"`);
  }
}
