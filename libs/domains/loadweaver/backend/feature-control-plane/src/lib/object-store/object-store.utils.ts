import { hkdfSync } from 'node:crypto';

/** Garage ports alternate per generation, so the old and the new generation can run side by side (3.20). */
const GENERATION_PORTS = [
  { s3: 3900, rpc: 3901, admin: 3903 },
  { s3: 3910, rpc: 3911, admin: 3913 },
] as const;

export function objectStorePorts(generation: number): { s3: number; rpc: number; admin: number } {
  return { ...GENERATION_PORTS[generation % 2] };
}

/** Garage's replication factor can't change in place: one copy per member, at most three. */
export function targetReplicationFactor(members: number): number {
  return Math.max(1, Math.min(3, members));
}

export const REGISTRY_BUCKET = 'lw-registry';
/** Files of the control plane itself (reports, 3.25), with their own key: the registry can't read them. */
export const FILES_BUCKET = 'lw-files';
/** Backup repositories (3.20, one Kopia repository per prefix), with their own key: only the repository servers. */
export const BACKUPS_BUCKET = 'lw-backups';

export interface ObjectStoreSecrets {
  rpcSecret: string;
  adminToken: string;
  accessKeyId: string;
  secretAccessKey: string;
  registryHttpSecret: string;
  filesAccessKeyId: string;
  filesSecretAccessKey: string;
  backupsAccessKeyId: string;
  backupsSecretAccessKey: string;
}

function derive(key: Buffer, label: string, bytes: number): string {
  return Buffer.from(hkdfSync('sha256', key, Buffer.alloc(0), `loadweaver/${label}`, bytes)).toString('hex');
}

/**
 * Per-generation secrets, derived (HKDF) from the cluster's encryption key that every control-plane member already
 * holds, so nothing else needs storing; injected into desired state at push time only.
 */
export function objectStoreSecrets(encryptionKey: string, generation: number): ObjectStoreSecrets {
  const key = Buffer.from(encryptionKey, 'utf8');

  return {
    rpcSecret: derive(key, `garage/${generation}/rpc`, 32),
    adminToken: derive(key, `garage/${generation}/admin`, 32),
    accessKeyId: `GK${derive(key, `garage/${generation}/registry-key-id`, 12)}`,
    secretAccessKey: derive(key, `garage/${generation}/registry-key-secret`, 32),
    registryHttpSecret: derive(key, `registry/${generation}/http`, 32),
    filesAccessKeyId: `GK${derive(key, `garage/${generation}/files-key-id`, 12)}`,
    filesSecretAccessKey: derive(key, `garage/${generation}/files-key-secret`, 32),
    backupsAccessKeyId: `GK${derive(key, `garage/${generation}/backups-key-id`, 12)}`,
    backupsSecretAccessKey: derive(key, `garage/${generation}/backups-key-secret`, 32),
  };
}

export type GenerationState = 'provisioning' | 'copying' | 'active' | 'retiring' | 'retired';

export interface GenerationView {
  generation: number;
  replicationFactor: number;
  state: GenerationState;
  holders: string[];
  /** When this generation's members last changed (rf changes wait for a stable membership). */
  observedSince: Date;
  observedMembers: string[];
  stateChangedAt: Date;
}

export type ObjectStoreStep =
  | { kind: 'idle' }
  | { kind: 'observe'; generation: number; members: string[] }
  | { kind: 'create'; generation: number; replicationFactor: number; holders: string[] }
  | { kind: 'provision'; generation: number }
  | { kind: 'copy'; from: number; to: number }
  | { kind: 'rebalance'; generation: number; members: string[] }
  | { kind: 'retire'; generation: number }
  /** A generation that could never form with its holders (one stopped being a member). */
  | { kind: 'abandon'; generation: number };

/** An rf change waits until the membership was stable for this long (nodes often join one after another). */
export const MEMBERSHIP_STABLE_MS = 5 * 60_000;
/** A retiring generation is removed once every registry had time to switch over. */
export const RETIRE_GRACE_MS = 2 * 60_000;

/** The next thing the object-store controller does; one step per tick. */
export function nextObjectStoreStep(
  generations: readonly GenerationView[],
  members: readonly string[],
  now: number,
): ObjectStoreStep {
  const live = generations.filter((g) => g.state !== 'retired');
  const sorted = [...members].sort();
  const key = sorted.join(',');

  if (sorted.length === 0) return { kind: 'idle' };

  const retiring = live.find((g) => g.state === 'retiring');

  if (retiring && now - retiring.stateChangedAt.getTime() >= RETIRE_GRACE_MS)
    return { kind: 'retire', generation: retiring.generation };

  const pending = live.find((g) => g.state === 'provisioning' || g.state === 'copying');
  const active = live.find((g) => g.state === 'active');
  const next = Math.max(0, ...generations.map((g) => g.generation)) + 1;

  if (pending?.state === 'provisioning' && pending.holders.some((h) => !sorted.includes(h)))
    return { kind: 'abandon', generation: pending.generation };

  if (pending) {
    if (pending.state === 'provisioning') return { kind: 'provision', generation: pending.generation };

    return active
      ? { kind: 'copy', from: active.generation, to: pending.generation }
      : { kind: 'provision', generation: pending.generation };
  }

  if (!active)
    return {
      kind: 'create',
      generation: next,
      replicationFactor: targetReplicationFactor(sorted.length),
      holders: sorted,
    };

  if (active.observedMembers.join(',') !== key)
    return { kind: 'observe', generation: active.generation, members: sorted };

  const rf = targetReplicationFactor(sorted.length);

  if (rf !== active.replicationFactor) {
    return now - active.observedSince.getTime() >= MEMBERSHIP_STABLE_MS
      ? { kind: 'create', generation: next, replicationFactor: rf, holders: sorted }
      : { kind: 'idle' };
  }

  // Same replication factor: Garage moves the data itself; former members stay holders until it did.
  if (active.holders.join(',') !== key) return { kind: 'rebalance', generation: active.generation, members: sorted };

  return { kind: 'idle' };
}
