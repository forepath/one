import type { RegistryAccess } from '../services/registry-token.service';

const REPOSITORY = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\/[a-z0-9]+(?:[._-][a-z0-9]+)*)+$/;

/** Parses Docker's `scope` parameters (`repository:<name>:<actions>`); anything else is ignored. */
export function parseRegistryScopes(scopes: readonly string[]): RegistryAccess[] {
  const access: RegistryAccess[] = [];

  for (const scope of scopes) {
    const match = /^repository:([^:]+):([a-z,*]+)$/.exec(scope);

    if (!match || !REPOSITORY.test(match[1]) || match[1].length > 255) continue;

    const actions = match[2].split(',').filter((a): a is 'pull' | 'push' => a === 'pull' || a === 'push');

    if (actions.length) access.push({ name: match[1], actions: [...new Set(actions)] });
  }

  return access;
}

/**
 * What the caller gets (3.22): repositories live under a project namespace; pull needs read access, push needs
 * deploy rights. Until project roles exist (M5) those are the cluster read / infra permissions.
 */
export function grantRegistryAccess(
  requested: readonly RegistryAccess[],
  projects: ReadonlySet<string>,
  may: { pull: boolean; push: boolean },
): RegistryAccess[] {
  return requested
    .filter((a) => projects.has(a.name.split('/')[0]))
    .map((a) => ({ name: a.name, actions: a.actions.filter((x) => (x === 'pull' ? may.pull : may.push)) }))
    .filter((a) => a.actions.length > 0);
}
