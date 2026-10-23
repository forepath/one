import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Virtual machines (3.35, M7 W8): operational state of the lifecycle API — power of `Manual` VMs and the cloud-init
 * instance generation, node commands
 * (`vmPower`, `vmImageImport`), snapshots (one backup per disk) and VM image imports into the built-in registry.
 * Additive.
 */
export class VirtualMachines1800000000050 implements MigrationInterface {
  name = 'VirtualMachines1800000000050';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_vm_power" (
        "project" varchar(63) NOT NULL,
        "name" varchar(63) NOT NULL,
        "desired" varchar(16) NOT NULL CHECK ("desired" IN ('running', 'stopped')),
        "graceful" boolean NOT NULL DEFAULT true,
        "instance_generation" integer NOT NULL DEFAULT 1,
        "changed_by" varchar(255),
        "changed_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lw_vm_power" PRIMARY KEY ("project", "name")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_vm_commands" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "project" varchar(63) NOT NULL,
        "name" varchar(63) NOT NULL,
        "node" varchar(63) NOT NULL,
        "type" varchar(32) NOT NULL,
        "action" varchar(32) NOT NULL,
        "payload" jsonb NOT NULL,
        "status" varchar(16) NOT NULL,
        "error" text,
        "requested_by" varchar(255),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "sent_at" timestamptz,
        CONSTRAINT "PK_lw_vm_commands" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_lw_vm_commands_vm" ON "lw_vm_commands" ("project", "name", "created_at")`,
    );
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_lw_vm_commands_status" ON "lw_vm_commands" ("status")`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_vm_snapshots" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "project" varchar(63) NOT NULL,
        "name" varchar(63) NOT NULL,
        "backups" jsonb NOT NULL,
        "consistency" varchar(16) NOT NULL,
        "description" varchar(1024),
        "created_by" varchar(255),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lw_vm_snapshots" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_lw_vm_snapshots_vm" ON "lw_vm_snapshots" ("project", "name", "created_at")`,
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_vm_image_imports" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "project" varchar(63) NOT NULL,
        "repository" varchar(190) NOT NULL,
        "tag" varchar(128) NOT NULL,
        "url" varchar(2048) NOT NULL,
        "sha256" varchar(64) NOT NULL,
        "arch" varchar(8) NOT NULL,
        "firmware" jsonb NOT NULL,
        "guest_agent" boolean NOT NULL DEFAULT false,
        "status" varchar(16) NOT NULL,
        "step" varchar(16),
        "format" varchar(8),
        "container_disk" boolean NOT NULL DEFAULT false,
        "downloaded_bytes" bigint NOT NULL DEFAULT 0,
        "virtual_size" bigint,
        "digest" varchar(71),
        "error" text,
        "requested_by" varchar(255),
        "worker" varchar(128),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "started_at" timestamptz,
        "heartbeat_at" timestamptz,
        "finished_at" timestamptz,
        CONSTRAINT "PK_lw_vm_image_imports" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_lw_vm_image_imports_project" ON "lw_vm_image_imports" ("project", "created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_lw_vm_image_imports_status" ON "lw_vm_image_imports" ("status")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_vm_image_imports"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_vm_snapshots"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_vm_commands"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_vm_power"`);
  }
}
