import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Decabill PAT scopes → `<resource>:read|write|admin` (admin ⊇ write ⊇ read).
 *
 * Frozen mapping that never escalates beyond the legacy reach (apart from the `read` implied by a
 * `write` on the same resource):
 * - former admin-only `*:write` scopes become `*:admin` (catalog, invoices, usage, promotions, datev)
 * - admin-only project actions (ticket create/update/delete, attachment upload/delete, milestones,
 *   time entries) moved to `:admin`; non-admin owners keep the non-admin part only
 * - `billing_admin:write` expands into the per-resource admin scopes covering its former routes
 * - `billing_admin:read` is dropped: every covering `:admin` scope also grants admin writes
 * - `invoice:admin` / `projects:write` were never enforced and are dropped
 * `:admin` scopes are removed for non-admin owners.
 */
const BILLING_LEGACY_PAT_SCOPE_MAP: Readonly<Record<string, readonly string[]>> = {
  'catalog:write': ['catalog:admin'],
  // Customer catalog reads were previously covered by subscriptions:read.
  'subscriptions:read': ['subscriptions:read', 'catalog:read'],
  'subscriptions:write': ['subscriptions:write', 'catalog:read'],
  'invoices:pay': ['invoices:write'],
  'invoices:write': ['invoices:admin'],
  'invoice:admin': [],
  'usage:write': ['usage:admin'],
  // Legacy promotions:read already covered redeem, which now requires promotions:write.
  'promotions:read': ['promotions:write'],
  'promotions:write': ['promotions:admin'],
  'projects:read': ['projects:read', 'milestones:read', 'time_entries:read'],
  'projects:write': [],
  'milestones:write': ['milestones:admin'],
  'time_entries:write': ['time_entries:admin'],
  'tickets:write': ['tickets:write', 'tickets:admin'],
  'attachments:write': ['attachments:admin'],
  'billing_admin:read': [],
  'billing_admin:write': [
    'billing:admin',
    'subscriptions:admin',
    'invoices:admin',
    'supplier_invoices:admin',
    'offers:admin',
    'projects:admin',
    'usage:admin',
  ],
  'datev:write': ['datev:admin'],
};

export class RefactorBillingPatScopes1793600000000 implements MigrationInterface {
  name = 'RefactorBillingPatScopes1793600000000';

  /** Frozen legacy map (static: TypeORM instantiates every exported function/class in a migration file). */
  static readonly legacyScopeMap: Readonly<Record<string, readonly string[]>> = BILLING_LEGACY_PAT_SCOPE_MAP;

  /**
   * Map a stored scope list; `:admin` scopes are removed for non-admin owners (never effective for them,
   * and the token editor would reject them on the next update). Kept inline: migrations compile standalone.
   */
  static mapLegacyPatScopes(scopes: readonly string[], ownerIsAdmin: boolean): string[] {
    const map = RefactorBillingPatScopes1793600000000.legacyScopeMap;
    const mapped = scopes.flatMap((scope) => (Object.prototype.hasOwnProperty.call(map, scope) ? map[scope] : [scope]));

    return [...new Set(mapped)].filter((scope) => ownerIsAdmin || !/^[a-z][a-z0-9_]*:admin$/.test(scope));
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    const rows: { id: string; scopes: unknown; role: string | null }[] = await queryRunner.query(
      `SELECT t."id", t."scopes", u."role"
       FROM "user_personal_access_tokens" t
       LEFT JOIN "users" u ON u."id" = t."user_id"`,
    );

    for (const row of rows) {
      const current = Array.isArray(row.scopes) ? (row.scopes as string[]) : [];
      const next = RefactorBillingPatScopes1793600000000.mapLegacyPatScopes(current, row.role === 'admin');
      const unchanged = next.length === current.length && next.every((scope, index) => scope === current[index]);

      if (unchanged) {
        continue;
      }

      // Tokens left without scopes stop authenticating; exchanged PAT JWTs are rejected on next use.
      await queryRunner.query(`UPDATE "user_personal_access_tokens" SET "scopes" = $1::jsonb WHERE "id" = $2`, [
        JSON.stringify(next),
        row.id,
      ]);
    }
  }

  public async down(): Promise<void> {
    // Not reversible: the mapping is lossy (dropped and merged scopes).
  }
}
