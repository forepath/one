import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Provider-agnostic external identity link (replaces the Keycloak-specific `keycloak_sub`).
 * Existing Keycloak links become `external_provider = 'oidc'` (Keycloak is an OIDC provider; `sub` is unchanged).
 * Uniqueness moves from (tenant_id, keycloak_sub) to (tenant_id, external_provider, external_subject).
 */
export class ReplaceKeycloakSubWithExternalIdentity1793900000000 implements MigrationInterface {
  name = 'ReplaceKeycloakSubWithExternalIdentity1793900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_users_tenant_keycloak_sub"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_users_keycloak_sub"`);
    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "uq_users_keycloak_sub"`);
    await queryRunner.query(`ALTER TABLE "users" RENAME COLUMN "keycloak_sub" TO "external_subject"`);
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN "external_provider" varchar(16)`);
    await queryRunner.query(`UPDATE "users" SET "external_provider" = 'oidc' WHERE "external_subject" IS NOT NULL`);
    await queryRunner.query(`
      ALTER TABLE "users" ADD CONSTRAINT "CHK_users_external_identity_pair"
      CHECK (("external_provider" IS NULL) = ("external_subject" IS NULL))
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_users_tenant_external_identity"
      ON "users" ("tenant_id", "external_provider", "external_subject")
      WHERE "external_subject" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_users_tenant_external_identity"`);
    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "CHK_users_external_identity_pair"`);
    // SAML links have no Keycloak equivalent; drop them so (tenant_id, keycloak_sub) stays unique.
    await queryRunner.query(`UPDATE "users" SET "external_subject" = NULL WHERE "external_provider" = 'saml'`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "external_provider"`);
    await queryRunner.query(`ALTER TABLE "users" RENAME COLUMN "external_subject" TO "keycloak_sub"`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_users_tenant_keycloak_sub"
      ON "users" ("tenant_id", "keycloak_sub")
      WHERE "keycloak_sub" IS NOT NULL
    `);
  }
}
