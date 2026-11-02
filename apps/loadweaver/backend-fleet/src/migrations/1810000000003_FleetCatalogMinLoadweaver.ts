import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fleet catalog (P1, user decision 2026-11-01): the uploaded package manifest's `minLoadweaver`, emitted in the fleet
 * index's optional `minLoadweaver` so clusters flag fleet apps they are too old for. Rows uploaded before stay null
 * (no minimum listed; the cluster still checks the package's manifest at install).
 */
export class FleetCatalogMinLoadweaver1810000000003 implements MigrationInterface {
  name = 'FleetCatalogMinLoadweaver1810000000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "lw_fleet_catalog_packages" ADD COLUMN IF NOT EXISTS "min_loadweaver" varchar(128)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "lw_fleet_catalog_packages" DROP COLUMN IF EXISTS "min_loadweaver"`);
  }
}
