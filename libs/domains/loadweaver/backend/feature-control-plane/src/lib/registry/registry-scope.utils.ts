import { atLeast, canReadProject, projectRole, type AccessCaller } from '../access/access.utils';
import type { RegistryAccess } from '../services/registry-token.service';
import { SYSTEM_REPOSITORY_PREFIX } from '../updates/registry-import';

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

/** Whether Docker asked for the repository catalog (`registry:catalog:*`, `GET /v2/_catalog`). */
export function requestsRegistryCatalog(scopes: readonly string[]): boolean {
  return scopes.some((scope) => /^registry:catalog:([a-z,]*\*[a-z,*]*)$/.test(scope));
}

/** What the caller's roles allow on a project's repositories (3.22, 2026-10-26: project roles only). */
export function registryProjectActions(caller: AccessCaller, project: string): ('pull' | 'push')[] {
  return [
    ...(canReadProject(caller, project) ? (['pull'] as const) : []),
    ...(atLeast(projectRole(caller, project), 'developer') ? (['push'] as const) : []),
  ];
}

/**
 * Whether the caller may log in at all (`docker login` asks without a scope): any project membership or cluster role.
 */
export function mayUseRegistry(caller: AccessCaller): boolean {
  return caller.isApiKey || !!caller.clusterRole || caller.projects.size > 0;
}

/**
 * What the caller gets (3.22): repositories live under an existing project's namespace; pull needs a project role
 * (viewer and up) or a cluster role that reads every project, push a developer role and up (cluster admins act as
 * project admins). No cluster role is needed for project repositories. System repositories (`lw-system/…`) are
 * never handed out here. A personal access token pushes only with `registry:push`. Repositories (or actions) the
 * caller may not use are left out of the token, as Docker's token protocol expects.
 */
export function grantRegistryAccess(
  requested: readonly RegistryAccess[],
  projects: ReadonlySet<string>,
  caller: AccessCaller,
  token: { push: boolean },
): RegistryAccess[] {
  return requested
    .map((a) => ({ a, project: a.name.split('/')[0] }))
    .filter(({ project }) => project !== SYSTEM_REPOSITORY_PREFIX && projects.has(project))
    .map(({ a, project }) => {
      const allowed = registryProjectActions(caller, project).filter((x) => x === 'pull' || token.push);

      return { name: a.name, actions: a.actions.filter((x) => allowed.includes(x)) };
    })
    .filter((a) => a.actions.length > 0);
}
