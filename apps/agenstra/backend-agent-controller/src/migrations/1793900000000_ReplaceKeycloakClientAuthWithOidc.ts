import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Controller → agent-manager authentication: Keycloak specific client credentials become provider-agnostic OIDC
 * client credentials. The enum value `keycloak` becomes `oidc` (clients + statistics shadow table).
 *
 * `keycloak_realm` is folded into the per-client issuer (`<KEYCLOAK_AUTH_SERVER_URL>/realms/<realm>`) when
 * KEYCLOAK_AUTH_SERVER_URL is still present in the environment while migrating; otherwise the issuer stays NULL and
 * the controller's OIDC_ISSUER applies. Issuers equal to OIDC_ISSUER (set while migrating) are stored as NULL too.
 * Internal issuer URLs of other realms must be listed in OIDC_TRUSTED_CLIENT_ISSUERS (otherwise the client-endpoint
 * SSRF policy applies to them).
 */
export class ReplaceKeycloakClientAuthWithOidc1793900000000 implements MigrationInterface {
  name = 'ReplaceKeycloakClientAuthWithOidc1793900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
          WHERE t.typname = 'authentication_type_enum' AND e.enumlabel = 'keycloak'
        ) THEN
          ALTER TYPE "authentication_type_enum" RENAME VALUE 'keycloak' TO 'oidc';
        END IF;
        IF EXISTS (
          SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
          WHERE t.typname = 'statistics_authentication_type_enum' AND e.enumlabel = 'keycloak'
        ) THEN
          ALTER TYPE "statistics_authentication_type_enum" RENAME VALUE 'keycloak' TO 'oidc';
        END IF;
      END $$;
    `);

    await queryRunner.query(`ALTER TABLE "clients" RENAME COLUMN "keycloak_client_id" TO "oidc_client_id"`);
    await queryRunner.query(`ALTER TABLE "clients" RENAME COLUMN "keycloak_client_secret" TO "oidc_client_secret"`);
    await queryRunner.query(`ALTER TABLE "clients" ADD COLUMN "oidc_issuer" varchar(1024)`);
    await queryRunner.query(`ALTER TABLE "clients" ADD COLUMN "oidc_scope" varchar(1024)`);

    const keycloakAuthServerUrl = (process.env.KEYCLOAK_AUTH_SERVER_URL ?? '').trim().replace(/\/+$/, '');

    if (keycloakAuthServerUrl) {
      await queryRunner.query(
        `UPDATE "clients" SET "oidc_issuer" = $1 || '/realms/' || "keycloak_realm"
         WHERE "keycloak_realm" IS NOT NULL AND "keycloak_realm" <> ''`,
        [keycloakAuthServerUrl],
      );

      // Clients of the controller's own issuer keep following OIDC_ISSUER (trusted, operator configured) instead of
      // being pinned to a copy that would be treated as a user-supplied issuer.
      const controllerIssuer = (process.env.OIDC_ISSUER ?? '').trim().replace(/\/+$/, '');

      if (controllerIssuer) {
        await queryRunner.query(`UPDATE "clients" SET "oidc_issuer" = NULL WHERE rtrim("oidc_issuer", '/') = $1`, [
          controllerIssuer,
        ]);
      }

      // Remaining per-client issuers are treated as user supplied (client-endpoint SSRF policy) unless listed in
      // OIDC_TRUSTED_CLIENT_ISSUERS: name them so operators can trust internal issuer URLs before traffic fails.
      const trusted = (process.env.OIDC_TRUSTED_CLIENT_ISSUERS ?? '')
        .split(',')
        .map((value) => value.trim().replace(/\/+$/, ''))
        .filter((value) => value.length > 0);
      const untrusted = (
        (await queryRunner.query(
          `SELECT "id", "oidc_issuer" FROM "clients" WHERE "oidc_issuer" IS NOT NULL`,
        )) as Array<{ id: string; oidc_issuer: string }>
      ).filter((row) => !trusted.includes(row.oidc_issuer.replace(/\/+$/, '')));

      if (untrusted.length > 0) {
        console.warn(
          `[ReplaceKeycloakClientAuthWithOidc] ${untrusted.length} client(s) keep a per-client OIDC issuer that is not OIDC_ISSUER: ` +
            untrusted.map((row) => `${row.id} (${row.oidc_issuer})`).join(', ') +
            '. Add internal issuers to OIDC_TRUSTED_CLIENT_ISSUERS, otherwise the client-endpoint SSRF policy applies.',
        );
      }
    }

    await queryRunner.query(`ALTER TABLE "clients" DROP COLUMN "keycloak_realm"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "clients" ADD COLUMN "keycloak_realm" varchar(255)`);
    await queryRunner.query(`
      UPDATE "clients" SET "keycloak_realm" = substring("oidc_issuer" from '/realms/([^/]+)/?$')
      WHERE "oidc_issuer" IS NOT NULL
    `);

    // Rows that followed OIDC_ISSUER (NULL issuer) get the realm of OIDC_ISSUER back when it is a Keycloak issuer.
    const controllerRealm = /\/realms\/([^/]+)\/?$/.exec((process.env.OIDC_ISSUER ?? '').trim())?.[1];

    if (controllerRealm) {
      await queryRunner.query(
        `UPDATE "clients" SET "keycloak_realm" = $1 WHERE "oidc_issuer" IS NULL AND "authentication_type"::text = 'oidc'`,
        [controllerRealm],
      );
    }

    await queryRunner.query(`ALTER TABLE "clients" DROP COLUMN "oidc_scope"`);
    await queryRunner.query(`ALTER TABLE "clients" DROP COLUMN "oidc_issuer"`);
    await queryRunner.query(`ALTER TABLE "clients" RENAME COLUMN "oidc_client_secret" TO "keycloak_client_secret"`);
    await queryRunner.query(`ALTER TABLE "clients" RENAME COLUMN "oidc_client_id" TO "keycloak_client_id"`);
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
          WHERE t.typname = 'authentication_type_enum' AND e.enumlabel = 'oidc'
        ) THEN
          ALTER TYPE "authentication_type_enum" RENAME VALUE 'oidc' TO 'keycloak';
        END IF;
        IF EXISTS (
          SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
          WHERE t.typname = 'statistics_authentication_type_enum' AND e.enumlabel = 'oidc'
        ) THEN
          ALTER TYPE "statistics_authentication_type_enum" RENAME VALUE 'oidc' TO 'keycloak';
        END IF;
      END $$;
    `);
  }
}
