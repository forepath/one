import { MigrationInterface, QueryRunner } from 'typeorm';

const SERIAL_PLACEHOLDERS = ['0', 'UNKNOWN', 'NONE', 'N/A', 'SYSTEM SERIAL NUMBER', 'TO BE FILLED BY O.E.M.'];

/**
 * Posture identity hardening (follow-up review H2): pinned device identifiers are normalized (device id lower-case,
 * serial upper-case without placeholders, hostname = lower-case first label) and unique among non-revoked clients
 * through partial unique indexes (concurrent first reports can't both pin the same value; duplicates left by the
 * old case-sensitive check keep only the newest client's pin). Integrations get `require_user_match` (the vendor's
 * device user must be the VPN client's owner, default on) and lose `hostname` from their match keys unless it was
 * the only one (hostnames are self-reported and not unique — now opt-in with a warning).
 */
export class PosturePinnedIdentifiers1800000000048 implements MigrationInterface {
  name = 'PosturePinnedIdentifiers1800000000048';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Non-string / blank pins are no pins.
    for (const key of ['deviceId', 'serialNumber', 'hostname']) {
      await queryRunner.query(
        `UPDATE "lw_vpn_clients" SET "posture" = "posture" - $1::text
           WHERE "posture" ? $1::text
             AND (jsonb_typeof("posture" -> $1::text) <> 'string' OR btrim("posture" ->> $1::text) = '')`,
        [key],
      );
    }

    await queryRunner.query(
      `UPDATE "lw_vpn_clients"
         SET "posture" = jsonb_set("posture", '{deviceId}', to_jsonb(lower(btrim("posture" ->> 'deviceId'))))
         WHERE "posture" ? 'deviceId'`,
    );
    await queryRunner.query(
      `UPDATE "lw_vpn_clients"
         SET "posture" = jsonb_set("posture", '{serialNumber}', to_jsonb(upper(btrim("posture" ->> 'serialNumber'))))
         WHERE "posture" ? 'serialNumber'`,
    );
    await queryRunner.query(
      `UPDATE "lw_vpn_clients" SET "posture" = "posture" - 'serialNumber'
         WHERE "posture" ->> 'serialNumber' = ANY($1::text[])`,
      [SERIAL_PLACEHOLDERS],
    );
    await queryRunner.query(
      `UPDATE "lw_vpn_clients"
         SET "posture" = jsonb_set("posture", '{hostname}', to_jsonb(split_part(lower(btrim("posture" ->> 'hostname')), '.', 1)))
         WHERE "posture" ? 'hostname'`,
    );

    const indexes: [string, string][] = [
      ['deviceId', 'UQ_lw_vpn_clients_pinned_device_id'],
      ['serialNumber', 'UQ_lw_vpn_clients_pinned_serial'],
      ['hostname', 'UQ_lw_vpn_clients_pinned_hostname'],
    ];

    for (const [key, index] of indexes) {
      // Duplicates among non-revoked clients: the newest client keeps the pin (it re-pins at its next report anyway).
      await queryRunner.query(
        `UPDATE "lw_vpn_clients" c SET "posture" = c."posture" - $1::text
           FROM (
             SELECT "id", row_number() OVER (PARTITION BY "posture" ->> $1::text ORDER BY "created_at" DESC, "id" DESC) AS rn
               FROM "lw_vpn_clients"
              WHERE "revoked_at" IS NULL AND "posture" ->> $1::text IS NOT NULL
           ) d
          WHERE c."id" = d."id" AND d.rn > 1`,
        [key],
      );
      await queryRunner.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS "${index}" ON "lw_vpn_clients" (("posture" ->> '${key}'))
           WHERE "revoked_at" IS NULL AND "posture" ->> '${key}' IS NOT NULL`,
      );
    }

    await queryRunner.query(
      `ALTER TABLE "lw_posture_integrations" ADD COLUMN IF NOT EXISTS "require_user_match" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `UPDATE "lw_posture_integrations" SET "match_by" = array_remove("match_by", 'hostname')
         WHERE 'hostname' = ANY("match_by") AND cardinality(array_remove("match_by", 'hostname')) > 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "lw_posture_integrations" DROP COLUMN IF EXISTS "require_user_match"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_lw_vpn_clients_pinned_hostname"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_lw_vpn_clients_pinned_serial"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_lw_vpn_clients_pinned_device_id"`);
  }
}
