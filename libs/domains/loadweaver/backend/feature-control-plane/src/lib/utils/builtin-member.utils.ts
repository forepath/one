import * as path from 'node:path';

/**
 * Built-in control-plane member (3.39): a master-key holder inside the control-plane API process, never a node. Its
 * holder name can't be a node name (node names are DNS labels), so no agent can claim its shares.
 */
export const BUILTIN_HOLDER = '@control-plane';

/** The single `lw_builtin_members` row. */
export const BUILTIN_MEMBER_ID = 'control-plane';

export const BUILTIN_MEMBER_DEFAULT_DIR = '/var/lib/loadweaver-control-plane';
export const BUILTIN_SEAL_KEY_FILENAME = 'builtin-seal.key';

/**
 * `auto` (default): sole holder while no real control-plane member can hold a share, else a standby copy only;
 * `always`: also a share holder next to the real members (plus the standby copy); `off`: never a holder.
 */
export type BuiltinMemberMode = 'auto' | 'always' | 'off';

/**
 * - `active`: sole holder (0 real members with a seal key);
 * - `standby`: real members hold the shares; the built-in member keeps a standby copy and doesn't answer unseal
 *   requests while any real member is registered;
 * - `participant` (`always`): a share holder next to the real members, plus the standby copy;
 * - `off`: not a holder.
 */
export type BuiltinMemberRole = 'active' | 'standby' | 'participant' | 'off';

export interface BuiltinHolderPlan {
  /** `@control-plane` holds a Shamir share of the active key. */
  share: boolean;
  /** `@control-plane` keeps a standby copy of the whole key (opened only when no real member is registered). */
  standby: boolean;
  role: BuiltinMemberRole;
}

export function builtinMemberMode(env: NodeJS.ProcessEnv = process.env): BuiltinMemberMode {
  const value = (env['LOADWEAVER_BUILTIN_MEMBER'] ?? '').trim().toLowerCase();

  if (value === '' || value === 'auto') return 'auto';

  if (value === 'always' || value === 'off') return value;

  throw new Error(`LOADWEAVER_BUILTIN_MEMBER must be auto, always or off (got "${value}")`);
}

/** The seal key file: the operator-managed `LOADWEAVER_BUILTIN_SEAL_KEY_FILE`, else `<dir>/builtin-seal.key`. */
export function builtinSealKeyPath(env: NodeJS.ProcessEnv = process.env): { file: string; managed: boolean } {
  const managed = env['LOADWEAVER_BUILTIN_SEAL_KEY_FILE']?.trim();

  if (managed) return { file: path.resolve(managed), managed: true };

  const dir = env['LOADWEAVER_BUILTIN_MEMBER_DIR']?.trim() || BUILTIN_MEMBER_DEFAULT_DIR;

  return { file: path.join(path.resolve(dir), BUILTIN_SEAL_KEY_FILENAME), managed: false };
}

/**
 * How the master key is held for `realMembers` control-plane members with a seal key (user decision 2026-10-29):
 * the threshold uses the real members only; the built-in member is the sole holder only while there are none, and
 * otherwise keeps an in-sync standby copy so it can take over when the cluster drops back to 0 members.
 */
export function builtinHolderPlan(realMembers: number, mode: BuiltinMemberMode | null): BuiltinHolderPlan {
  if (!mode || mode === 'off') return { share: false, standby: false, role: 'off' };

  if (realMembers <= 0) return { share: true, standby: false, role: 'active' };

  if (mode === 'always') return { share: true, standby: true, role: 'participant' };

  return { share: false, standby: true, role: 'standby' };
}

/** Associated data of the standby copy of master key `keyId`. */
export function builtinStandbyAad(keyId: string): string {
  return `master-key/${keyId}/${BUILTIN_HOLDER}/standby`;
}
