import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * MicroVMs and full VMs (3.35, M7 W3): a deployment's pins also hold what the image resolver read from the pinned
 * images at plan time (labels, process config and layers of microVM images; the disk layer of VM image artifacts),
 * so the compile never talks to a registry. Nodes get the nonce of on-demand isolation probes. Additive.
 */
export class DeploymentImageConfigs1800000000049 implements MigrationInterface {
  name = 'DeploymentImageConfigs1800000000049';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "lw_deployment_states" ADD COLUMN IF NOT EXISTS "image_configs" jsonb NOT NULL DEFAULT '{}'`,
    );
    // On-demand isolation probes (3.1): the nonce the node's desired state carries.
    await queryRunner.query(`ALTER TABLE "lw_nodes" ADD COLUMN IF NOT EXISTS "isolation_probe_nonce" varchar(64) NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "lw_nodes" DROP COLUMN IF EXISTS "isolation_probe_nonce"`);
    await queryRunner.query(`ALTER TABLE "lw_deployment_states" DROP COLUMN IF EXISTS "image_configs"`);
  }
}
