import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Connections and workspace deployments PAT scopes.
 *
 * - `imports:admin` is dropped: `/imports/atlassian` moved to `/connections/atlassian`, guarded by `connections:admin`,
 *   which also covers the CI/CD credentials of `/connections/deployments`. Mapping it would widen what existing tokens
 *   reach, so admins re-grant `connections:admin` explicitly.
 * - `agent_deployments:*` is dropped with the per-environment deployment manager. Workspace deployments use the new
 *   `deployments:read|write` scopes, which have to be granted explicitly as well.
 *
 * Tokens left without scopes stop authenticating; exchanged PAT JWTs are rejected on next use.
 */
export class RefactorConnectionsPatScopes1794300000000 implements MigrationInterface {
  name = 'RefactorConnectionsPatScopes1794300000000';

  /** Frozen list (static: TypeORM instantiates every exported function/class in a migration file). */
  static readonly droppedScopes: readonly string[] = [
    'imports:admin',
    'agent_deployments:read',
    'agent_deployments:write',
  ];

  static mapScopes(scopes: readonly string[]): string[] {
    const dropped = new Set(RefactorConnectionsPatScopes1794300000000.droppedScopes);

    return scopes.filter((scope) => !dropped.has(scope));
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    const rows: { id: string; scopes: unknown }[] = await queryRunner.query(
      `SELECT "id", "scopes" FROM "user_personal_access_tokens"`,
    );

    for (const row of rows) {
      const current = Array.isArray(row.scopes) ? (row.scopes as string[]) : [];
      const next = RefactorConnectionsPatScopes1794300000000.mapScopes(current);

      if (next.length === current.length) {
        continue;
      }

      await queryRunner.query(`UPDATE "user_personal_access_tokens" SET "scopes" = $1::jsonb WHERE "id" = $2`, [
        JSON.stringify(next),
        row.id,
      ]);
    }
  }

  public async down(): Promise<void> {
    // Not reversible: dropped scopes are not restored.
  }
}
