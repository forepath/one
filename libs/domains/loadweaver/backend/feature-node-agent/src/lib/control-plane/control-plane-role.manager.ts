import { createHash } from 'node:crypto';
import { chown, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { ControlPlaneRole } from '@forepath/loadweaver/shared/util-agent-protocol';
import { Injectable, Logger } from '@nestjs/common';

import { CommandRunner } from '../host/command-runner';
import { ManagedContainers } from '../host/managed-containers';
import { LOG_STORE_CONTAINER, logStoreSpec, MIN_MAX_MAP_COUNT, openSearchImage, OPENSEARCH_UID } from './log-store';
import { AgentStateStore } from '../state/agent-state.store';
import { localSecret } from '../host/local-secret';
import {
  CONTAINER_NAMES,
  controlPlaneApiSpec,
  controlPlaneImages,
  etcdClientUrl,
  etcdPeerUrl,
  etcdSpec,
  LOCAL_ETCD_HOSTS,
  POSTGRES_CONNECT_CHANGED_EXIT,
  POSTGRES_ROLE_PASSWORDS_CHANGED_EXIT,
  POSTGRES_ROLE_PASSWORDS_COMMAND,
  POSTGRES_ROLE_PASSWORDS_REPLICA_EXIT,
  postgresConnectEnvironment,
  postgresConnectSyncCommand,
  postgresRolePasswordsExecEnvironment,
  postgresSpec,
  queueSpec,
  type ContainerSpec,
  type ControlPlaneComponent,
  type MemberContext,
} from './control-plane-containers';
import { addMember, initialClusterFrom, listMembers, removeMember, updateMemberPeerUrl } from './etcd-client';
import { PostgresLeaderProxy } from './postgres-leader-proxy';
import { patroniSwitchover } from '../updates/patroni';
import { installSpiloWalgConfig, POSTGRES_CLONE_CONTAINER, postgresCloneSpec } from './platform-backups';
import { applyPostgresCutover, SPILO_GID, SPILO_UID } from './postgres-cutover';
import {
  fenceDatabase,
  fenceDecision,
  probeDatabaseFence,
  readFenceState,
  seenEpoch,
  staleRole,
  writeFenceState,
  type FenceDeps,
  type FenceProbe,
  type FenceState,
} from './database-fence';
import { ensurePostgresTls, installSpiloTls } from './postgres-tls';

/** Marks which restore a clone data directory belongs to (a new restore starts from an empty directory). */
const CLONE_MARKER = '.loadweaver-clone';

/**
 * Which components run for a role (3.2): witnesses only vote in etcd. A member waits with its control-plane API replica
 * while the cluster's database isn't on the members yet (3.43, `database: pending` from an external control plane); its
 * other layers run (the handover needs Patroni).
 */
export function componentsFor(
  role: ControlPlaneRole['role'],
  database?: ControlPlaneRole['database'],
): ControlPlaneComponent[] {
  switch (role) {
    case 'member':
      return database === 'pending' ? ['etcd', 'postgres', 'queue'] : ['etcd', 'postgres', 'queue', 'controlPlane'];
    case 'witness':
      return ['etcd'];
    default:
      return [];
  }
}

async function isEmptyDir(path: string): Promise<boolean> {
  try {
    return (await readdir(path)).length === 0;
  } catch {
    return true;
  }
}

/** Whether this node holds etcd data (a non-empty data directory): reported to the control plane (3.43). */
export async function holdsEtcdData(stateDir: string): Promise<boolean> {
  return !(await isEmptyDir(join(stateDir, 'etcd')));
}

/**
 * An empty member can't start etcd yet (3.43): no member holding data is reachable, or the control plane hasn't picked
 * this member to bootstrap. It never bootstraps on its own (a second cluster next to the first = split brain).
 */
export class EtcdJoinPendingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EtcdJoinPendingError';
  }
}

/**
 * Runs the control-plane components this node is responsible for (3.2): etcd on members and the witness,
 * Patroni / Postgres and the API on members. Grows and shrinks etcd membership as nodes join and leave.
 */
/** SIGHUP to the member's postmaster (its pid file under Spilo's `PGROOT`, see `postgresSpec`). */
export const POSTGRES_RELOAD_COMMAND = [
  'sh',
  '-c',
  'kill -HUP "$(head -n 1 /home/postgres/pgdata/pgroot/data/postmaster.pid)"',
];

/** How often a running Spilo's connect addresses are checked again (a container restart regenerates its config). */
export const POSTGRES_CONNECT_RECHECK_MS = 10 * 60_000;

/** How often the member's data epoch is probed at most during applies, and checked between them (3.43 takeover). */
export const FENCE_PROBE_INTERVAL_MS = 60_000;

/** How long a member keeps its last platform-backup settings when a desired state lacks them (G5: join / restore). */
export const PLATFORM_BACKUPS_GRACE_MS = 2 * 60_000;

@Injectable()
export class ControlPlaneRoleManager {
  private readonly logger = new Logger(ControlPlaneRoleManager.name);
  /** The last `platformBackups` of this member, and since when they are missing (see `steadyPlatformBackups`). */
  private lastBackups: { value: NonNullable<ControlPlaneRole['platformBackups']>; missingSince: number | null } | null =
    null;
  /** Replaceable in tests. */
  now: () => number = () => Date.now();
  /** A running planned switchover (a draining member hands the Postgres leadership over, 2026-10-26). */
  private handover: Promise<void> | null = null;
  /** Replaceable in tests. */
  switchover: typeof patroniSwitchover = patroniSwitchover;
  /** The connect addresses last confirmed in the running Spilo, and when (see `syncPostgresConnect`). */
  private postgresConnect: { value: string; at: number } | null = null;
  /** A fingerprint of the role passwords last confirmed (or found on a replica), and when (`syncPostgresRolePasswords`). */
  private postgresRolePasswords: { value: string; at: number } | null = null;
  /** Applies run one at a time (the reconciler's and the fence check's). */
  private chain: Promise<unknown> = Promise.resolve();
  /** Highest database epoch seen / last fence report (`<state>/database-fence.json`), loaded on first use. */
  private fenceState: FenceState | null = null;
  /** When the data epoch was last probed, for which role epoch (see `fenceIfStale`). */
  private lastFenceProbe: { at: number; roleEpoch: number | null } | null = null;
  /** The last member apply (the periodic fence check applies it again after a fence). */
  private lastMemberApply: { nodeName: string; address: string; role: ControlPlaneRole } | null = null;
  private fenceTimer: NodeJS.Timeout | null = null;
  /** The stale-role warning, once per epoch. */
  private staleWarned: number | null = null;

  constructor(
    private readonly containers: ManagedContainers,
    private readonly state: AgentStateStore,
    private readonly leaderProxy: PostgresLeaderProxy,
    private readonly commands: CommandRunner,
  ) {}

  /** Applies the control-plane role (serialized with the periodic fence check). */
  async apply(nodeName: string, address: string, desired: ControlPlaneRole): Promise<boolean> {
    const run = this.chain.then(async () => await this.applyNow(nodeName, address, desired));

    this.chain = run.catch(() => undefined);

    return await run;
  }

  private async applyNow(nodeName: string, address: string, desired: ControlPlaneRole): Promise<boolean> {
    // A role of an older database epoch comes from a control plane on fenced data (3.43 takeover): not applied.
    const fence = await this.loadFenceState();

    if (staleRole(desired, fence.seenEpoch)) {
      if (this.staleWarned !== desired.databaseFence?.epoch) {
        this.staleWarned = desired.databaseFence?.epoch ?? null;
        this.logger.warn(
          `Control-plane role of database epoch ${desired.databaseFence?.epoch} ignored: epoch ${fence.seenEpoch} was seen (a control plane on fenced data)`,
        );
      }

      // This member may be the one on fenced data: moved aside now, started empty with the next current role.
      if (desired.role === 'member')
        await this.fenceIfStale(desired).catch((error: unknown) =>
          this.logger.warn(`Database fence check failed: ${error instanceof Error ? error.message : String(error)}`),
        );

      return false;
    }

    if (desired.databaseFence && desired.databaseFence.epoch > fence.seenEpoch)
      await this.saveFenceState({ ...fence, seenEpoch: desired.databaseFence.epoch });

    const role = this.steadyPlatformBackups(desired);
    const wanted = new Set(componentsFor(role.role, role.database));
    let changed = false;

    for (const component of Object.keys(CONTAINER_NAMES) as ControlPlaneComponent[]) {
      if (!wanted.has(component)) changed = (await this.removeContainer(CONTAINER_NAMES[component])) || changed;
    }

    if (!wanted.has('postgres') || !role.logStore)
      changed = (await this.removeContainer(LOG_STORE_CONTAINER)) || changed;

    if (!wanted.has('postgres')) {
      changed = (await this.removePostgresClone()) || changed;
      this.postgresConnect = null;
      this.postgresRolePasswords = null;
    }

    if (wanted.size === 0) {
      this.leaderProxy.stop(true);
      this.lastMemberApply = null;

      return changed;
    }

    const ctx: MemberContext = { nodeName, address, stateDir: this.state.dir, images: controlPlaneImages() };

    changed = (await this.applyEtcd(ctx, role)) || changed;

    if (wanted.has('postgres')) {
      this.lastMemberApply = { nodeName, address, role: desired };
      this.startFenceTimer();
      await mkdir(join(ctx.stateDir, 'postgres'), { recursive: true, mode: 0o700 });
      // Data of an older database epoch is moved aside before anything else uses it (3.43 takeover).
      changed = (await this.fenceIfStale(role)) || changed;
      // Spilo runs Postgres as its `postgres` user: the mounted data directory must be theirs (initdb fails otherwise).
      await this.ownBySpilo(join(ctx.stateDir, 'postgres'));
      const tls = await ensurePostgresTls(ctx.stateDir, role.postgresTls);

      if (tls.replaced) this.logger.log('Postgres server certificate from the cluster CA installed');

      ctx.postgresTls = tls.tls;
      // Spilo reads it from its data volume: a new certificate is reloaded in place, never a re-create (2026-10-27).
      const tlsFilesChanged = await installSpiloTls(join(ctx.stateDir, 'postgres'), tls.tls, (path) =>
        this.ownBySpilo(path),
      );
      // The scope the member's data belongs to; a cut-over to a point-in-time clone switches it (3.20).
      ctx.postgresScope = await applyPostgresCutover(
        ctx.stateDir,
        nodeName,
        role,
        {
          postgres: CONTAINER_NAMES.postgres,
          clone: POSTGRES_CLONE_CONTAINER,
          remove: async (name) => await this.removeContainer(name),
        },
        (line) => this.logger.warn(line),
      );
      // Before the container: Docker would create a directory for a missing bind source.
      await installSpiloWalgConfig(ctx.stateDir);
      const postgresStarted = await this.ensureContainer(postgresSpec(ctx, role));

      // A (re-)started Spilo reads the files anyway; a running one reloads before the API verifies against the CA.
      if (tlsFilesChanged && !postgresStarted) await this.reloadPostgres();
      changed = postgresStarted || changed;
      await this.syncPostgresConnect(ctx.address, postgresStarted);
      await this.syncPostgresRolePasswords(role);
      await this.leaderProxy.ensure(role.members.filter((m) => !m.witness).map((m) => m.address));
      changed = (await this.applyPostgresClone(ctx, role)) || changed;

      await mkdir(join(ctx.stateDir, 'queue'), { recursive: true, mode: 0o700 });
      ctx.queuePassword = await localSecret(ctx.stateDir, 'queue');
      changed = (await this.ensureContainer(queueSpec(ctx))) || changed;

      // Logs before the API that writes them (3.14).
      if (role.logStore) changed = (await this.applyLogStore(ctx, role)) || changed;

      // Not before the cluster's database is on the members (3.43): the loop above removed a running replica.
      if (wanted.has('controlPlane')) changed = (await this.ensureContainer(controlPlaneApiSpec(ctx, role))) || changed;
      else this.logger.log("Control-plane API replica waits: the cluster's database isn't on the members yet");

      this.handOverIfDraining(nodeName, address, role);
    }

    await this.pruneEtcdMembers(nodeName, role).catch((error: unknown) =>
      this.logger.warn(`etcd member cleanup deferred: ${error instanceof Error ? error.message : String(error)}`),
    );

    return changed;
  }

  private async loadFenceState(): Promise<FenceState> {
    this.fenceState ??= await readFenceState(this.state.dir);

    return this.fenceState;
  }

  private async saveFenceState(state: FenceState): Promise<void> {
    this.fenceState = state;
    await writeFenceState(this.state.dir, state).catch((error: unknown) =>
      this.logger.warn(`Database fence state not persisted: ${error instanceof Error ? error.message : String(error)}`),
    );
  }

  private fenceDeps(): FenceDeps {
    return {
      stateDir: this.state.dir,
      exec: async (cmd, env) => await this.containers.exec(CONTAINER_NAMES.postgres, cmd, 'postgres', env),
      removeContainer: async (name) => await this.removeContainer(name),
      ownBySpilo: async (path) => await this.ownBySpilo(path),
      log: (line) => this.logger.warn(line),
      now: () => new Date(this.now()),
    };
  }

  /**
   * Fencing (3.43 takeover): probes the epoch of the member's data (in the running Spilo; at most every
   * `FENCE_PROBE_INTERVAL_MS`, and whenever the role's epoch changes) and fences data older than the highest epoch
   * seen: API replica stopped, rows after the takeover exported, data moved aside, empty in the takeover's scope. True
   * when it fenced. A probe that fails (Spilo not running yet) decides nothing; the periodic check tries again.
   */
  private async fenceIfStale(role: ControlPlaneRole, force = false): Promise<boolean> {
    const roleEpoch = role.databaseFence?.epoch ?? null;
    const now = this.now();

    if (
      !force &&
      this.lastFenceProbe &&
      this.lastFenceProbe.roleEpoch === roleEpoch &&
      now - this.lastFenceProbe.at < FENCE_PROBE_INTERVAL_MS
    )
      return false;

    this.lastFenceProbe = { at: now, roleEpoch };

    const probe = await probeDatabaseFence(this.fenceDeps(), role);

    return await this.fenceWith(role, probe);
  }

  private async fenceWith(role: ControlPlaneRole, probe: FenceProbe | null): Promise<boolean> {
    const state = await this.loadFenceState();
    const seen = seenEpoch(state.seenEpoch, role, probe);

    if (seen > state.seenEpoch) await this.saveFenceState({ ...state, seenEpoch: seen });

    const decision = fenceDecision({ probe, seen, role });

    if (decision.kind === 'refuse') {
      this.logger.warn(`Postgres data not fenced yet: ${decision.reason}`);

      return false;
    }

    if (decision.kind === 'none') return false;

    const report = await fenceDatabase(this.fenceDeps(), role, decision, {
      api: CONTAINER_NAMES.controlPlane,
      postgres: CONTAINER_NAMES.postgres,
    });

    await this.saveFenceState({ seenEpoch: seen, lastReport: report });
    // A fresh Spilo: its connect addresses / role passwords are checked again.
    this.postgresConnect = null;
    this.postgresRolePasswords = null;

    return true;
  }

  /**
   * Between applies (the control plane may fence an old primary at the database level without a new desired state):
   * every `FENCE_PROBE_INTERVAL_MS` the member's data is probed, and fenced data re-runs the last apply.
   */
  private startFenceTimer(): void {
    if (this.fenceTimer) return;

    this.fenceTimer = setInterval(() => void this.periodicFenceCheck(), FENCE_PROBE_INTERVAL_MS);
    this.fenceTimer.unref?.();
  }

  /** One periodic fence check (exposed for tests). */
  async periodicFenceCheck(): Promise<void> {
    const last = this.lastMemberApply;

    if (!last) return;

    const run = this.chain.then(
      async () => await this.fenceWith(last.role, await probeDatabaseFence(this.fenceDeps(), last.role)),
    );

    this.chain = run.catch(() => undefined);

    try {
      // Fenced: Spilo starts again, empty in the new scope (unless that role is stale by now: then with the next one).
      if (await run) await this.apply(last.nodeName, last.address, last.role);
    } catch (error) {
      this.logger.warn(`Database fence check failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * The member's WAL-G / backup-gateway settings stay steady across a short gap (G5): while the node stays a member, a
   * role without `platformBackups` keeps the last settings for `PLATFORM_BACKUPS_GRACE_MS` — otherwise a single desired
   * state without them (seen during joins / restores: absent for ~5 s, then back) re-created Postgres and the API twice,
   * and every API request in those windows failed. A real change (other settings, or disabled backups for longer) goes
   * through as before.
   */
  private steadyPlatformBackups(role: ControlPlaneRole): ControlPlaneRole {
    if (role.role !== 'member') {
      this.lastBackups = null;

      return role;
    }

    if (role.platformBackups) {
      this.lastBackups = { value: role.platformBackups, missingSince: null };

      return role;
    }

    if (!this.lastBackups) return role;

    const now = this.now();

    this.lastBackups.missingSince ??= now;

    if (now - this.lastBackups.missingSince >= PLATFORM_BACKUPS_GRACE_MS) {
      this.lastBackups = null;

      return role;
    }

    if (this.lastBackups.missingSince === now)
      this.logger.warn('desired state without platformBackups for this member: keeping the last settings for now');

    return { ...role, platformBackups: this.lastBackups.value };
  }

  /**
   * A draining member keeps its membership (user decision 2026-10-26 "keep membership, hand over"): if its Postgres
   * leads, the leadership goes to a member that doesn't drain — a planned Patroni switchover instead of the failover a
   * removed member caused. In the background (the reconcile goes on), one at a time; a failure is logged and the next
   * reconcile tries again. Nothing to do when this member is a replica or no other member is there.
   */
  private handOverIfDraining(nodeName: string, address: string, role: ControlPlaneRole): void {
    const self = role.members.find((m) => m.name === nodeName);
    const candidate = role.members.find((m) => m.name !== nodeName && !m.witness && !m.draining && m.address);

    if (!self?.draining || !candidate || this.handover) return;

    this.handover = this.switchover(address, candidate.address)
      .then(() => this.logger.log(`Draining: the Postgres leadership is with ${candidate.name} (or was never here)`))
      .catch((error: unknown) =>
        this.logger.warn(
          `Draining: Postgres switchover to ${candidate.name} failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
      )
      .finally(() => (this.handover = null));
  }

  /** The running planned switchover, if any (tests). */
  pendingHandover(): Promise<void> | null {
    return this.handover;
  }

  /**
   * Point-in-time restore of the control-plane database into a new scope, side by side (3.20): runs while the
   * control plane asks for it on this member; a different restore starts from an empty data directory, and the
   * directory goes away with the clone.
   */
  private async applyPostgresClone(ctx: MemberContext, role: ControlPlaneRole): Promise<boolean> {
    const dir = join(ctx.stateDir, 'postgres-pitr');
    const spec = postgresCloneSpec(ctx, role, dir, LOCAL_ETCD_HOSTS);
    const clone = role.platformBackups?.postgresClone;

    // A clone being adopted by a cut-over is the member's database now (or is about to become it): never touched here.
    if (clone && role.platformBackups?.postgresCutover?.id === clone.id) return false;

    if (!spec || !clone) return await this.removePostgresClone();

    const marker = (await readFile(join(dir, CLONE_MARKER), 'utf8').catch(() => '')).trim();

    if (marker !== clone.id) {
      await this.removeContainer(POSTGRES_CLONE_CONTAINER);
      await rm(dir, { recursive: true, force: true });
      await mkdir(dir, { recursive: true, mode: 0o700 });
      await this.ownBySpilo(dir);
      await writeFile(join(dir, CLONE_MARKER), `${clone.id}\n`, { mode: 0o600 });
      this.logger.log(`Starting point-in-time clone ${clone.id} into scope ${clone.scope}`);
    }

    return await this.ensureContainer(spec);
  }

  /**
   * Postgres re-reads its configuration and certificate files on SIGHUP (no restart, no read-only window). Best
   * effort: Spilo's own `SSL_TEST_RELOAD` check reloads a changed certificate within 5 minutes anyway.
   */
  /**
   * Patroni's connect addresses = the member's overlay address (3.43, see `postgresConnectEnvironment`). A container
   * the spec just (re-)created has them from its environment; a running one gets them in place and Patroni reloads.
   * Checked again after `POSTGRES_CONNECT_RECHECK_MS` (a restart regenerates Spilo's config from the environment of
   * a container created before). A failure is logged and retried on the next reconcile.
   */
  private async syncPostgresConnect(address: string, started: boolean): Promise<void> {
    const connect = postgresConnectEnvironment(address);
    const value = JSON.stringify(connect);

    if (Object.keys(connect).length === 0) return;

    if (started) {
      this.postgresConnect = { value, at: this.now() };

      return;
    }

    if (this.postgresConnect?.value === value && this.now() - this.postgresConnect.at < POSTGRES_CONNECT_RECHECK_MS)
      return;

    try {
      const code = await this.containers.exec(
        CONTAINER_NAMES.postgres,
        postgresConnectSyncCommand(connect),
        'postgres',
      );

      if (code === 0 || code === POSTGRES_CONNECT_CHANGED_EXIT) {
        if (code !== 0) this.logger.log(`Patroni connect addresses set to ${address} (reloaded in place)`);
        this.postgresConnect = { value, at: this.now() };
      } else this.logger.warn(`Patroni connect addresses not set (exit ${code}); retrying on the next reconcile`);
    } catch (error) {
      this.logger.warn(`Patroni connect addresses not set: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * The passwords of Spilo's `standby` / `admin` roles follow the member's environment (user decision 2026-10-30):
   * Spilo sets them only when it bootstraps a data directory, so the leader's agent sets changed ones itself
   * (`POSTGRES_ROLE_PASSWORDS_COMMAND`; replicas get them through replication). Checked once per new value, then
   * again after `POSTGRES_CONNECT_RECHECK_MS` (the leadership may move); a failure (e.g. Postgres still starting) is
   * retried on the next reconcile. Neither the values nor the statement are logged.
   */
  private async syncPostgresRolePasswords(role: ControlPlaneRole): Promise<void> {
    const env = postgresRolePasswordsExecEnvironment(role);

    if (Object.keys(env).length === 0) {
      this.postgresRolePasswords = null;

      return;
    }

    const value = createHash('sha256').update(JSON.stringify(env)).digest('hex');

    if (
      this.postgresRolePasswords?.value === value &&
      this.now() - this.postgresRolePasswords.at < POSTGRES_CONNECT_RECHECK_MS
    )
      return;

    try {
      const code = await this.containers.exec(
        CONTAINER_NAMES.postgres,
        POSTGRES_ROLE_PASSWORDS_COMMAND,
        'postgres',
        env,
      );

      if (
        code === 0 ||
        code === POSTGRES_ROLE_PASSWORDS_CHANGED_EXIT ||
        code === POSTGRES_ROLE_PASSWORDS_REPLICA_EXIT
      ) {
        if (code === POSTGRES_ROLE_PASSWORDS_CHANGED_EXIT)
          this.logger.log('Postgres replication / admin role passwords updated on the leader');
        this.postgresRolePasswords = { value, at: this.now() };
      } else this.logger.warn(`Postgres role passwords not checked (exit ${code}); retrying on the next reconcile`);
    } catch (error) {
      this.logger.warn(
        `Postgres role passwords not checked: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async reloadPostgres(): Promise<void> {
    try {
      const code = await this.containers.exec(CONTAINER_NAMES.postgres, POSTGRES_RELOAD_COMMAND, 'postgres');

      if (code === 0) this.logger.log('Postgres reloaded (new server certificate)');
      else this.logger.warn(`Postgres reload exited with ${code}; Spilo reloads the certificate within 5 minutes`);
    } catch (error) {
      this.logger.warn(`Postgres reload failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Spilo's `postgres` user owns its data directory (the agent runs as root; tests don't). */
  private async ownBySpilo(dir: string): Promise<void> {
    await chown(dir, SPILO_UID, SPILO_GID).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EPERM' || process.getuid?.() === 0) throw error;
    });
  }

  private async removePostgresClone(): Promise<boolean> {
    const removed = await this.removeContainer(POSTGRES_CLONE_CONTAINER);

    await rm(join(this.state.dir, 'postgres-pitr'), { recursive: true, force: true });

    return removed;
  }

  private async applyLogStore(ctx: MemberContext, role: ControlPlaneRole): Promise<boolean> {
    const dataDir = join(ctx.stateDir, 'opensearch');

    await mkdir(dataDir, { recursive: true, mode: 0o700 });
    await chown(dataDir, OPENSEARCH_UID, OPENSEARCH_UID);

    // A cluster bound to the overlay enforces the bootstrap checks; one of them is this kernel setting.
    if (role.members.filter((m) => !m.witness).length > 1) {
      const current = Number((await readFile('/proc/sys/vm/max_map_count', 'utf8').catch(() => '0')).trim());

      if (current < MIN_MAX_MAP_COUNT) {
        await this.commands.run('sysctl', ['-w', `vm.max_map_count=${MIN_MAX_MAP_COUNT}`]);
        // Also after a reboot, before the container starts again.
        await writeFile(
          '/etc/sysctl.d/90-loadweaver-log-store.conf',
          `vm.max_map_count = ${MIN_MAX_MAP_COUNT}\n`,
        ).catch((error: unknown) => this.logger.warn(`vm.max_map_count not persisted: ${String(error)}`));
      }
    }

    return await this.containers.ensure(logStoreSpec(ctx.nodeName, ctx.address, role, dataDir, openSearchImage()));
  }

  private async applyEtcd(ctx: MemberContext, role: ControlPlaneRole): Promise<boolean> {
    const dataDir = join(ctx.stateDir, 'etcd');
    const peerUrl = etcdPeerUrl(ctx.address);

    await mkdir(dataDir, { recursive: true, mode: 0o700 });

    if (await isEmptyDir(dataDir)) {
      const others = role.members.filter((m) => m.name !== ctx.nodeName);

      // A new cluster of only this member: picked by the control plane while no member holds etcd data (3.43), even
      // with other members listed; older control planes: only when it is the sole member.
      if (role.etcd ? role.etcd.bootstrap : others.length === 0) {
        this.logger.log('Bootstrapping a new etcd cluster on this member');

        return await this.ensureContainer(etcdSpec(ctx, role, 'new', `${ctx.nodeName}=${peerUrl}`));
      }

      // Join the existing cluster through a reachable member holding etcd data (any member for older control planes).
      const peers = role.etcd ? others.filter((m) => role.etcd?.peers.includes(m.name)) : others;

      for (const member of peers) {
        try {
          const members = await addMember(etcdClientUrl(member.address), peerUrl);

          return await this.ensureContainer(
            etcdSpec(ctx, role, 'existing', initialClusterFrom(members, { name: ctx.nodeName, peerUrl })),
          );
        } catch {
          // try the next member
        }
      }

      throw new EtcdJoinPendingError(
        peers.length === 0
          ? 'waiting for the etcd bootstrap: no member holds etcd data yet and the control plane did not pick this member to start it'
          : `no etcd member reachable to join the control plane (tried ${peers.map((m) => m.name).join(', ')}); not bootstrapping on its own`,
      );
    }

    // Existing member: keep the advertised peer URL in sync (e.g. loopback → overlay after bootstrap).
    const members = await listMembers(etcdClientUrl('127.0.0.1')).catch(() => []);
    const self = members.find((m) => m.name === ctx.nodeName);

    if (self && self.peerURLs?.[0] !== peerUrl) {
      await updateMemberPeerUrl(etcdClientUrl('127.0.0.1'), self.ID, peerUrl);
    }

    return await this.ensureContainer(
      etcdSpec(ctx, role, 'existing', initialClusterFrom(members, { name: ctx.nodeName, peerUrl })),
    );
  }

  /** The lowest-named member removes etcd members that are no longer voters, one at a time. */
  private async pruneEtcdMembers(nodeName: string, role: ControlPlaneRole): Promise<void> {
    const voters = role.members.map((m) => m.name).sort();

    if (voters[0] !== nodeName) return;

    const members = await listMembers(etcdClientUrl('127.0.0.1'));
    const stale = members.find((m) => m.name && !voters.includes(m.name));

    if (stale) {
      this.logger.log(`Removing etcd member ${stale.name}`);
      await removeMember(etcdClientUrl('127.0.0.1'), stale.ID);
    }
  }

  private async ensureContainer(spec: ContainerSpec): Promise<boolean> {
    return await this.containers.ensure(spec);
  }

  private async removeContainer(name: string): Promise<boolean> {
    return await this.containers.remove(name);
  }
}
