export interface ResolvedUser {
  uid: number;
  gid: number;
  /** Login name when the user exists in `/etc/passwd` (supplementary groups are initialised from it). */
  name: string | null;
  home: string;
}

export class UnknownUserError extends Error {}

interface PasswdEntry {
  name: string;
  uid: number;
  gid: number;
  home: string;
}

function parsePasswd(content: string): PasswdEntry[] {
  return content
    .split('\n')
    .map((line) => line.split(':'))
    .filter((fields) => fields.length >= 7 && /^\d+$/.test(fields[2]) && /^\d+$/.test(fields[3]))
    .map((fields) => ({ name: fields[0], uid: Number(fields[2]), gid: Number(fields[3]), home: fields[5] || '/' }));
}

function parseGroups(content: string): { name: string; gid: number }[] {
  return content
    .split('\n')
    .map((line) => line.split(':'))
    .filter((fields) => fields.length >= 3 && /^\d+$/.test(fields[2]))
    .map((fields) => ({ name: fields[0], gid: Number(fields[2]) }));
}

/**
 * Resolves a Docker-style user spec (`name`, `uid`, `name:group`, `uid:gid`; empty = root) the way
 * `docker exec --user` does: names must exist, numeric ids may be unknown (then gid 0 and HOME `/`).
 */
export function resolveUserSpec(spec: string, passwdContent: string, groupContent: string): ResolvedUser {
  const [userPart, groupPart] = (spec || '0').split(':', 2);
  const passwd = parsePasswd(passwdContent);
  const numericUser = /^\d+$/.test(userPart);
  const entry = numericUser
    ? passwd.find((candidate) => candidate.uid === Number(userPart))
    : passwd.find((candidate) => candidate.name === userPart);

  if (!entry && !numericUser) {
    throw new UnknownUserError(`unable to find user ${userPart}: no matching entries in passwd file`);
  }

  const resolved: ResolvedUser = entry
    ? { uid: entry.uid, gid: entry.gid, name: entry.name, home: entry.home }
    : { uid: Number(userPart), gid: 0, name: null, home: '/' };

  if (groupPart !== undefined) {
    if (/^\d+$/.test(groupPart)) {
      resolved.gid = Number(groupPart);
    } else {
      const group = parseGroups(groupContent).find((candidate) => candidate.name === groupPart);

      if (!group) {
        throw new UnknownUserError(`unable to find group ${groupPart}: no matching entries in group file`);
      }

      resolved.gid = group.gid;
    }
  }

  return resolved;
}

/**
 * Wraps `argv` so it runs as `user`. Uses util-linux `setpriv` (part of every Debian base) so supplementary groups
 * are initialised like Docker does; no wrapper is needed when the agent already runs with the target ids.
 */
export function wrapForUser(
  argv: string[],
  user: ResolvedUser,
  current: { uid: number; gid: number },
  setprivPath = '/usr/bin/setpriv',
): string[] {
  if (user.uid === current.uid && user.gid === current.gid) {
    return argv;
  }

  return [
    setprivPath,
    `--reuid=${user.uid}`,
    `--regid=${user.gid}`,
    user.name ? '--init-groups' : '--clear-groups',
    '--',
    ...argv,
  ];
}

/** Docker semantics: HOME follows the user unless the environment sets it explicitly. */
export function buildProcessEnv(
  base: readonly string[],
  extra: readonly string[],
  user: ResolvedUser,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};

  for (const entry of [...base, ...extra]) {
    const separator = entry.indexOf('=');

    env[entry.slice(0, separator)] = entry.slice(separator + 1);
  }

  if (env['HOME'] === undefined) {
    env['HOME'] = user.home;
  }

  if (env['PATH'] === undefined) {
    env['PATH'] = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
  }

  return env;
}
