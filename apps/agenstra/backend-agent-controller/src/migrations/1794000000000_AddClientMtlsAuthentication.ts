import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Controller → agent-manager authentication with a client certificate (`authentication_type = 'mtls'`):
 * the certificate chain (PEM, public) and its private key (PEM, AES-256-GCM encrypted by the entity transformer).
 * The statistics shadow table mirrors the enum value.
 */
export class AddClientMtlsAuthentication1794000000000 implements MigrationInterface {
  name = 'AddClientMtlsAuthentication1794000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE "authentication_type_enum" ADD VALUE IF NOT EXISTS 'mtls'`);
    await queryRunner.query(`ALTER TYPE "statistics_authentication_type_enum" ADD VALUE IF NOT EXISTS 'mtls'`);
    await queryRunner.query(`ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "mtls_certificate" text`);
    await queryRunner.query(`ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "mtls_private_key" text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // PostgreSQL cannot drop enum values: mtls clients fall back to api_key without a key (must be reconfigured).
    await queryRunner.query(
      `UPDATE "clients" SET "authentication_type" = 'api_key', "api_key" = NULL WHERE "authentication_type"::text = 'mtls'`,
    );
    await queryRunner.query(
      `UPDATE "statistics_clients" SET "authentication_type" = 'api_key' WHERE "authentication_type"::text = 'mtls'`,
    );
    await queryRunner.query(`ALTER TABLE "clients" DROP COLUMN IF EXISTS "mtls_private_key"`);
    await queryRunner.query(`ALTER TABLE "clients" DROP COLUMN IF EXISTS "mtls_certificate"`);
  }
}
