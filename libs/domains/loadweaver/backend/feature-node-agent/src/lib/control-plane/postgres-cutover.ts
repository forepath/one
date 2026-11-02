import { chown, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { ControlPlaneRole } from '@forepath/loadweaver/shared/util-agent-protocol';

/**
 * Patroni scope of the member's database and the cut-over to a point-in-time clone (3.20, feature
 * `platform-cutover`). The scope the data directory belongs to is kept in a marker next to it: it changes only through
 * an explicit `postgresCutover`, never because a desired state names another scope, so a stale or wrong desired
 * state can't make a member start its data under a different scope (or wipe it).
 */

/** `<state>/postgres-scope`: the scope the data in `<state>/postgres` belongs to. */
export const SCOPE_MARKER = 'postgres-scope';
/** Spilo's `postgres` user and group (the image's): the owner of mounted data directories. */
export const SPILO_UID = 101;
export const SPILO_GID = 103;
/** Clone directories carry the restore id (`.loadweaver-clone`, see the role manager). */
export const CLONE_MARKER = '.loadweaver-clone';
const SCOPE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export type CutoverAction =
  | { kind: 'none' }
  /** This member adopts its clone directory as its database. */
  | { kind: 'adopt'; id: string; scope: string }
  /** This member keeps its data aside and starts empty in the new scope (a replica of the clone). */
  | { kind: 'reinit'; id: string; scope: string }
  | { kind: 'refuse'; reason: string };

/** What a member does with a cut-over in its desired state (pure). */
export function cutoverAction(input: {
  node: string;
  /** Scope of the member's data (marker), null for a member without one yet. */
  marker: string | null;
  role: Pick<ControlPlaneRole, 'platformBackups'>;
  /** Restore id the member's clone directory belongs to, if any. */
  cloneMarker: string | null;
}): CutoverAction {
  const cutover = input.role.platformBackups?.postgresCutover;

  if (!cutover || input.marker === cutover.scope) return { kind: 'none' };

  // Only data of the scope being replaced is touched (a member that never ran it, or already moved on, ignores it).
  if (input.marker !== null && input.marker !== cutover.previousScope)
    return { kind: 'refuse', reason: `data belongs to scope ${input.marker}, not ${cutover.previousScope}` };

  if (cutover.node === input.node) {
    if (input.cloneMarker !== cutover.id)
      return { kind: 'refuse', reason: `no clone of restore ${cutover.id} on this member to adopt` };

    return { kind: 'adopt', id: cutover.id, scope: cutover.scope };
  }

  return { kind: 'reinit', id: cutover.id, scope: cutover.scope };
}

/** The scope Spilo runs with: the marker, else the desired state's database scope, else the cluster scope. */
export function effectivePostgresScope(
  marker: string | null,
  role: Pick<ControlPlaneRole, 'scope' | 'postgresScope'>,
): string {
  return marker ?? role.postgresScope ?? role.scope;
}

export async function readScopeMarker(stateDir: string): Promise<string | null> {
  const value = (await readFile(join(stateDir, SCOPE_MARKER), 'utf8').catch(() => '')).trim();

  return SCOPE.test(value) ? value : null;
}

export async function writeScopeMarker(stateDir: string, scope: string): Promise<void> {
  if (!SCOPE.test(scope)) throw new Error(`invalid scope ${scope}`);

  await writeFile(join(stateDir, `${SCOPE_MARKER}.tmp`), `${scope}\n`, { mode: 0o600 });
  await rename(join(stateDir, `${SCOPE_MARKER}.tmp`), join(stateDir, SCOPE_MARKER));
}

async function exists(path: string): Promise<boolean> {
  return await stat(path).then(
    () => true,
    () => false,
  );
}

/** Keeps the newest previous data directory of a cut-over, removes older ones (they hold a whole database each). */
async function prunePrevious(stateDir: string, keep: string): Promise<void> {
  for (const entry of await readdir(stateDir).catch(() => [] as string[]))
    if (entry.startsWith('postgres.pre-') && entry !== keep)
      await rm(join(stateDir, entry), { recursive: true, force: true });
}

/**
 * Applies a cut-over on this member before Spilo is (re)started and returns the scope Spilo runs with. `removeContainer`
 * stops a managed container (`lw-postgres`, `lw-postgres-pitr`). Adopting: the clone's data directory becomes the
 * member's (`postgres-pitr` → `postgres`, the current one kept as `postgres.pre-<restore>`); re-initialising: the
 * current directory is kept the same way and Spilo starts empty in the new scope (Patroni makes it a replica).
 */
export async function applyPostgresCutover(
  stateDir: string,
  node: string,
  role: ControlPlaneRole,
  containers: { postgres: string; clone: string; remove: (name: string) => Promise<boolean> },
  log: (line: string) => void,
): Promise<string> {
  const marker = await readScopeMarker(stateDir);
  const cloneDir = join(stateDir, 'postgres-pitr');
  const cloneMarker = (await readFile(join(cloneDir, CLONE_MARKER), 'utf8').catch(() => '')).trim() || null;
  const action = cutoverAction({ node, marker, role, cloneMarker });

  switch (action.kind) {
    case 'none': {
      const scope = effectivePostgresScope(marker, role);

      if (!marker) await writeScopeMarker(stateDir, scope);

      return scope;
    }
    case 'refuse':
      log(`Postgres cut-over not applied here: ${action.reason}`);

      return effectivePostgresScope(marker, role);
    case 'adopt':
    case 'reinit': {
      const dataDir = join(stateDir, 'postgres');
      const previous = `postgres.pre-${action.id.slice(0, 8)}`;

      await containers.remove(containers.postgres);

      if (action.kind === 'adopt') await containers.remove(containers.clone);

      if (await exists(dataDir)) {
        await rm(join(stateDir, previous), { recursive: true, force: true });
        await rename(dataDir, join(stateDir, previous));
      }

      if (action.kind === 'adopt') {
        await rename(cloneDir, dataDir);
        await rm(join(dataDir, CLONE_MARKER), { force: true });
      } else {
        await mkdir(dataDir, { recursive: true, mode: 0o700 });
        await chown(dataDir, SPILO_UID, SPILO_GID).catch(() => undefined);
      }

      await writeScopeMarker(stateDir, action.scope);
      await prunePrevious(stateDir, previous);
      log(
        action.kind === 'adopt'
          ? `Postgres cut-over: adopted the clone of restore ${action.id} as the database (scope ${action.scope}); previous data kept in ${previous}`
          : `Postgres cut-over: previous data kept in ${previous}; starting as a replica in scope ${action.scope}`,
      );

      return action.scope;
    }
  }
}
