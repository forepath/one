import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Agenstra PAT scopes → `<resource>:read|write|admin` (admin ⊇ write ⊇ read).
 *
 * Frozen mapping that never escalates beyond the legacy reach (apart from the `read` implied by a
 * `write` on the same resource):
 * - fine-grained `agents:*` capabilities become their own resources at `write` (same routes + reads)
 * - `imports:write` (admin-only routes) becomes `imports:admin`
 * - `agents:lifecycle` is dropped: every covering scope (`agents:write`) also grants agent CRUD
 * - `clients:write` stays `clients:write`; the admin OpenCode config now needs `clients:admin`
 *   (explicit re-grant instead of silently keeping instance-wide config access)
 * `:admin` scopes are removed for non-admin owners.
 */
const AGENSTRA_LEGACY_PAT_SCOPE_MAP: Readonly<Record<string, readonly string[]>> = {
  'agents:lifecycle': [],
  'agents:files': ['agent_files:write'],
  'agents:environment': ['agent_environment:write'],
  'agents:chats': ['agent_chats:write'],
  'agents:vcs': ['agent_vcs:write'],
  'agents:deployments': ['agent_deployments:write'],
  'agents:vnc': ['agent_vnc:write'],
  'imports:write': ['imports:admin'],
};

export class RefactorAgenstraPatScopes1793600000000 implements MigrationInterface {
  name = 'RefactorAgenstraPatScopes1793600000000';

  /** Frozen legacy map (static: TypeORM instantiates every exported function/class in a migration file). */
  static readonly legacyScopeMap: Readonly<Record<string, readonly string[]>> = AGENSTRA_LEGACY_PAT_SCOPE_MAP;

  /**
   * Map a stored scope list; `:admin` scopes are removed for non-admin owners (never effective for them,
   * and the token editor would reject them on the next update). Kept inline: migrations compile standalone.
   */
  static mapLegacyPatScopes(scopes: readonly string[], ownerIsAdmin: boolean): string[] {
    const map = RefactorAgenstraPatScopes1793600000000.legacyScopeMap;
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
      const next = RefactorAgenstraPatScopes1793600000000.mapLegacyPatScopes(current, row.role === 'admin');
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
