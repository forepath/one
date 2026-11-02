import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  agentMessage,
  migrationChannel,
  volumeDockerName,
  type CheckpointRuntime,
  type ControlPlanePayload,
  type Envelope,
  type MigrationAbort,
  type MigrationCommit,
  type MigrationFreeze,
  type MigrationPrecopy,
  type MigrationPrepare,
  type MigrationProgress,
  type MigrationReportPhase,
  type MigrationRestore,
  type TransferEndpoint,
  type WorkloadSpec,
} from '@forepath/loadweaver/shared/util-agent-protocol';
import { Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';

import { CommandRunner } from '../host/command-runner';
import { IsolationProbeService } from '../host/isolation-probe.service';
import { KeptAddressPlugin } from '../network/kept-address.plugin';
import { AgentStateStore, stateDir } from '../state/agent-state.store';
import { drbdHost, drbdResourceName } from '../volumes/drbd.renderer';
import { VolumeManager } from '../volumes/volume.manager';
import { CheckpointManager, type CheckpointSource } from '../workloads/checkpoint.manager';
import { RestoredRuntime } from '../workloads/restored-runtime';
import { WorkloadManager } from '../workloads/workload.manager';
import { MigrationSessions } from './migration-sessions';
import { TransferFirewall } from './transfer-firewall';
import { sendCheckpointBatch, TransferService, type TransferCredentials } from './transfer.service';

/**
 * The node side of live migration (3.10): executes the control plane's session commands (`migration.ts` in the
 * agent protocol) and reports `migrationProgress` on the session's channel. Every command is idempotent per
 * (migration, attempt, type): a repeated command re-reports the current state instead of running twice.
 *
 * Source (runc): pre-dump rounds streamed to the target → freeze: stateless replicas are paused, cut off the
 * network and dumped with their tasks left alive (resume = reconnect + unpause, never killed before the commit);
 * replicas with replicated volumes are dumped and stopped by CRIU so their volumes can be demoted (resume = restore
 * of the local dump) → the final dump + writable layer go to the target. gVisor (stop-and-copy): cut off the network,
 * `runsc checkpoint` (the sandbox saves memory, root filesystem writes and its network stack, then exits) → the image
 * and the container's OCI `process` go to the target; resume = restore of the local image.
 * Target: transfer endpoint + placeholder container at `prepare`, restore into it at `restore` (`restored-runtime.ts`).
 */

type Role = 'source' | 'target';

interface SessionBase {
  role: Role;
  migration: string;
  attempt: number;
  replica: string;
  channel: string;
  dir: string;
  state: string;
  error?: string;
}

interface SourceSession extends SessionBase {
  role: 'source';
  target: string;
  endpoint: TransferEndpoint;
  token: string;
  rounds: number;
  lastRound: string | null;
  totalBytes: number;
  lastBytes?: number;
  dirtyBytesPerSecond?: number;
  containerId?: string;
  runtime?: CheckpointRuntime;
  hostInterface?: string | null;
  routes?: string[][];
  restartPolicy?: string;
  /** How the source waits for commit / abort: tasks paused (alive) or stopped by the dump. */
  frozen?: 'paused' | 'stopped' | null;
  volumes: string[];
  freezeStartedAt?: number;
  freezeMs?: number;
  dumpBytes?: number;
  resumed?: boolean;
}

interface TargetSession extends SessionBase {
  role: 'target';
  source: string;
  token: string;
  runtime: CheckpointRuntime;
  spec: WorkloadSpec;
  addresses: string[];
  endpoint?: TransferEndpoint;
  holderId?: string;
  freezeMs?: number;
  expiresInSeconds: number;
}

type Session = SourceSession | TargetSession;

/** Session data on disk, for the commands after an agent restart (the transfer endpoint itself is gone then). */
interface Persisted {
  session: Session;
}

export function migrationsDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(stateDir(env), 'migrations');
}

const PHASE_OF = {
  migrationPrepare: 'prepare',
  migrationPrecopy: 'precopy',
  migrationFreeze: 'freeze',
  migrationRestore: 'restore',
  migrationCommit: 'commit',
  migrationAbort: 'abort',
} as const;

export type MigrationCommandType = keyof typeof PHASE_OF;

/** How long the target waits for the control plane to hand it the volumes (desired state) at restore. */
const VOLUME_WAIT_MS = 60_000;
/** How long the source waits for its volumes after an abort before giving up the local resume. */
const RESUME_VOLUME_WAIT_MS = 10_000;

function messageOf(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2000);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface DrbdPeerStatus {
  connections?: { name: string; 'connection-state'?: string; 'peer-role'?: string }[];
}

/**
 * Whether the source may promote a replicated volume again after an aborted attempt (never two primaries): the
 * target is connected and no longer primary (it demoted at its abort), or — target unreachable — the volume has a
 * quorum (≥ 3 replicas: a cut-off target without quorum suspends its I/O, DRBD `quorum majority`). With two replicas
 * and an unreachable target nothing proves the target stopped writing, so the source stays down and the control
 * plane's fallback / failover decides.
 */
export function peerReleased(status: DrbdPeerStatus | undefined, peerHost: string, replicas: number): boolean {
  const connection = status?.connections?.find((c) => c.name === peerHost);

  if (connection?.['connection-state'] === 'Connected') return connection['peer-role'] !== 'Primary';

  return replicas >= 3;
}

@Injectable()
export class MigrationService implements OnModuleDestroy {
  private readonly logger = new Logger(MigrationService.name);
  private send: ((envelope: Envelope) => unknown) | null = null;
  private readonly sessions = new Map<string, Session>();
  private readonly tasks = new Map<string, Promise<void>>();
  private readonly cancelled = new Set<string>();
  private readonly firewall: TransferFirewall;

  constructor(
    private readonly state: AgentStateStore,
    private readonly commands: CommandRunner,
    private readonly workloads: WorkloadManager,
    private readonly checkpoints: CheckpointManager,
    private readonly restored: RestoredRuntime,
    private readonly transfer: TransferService,
    private readonly registry: MigrationSessions,
    private readonly volumes: VolumeManager,
    private readonly kept: KeptAddressPlugin,
    @Optional() private readonly isolation?: IsolationProbeService,
  ) {
    this.firewall = new TransferFirewall(commands);
  }

  private async assertKvmRestore(): Promise<void> {
    if (!this.isolation) return;

    if (await this.isolation.optedOut())
      throw new Error('KVM is disabled on this node: a gVisor KVM checkpoint is restored on the same platform only');

    const level = (await this.isolation.current()).levels['sandboxed-kvm'];

    if (level && level.state !== 'ready')
      throw new Error(
        `no gVisor KVM platform on this node (${level.state}): a KVM checkpoint is restored on the same platform only`,
      );
  }

  attach(send: (envelope: Envelope) => unknown): void {
    this.send = send;
  }

  onModuleDestroy(): void {
    for (const key of this.sessions.keys()) this.cancelled.add(key);
  }

  private static key(role: Role, migration: string, attempt: number): string {
    return `${role}:${migration}#${attempt}`;
  }

  /**
   * At agent start: the kept-address network plugin (Docker needs it before it restarts replicas with kept addresses)
   * and the sessions of a previous agent process (crash / update), reloaded so commit and abort still work.
   */
  async recover(): Promise<void> {
    await this.kept
      .start()
      .catch((error: unknown) => this.logger.warn(`Kept-address network plugin unavailable: ${messageOf(error)}`));
    await this.firewall.flush();

    for (const name of await readdir(migrationsDir()).catch(() => [] as string[])) {
      const raw = await readFile(join(migrationsDir(), name, 'session.json'), 'utf8').catch(() => null);

      if (!raw) continue;

      const { session } = JSON.parse(raw) as Persisted;

      this.sessions.set(MigrationService.key(session.role, session.migration, session.attempt), session);
      this.registry.begin(session.replica);
      this.logger.log(`Recovered ${session.role} session of ${session.replica} (${session.state})`);
    }
  }

  /** Entry point for the session commands (agent connection, VM lab driver). */
  async handle(type: MigrationCommandType, payload: ControlPlanePayload<MigrationCommandType>): Promise<void> {
    try {
      switch (type) {
        case 'migrationPrepare':
          return this.prepare(payload as MigrationPrepare);
        case 'migrationPrecopy':
          return this.precopy(payload as MigrationPrecopy);
        case 'migrationFreeze':
          return this.freeze(payload as MigrationFreeze);
        case 'migrationRestore':
          return this.restore(payload as MigrationRestore);
        case 'migrationCommit':
          return await this.commit(payload as MigrationCommit);
        case 'migrationAbort':
          return await this.abort(payload as MigrationAbort);
      }
    } catch (error) {
      const p = payload as { migration: string; attempt: number; replica: string };

      this.report(
        { migration: p.migration, attempt: p.attempt, replica: p.replica, channel: migrationChannel(p.migration) },
        PHASE_OF[type],
        { status: 'failed', error: messageOf(error) },
      );
    }
  }

  // Reporting.

  private report(
    session: Pick<SessionBase, 'migration' | 'attempt' | 'replica' | 'channel'>,
    phase: MigrationReportPhase,
    fields: Omit<MigrationProgress, 'migration' | 'attempt' | 'replica' | 'phase'>,
  ): void {
    const payload: MigrationProgress = {
      migration: session.migration,
      attempt: session.attempt,
      replica: session.replica,
      phase,
      ...fields,
      ...(fields.error ? { error: fields.error.slice(0, 2048) } : {}),
    };

    this.send?.(agentMessage('migrationProgress', payload, { channel: session.channel }));
  }

  private async persist(session: Session): Promise<void> {
    await mkdir(session.dir, { recursive: true, mode: 0o700 });

    const file = join(session.dir, 'session.json');
    const tmp = `${file}.tmp`;

    await writeFile(tmp, JSON.stringify({ session } satisfies Persisted), { mode: 0o600 });
    await rename(tmp, file);
  }

  /** Runs one step of a session in the background (single flight per session). */
  private run(key: string, work: () => Promise<void>): void {
    const previous = this.tasks.get(key) ?? Promise.resolve();
    const next = previous.then(work).catch((error: unknown) => this.logger.warn(`${key}: ${messageOf(error)}`));

    this.tasks.set(key, next);
  }

  private async credentials(): Promise<TransferCredentials> {
    const [identity, credentials] = await Promise.all([this.state.identity(), this.state.credentials()]);

    if (!identity || !credentials) throw new Error('node identity missing');

    return { clusterId: identity.clusterId, ...credentials };
  }

  private async sendBatch(session: SourceSession, batch: string, paths: string[]): Promise<number> {
    return await sendCheckpointBatch({
      endpoint: session.endpoint,
      credentials: await this.credentials(),
      peer: session.target,
      token: session.token,
      migration: session.migration,
      attempt: session.attempt,
      batch,
      root: session.dir,
      paths,
    });
  }

  private sessionDir(role: Role, migration: string, attempt: number): string {
    return join(migrationsDir(), `${migration}-${attempt}-${role}`);
  }

  // Target: prepare.

  private prepare(payload: MigrationPrepare): void {
    const key = MigrationService.key('target', payload.migration, payload.attempt);
    const existing = this.sessions.get(key) as TargetSession | undefined;
    const channel = migrationChannel(payload.migration);

    if (existing) {
      if (existing.endpoint && existing.state === 'prepared')
        this.report(existing, 'prepare', { status: 'done', endpoint: existing.endpoint });
      else if (existing.state === 'failed')
        this.report(existing, 'prepare', { status: 'failed', error: existing.error });
      else this.report(existing, 'prepare', { status: 'running' });

      return;
    }

    const session: TargetSession = {
      role: 'target',
      migration: payload.migration,
      attempt: payload.attempt,
      replica: payload.replica,
      channel,
      dir: this.sessionDir('target', payload.migration, payload.attempt),
      state: 'preparing',
      source: payload.source,
      token: payload.token,
      runtime: payload.runtime,
      spec: payload.spec,
      addresses: payload.addresses,
      expiresInSeconds: payload.expiresInSeconds,
    };

    this.sessions.set(key, session);
    this.registry.begin(session.replica);
    this.report(session, 'prepare', { status: 'running' });
    this.run(key, async () => {
      try {
        const applied = await this.state.appliedState();
        const overlay = applied?.network.addresses ?? [];
        const address = overlay.find((a) => !a.includes(':')) ?? overlay[0];

        if (!address) throw new Error('this node has no overlay address yet');

        const peerAddresses = applied?.network.wireguard.find((l) => l.peer === session.source)?.peerAddresses ?? [];
        const endpoint = await this.transfer.open({
          migration: session.migration,
          attempt: session.attempt,
          token: session.token,
          peer: session.source,
          dir: session.dir,
          expiresInSeconds: session.expiresInSeconds,
          address,
          credentials: await this.credentials(),
        });

        if (peerAddresses.length > 0)
          await this.firewall.allow('input', peerAddresses, endpoint.port, session.migration);

        // A gVisor-KVM checkpoint is restored on the KVM platform only (M7.1): refused here when this node opted out
        // of KVM or its sandboxed-kvm level isn't ready (the control plane's eligibility checks the same; G5).
        if (session.runtime === 'runsc' && session.spec.isolation === 'sandboxed-kvm') await this.assertKvmRestore();

        // The replica as this node will run it, with the kept addresses; created now, started at restore.
        const spec: WorkloadSpec = { ...session.spec, addresses: session.addresses };
        const options = await this.workloads.createOptions(spec, this.workloads.dnsServers(), applied?.registryClient);

        if (!options) throw new Error(`image ${spec.image} is blocked by an image policy on this node`);

        session.holderId = await this.restored.createHolder(options, session.migration);

        // gVisor: its binaries come from disk at the first restore; read them now, not during the freeze.
        if (session.runtime === 'runsc')
          await this.restored.prewarm(session.spec.isolation === 'sandboxed-kvm' ? 'kvm' : 'systrap');
        session.endpoint = endpoint;
        session.state = 'prepared';
        await this.persist(session);
        this.report(session, 'prepare', { status: 'done', endpoint });
      } catch (error) {
        session.state = 'failed';
        session.error = messageOf(error);
        await this.persist(session).catch(() => undefined);
        this.report(session, 'prepare', { status: 'failed', error: session.error });
      }
    });
  }

  // Source: pre-copy.

  private sourceSession(
    payload: MigrationPrecopy | MigrationFreeze,
    volumes: string[],
  ): { session: SourceSession; created: boolean } {
    const key = MigrationService.key('source', payload.migration, payload.attempt);
    const existing = this.sessions.get(key) as SourceSession | undefined;

    if (existing) return { session: existing, created: false };

    const session: SourceSession = {
      role: 'source',
      migration: payload.migration,
      attempt: payload.attempt,
      replica: payload.replica,
      channel: migrationChannel(payload.migration),
      dir: this.sessionDir('source', payload.migration, payload.attempt),
      state: 'idle',
      target: payload.target,
      endpoint: payload.endpoint,
      token: payload.token,
      rounds: 0,
      lastRound: null,
      totalBytes: 0,
      volumes,
    };

    this.sessions.set(key, session);
    this.registry.begin(session.replica);

    return { session, created: true };
  }

  private async locate(session: SourceSession): Promise<CheckpointSource> {
    const container = await this.workloads.containerOf(session.replica);

    if (!container) throw new Error(`replica ${session.replica} doesn't run on this node`);

    const source = await this.checkpoints.locate(container.Id);

    session.containerId = source.dockerId;
    session.runtime = source.runtime;

    return source;
  }

  private async allowOutput(session: SourceSession): Promise<void> {
    await this.firewall.allow('output', [session.endpoint.address], session.endpoint.port, session.migration);
  }

  private precopy(payload: MigrationPrecopy): void {
    const { session } = this.sourceSession(payload, []);
    const key = MigrationService.key('source', session.migration, session.attempt);

    if (session.state !== 'idle') {
      const done = session.state !== 'precopy';

      this.report(session, 'precopy', {
        status: session.state === 'failed' ? 'failed' : done ? 'done' : 'running',
        round: session.rounds,
        totalBytes: session.totalBytes,
        ...(session.error ? { error: session.error } : {}),
      });

      return;
    }

    session.state = 'precopy';
    this.report(session, 'precopy', { status: 'running', round: 0 });
    this.run(key, async () => {
      try {
        await this.allowOutput(session);

        const source = await this.locate(session);

        // gVisor has no pre-dump: its freeze is the whole copy.
        if (source.runtime === 'runc') {
          let previousStart: number | null = null;

          for (let round = 1; round <= payload.maxRounds; round++) {
            if (this.cancelled.has(key)) return;

            const started = Date.now();
            const dir = `p${round}`;
            const dump = await this.checkpoints.preDump(
              source,
              join(session.dir, dir),
              session.lastRound ? `../${session.lastRound}` : null,
            );
            const sent = await this.sendBatch(session, dir, [dir]);

            session.rounds = round;
            session.lastRound = dir;
            session.totalBytes += sent;
            session.lastBytes = dump.bytes;
            session.dirtyBytesPerSecond =
              previousStart === null
                ? undefined
                : Math.round(dump.bytes / Math.max(0.001, (started - previousStart) / 1000));
            previousStart = started;
            await this.persist(session);
            this.report(session, 'precopy', {
              status: 'running',
              round,
              bytes: dump.bytes,
              totalBytes: session.totalBytes,
              ...(session.dirtyBytesPerSecond !== undefined
                ? { dirtyBytesPerSecond: session.dirtyBytesPerSecond }
                : {}),
            });

            if (round > 1 && dump.bytes <= payload.convergeBytes) break;
          }
        }

        session.state = 'precopied';
        await this.persist(session);
        this.report(session, 'precopy', {
          status: 'done',
          round: session.rounds,
          ...(session.lastBytes !== undefined ? { bytes: session.lastBytes } : {}),
          totalBytes: session.totalBytes,
          ...(session.dirtyBytesPerSecond !== undefined ? { dirtyBytesPerSecond: session.dirtyBytesPerSecond } : {}),
        });
      } catch (error) {
        session.state = 'failed';
        session.error = messageOf(error);
        await this.persist(session).catch(() => undefined);
        this.report(session, 'precopy', { status: 'failed', error: session.error });
      }
    });
  }

  // Source: freeze + transfer.

  private freeze(payload: MigrationFreeze): void {
    const { session } = this.sourceSession(payload, payload.volumes);
    const key = MigrationService.key('source', session.migration, session.attempt);

    session.volumes = payload.volumes;

    if (['freezing', 'frozen', 'transferred', 'failed', 'resumed'].includes(session.state)) {
      this.reportFreezeState(session);

      return;
    }

    session.state = 'freezing';
    this.report(session, 'freeze', { status: 'running' });
    this.run(key, async () => {
      let phase: 'freeze' | 'transfer' = 'freeze';

      try {
        await this.allowOutput(session);

        const source = await this.locate(session);
        const stateful = session.volumes.length > 0;
        const started = Date.now();

        session.freezeStartedAt = started;
        session.restartPolicy = source.restartPolicy;
        // Docker must neither restart stopped tasks nor re-mount a volume that moves away.
        await this.checkpoints.setRestartPolicy(source.dockerId, 'no');

        if (source.runtime === 'runc' && !stateful) {
          await this.checkpoints.pause(source.dockerId);
          session.frozen = 'paused';
        }

        session.hostInterface = await this.checkpoints.hostInterface(source.pid);
        session.routes = session.hostInterface ? await this.checkpoints.disconnect(session.hostInterface) : [];
        await this.persist(session);

        const finalDir = join(session.dir, 'final');
        const paths = ['final', 'meta.json'];

        // gVisor validates the restore spec against the checkpointed one: the target presents this process.
        if (source.runtime === 'runsc') {
          await writeFile(
            join(session.dir, 'process.json'),
            JSON.stringify(await this.checkpoints.ociProcess(source)),
            {
              mode: 0o600,
            },
          );
          paths.push('process.json');
        }

        const dump =
          source.runtime === 'runsc'
            ? await this.checkpoints.runscCheckpoint(source, finalDir)
            : await this.checkpoints.dump(source, finalDir, {
                parent: session.lastRound ? `../${session.lastRound}` : null,
                leaveRunning: !stateful,
              });

        if (stateful || source.runtime === 'runsc') session.frozen = 'stopped';

        // A restored replica's placeholder still holds the volumes' mounts: it goes with the dumped process tree.
        if (stateful && source.restored) await this.workloads.killContainer(source.dockerId).catch(() => undefined);

        if (source.runtime === 'runc' && source.upperdir) {
          await this.checkpoints.tarUpper(source.upperdir, join(session.dir, 'upper.tar'));
          paths.push('upper.tar');
        }

        if (stateful) await this.demote(session);

        await writeFile(
          join(session.dir, 'meta.json'),
          JSON.stringify({ freezeStartedAt: started, runtime: source.runtime, stateful }),
        );
        session.dumpBytes = dump.bytes;
        session.freezeMs = Date.now() - started;
        session.state = 'frozen';
        await this.persist(session);

        if (dump.ms > payload.freezeBudgetMs) {
          await this.resume(session);
          throw new Error(`final dump took ${dump.ms} ms, over the freeze budget of ${payload.freezeBudgetMs} ms`);
        }

        this.report(session, 'freeze', { status: 'done', bytes: dump.bytes, freezeMs: session.freezeMs });
        phase = 'transfer';
        this.report(session, 'transfer', { status: 'running', totalBytes: session.totalBytes });

        const sent = await this.sendBatch(session, 'final', paths);

        session.totalBytes += sent;
        session.freezeMs = Date.now() - started;
        session.state = 'transferred';
        await this.persist(session);
        this.report(session, 'transfer', {
          status: 'done',
          bytes: sent,
          totalBytes: session.totalBytes,
          freezeMs: session.freezeMs,
        });
      } catch (error) {
        session.error = messageOf(error);

        if (session.state !== 'resumed') session.state = 'failed';

        await this.persist(session).catch(() => undefined);
        this.report(session, phase, { status: 'failed', error: session.error });
      }
    });
  }

  private reportFreezeState(session: SourceSession): void {
    if (session.state === 'freezing') return this.report(session, 'freeze', { status: 'running' });

    if (session.state === 'failed' || session.state === 'resumed')
      return this.report(session, 'freeze', { status: 'failed', error: session.error ?? 'freeze failed' });

    this.report(session, 'freeze', { status: 'done', bytes: session.dumpBytes, freezeMs: session.freezeMs });

    if (session.state === 'transferred')
      this.report(session, 'transfer', { status: 'done', totalBytes: session.totalBytes, freezeMs: session.freezeMs });
    else this.report(session, 'transfer', { status: 'running', totalBytes: session.totalBytes });
  }

  /** Flushes and demotes the replica's volumes after the dump stopped its tasks (the target promotes them). */
  private async demote(session: SourceSession): Promise<void> {
    // Docker unmounts a stopped container's volumes itself; wait for the container to be gone from them.
    for (let i = 0; i < 50 && session.containerId; i++) {
      const running = await this.workloads.containerOf(session.replica).then((c) => c?.State === 'running');

      if (!running) break;

      await sleep(200);
    }

    await this.commands.run('sync', []).catch(() => undefined);

    for (const volume of session.volumes) await this.volumes.unmount(volumeDockerName(volume));
  }

  // Target: restore.

  private restore(payload: MigrationRestore): void {
    const key = MigrationService.key('target', payload.migration, payload.attempt);
    const session = this.sessions.get(key) as TargetSession | undefined;

    if (!session) throw new Error('no prepared session for this attempt on this node');

    if (session.state === 'restoring') return this.report(session, 'restore', { status: 'running' });

    if (session.state === 'restored')
      return this.report(session, 'restore', { status: 'done', freezeMs: session.freezeMs });

    if (session.state === 'restore-failed')
      return this.report(session, 'restore', { status: 'failed', error: session.error });

    if (session.state !== 'prepared') throw new Error(`session is ${session.state}, not prepared`);

    session.state = 'restoring';
    this.report(session, 'restore', { status: 'running' });
    this.run(key, async () => {
      try {
        if (!session.holderId) throw new Error('placeholder container missing');

        await this.transfer.waitFor(session.migration, session.attempt, 'final', 60_000);

        const meta = JSON.parse(await readFile(join(session.dir, 'meta.json'), 'utf8')) as {
          freezeStartedAt: number;
        };

        await this.awaitVolumes(payload.volumes, VOLUME_WAIT_MS);

        if (await stat(join(session.dir, 'upper.tar')).catch(() => null))
          await this.checkpoints.applyUpper(
            join(session.dir, 'upper.tar'),
            await this.checkpoints.createdUpperdir(session.holderId),
          );

        await this.restored.restore(
          session.holderId,
          join(session.dir, 'final'),
          join(session.dir, 'restore-work'),
          session.runtime === 'runsc' ? await this.sandboxOf(session.dir) : undefined,
        );
        session.freezeMs = Math.max(0, Date.now() - meta.freezeStartedAt);
        session.state = 'restored';
        await this.persist(session);
        this.workloads.watchRestored();
        this.report(session, 'restore', { status: 'done', freezeMs: session.freezeMs });
      } catch (error) {
        session.state = 'restore-failed';
        session.error = messageOf(error);
        await this.persist(session).catch(() => undefined);
        this.report(session, 'restore', { status: 'failed', error: session.error });
      }
    });
  }

  /** The checkpointed gVisor container's OCI process (sent with the image). */
  private async sandboxOf(dir: string): Promise<{ process: unknown }> {
    return { process: JSON.parse(await readFile(join(dir, 'process.json'), 'utf8')) as unknown };
  }

  /** Waits until this node is the primary of every volume (the control plane flips them at restore). */
  private async awaitVolumes(volumes: string[], timeoutMs: number): Promise<void> {
    const node = (await this.state.identity())?.nodeName;
    const deadline = Date.now() + timeoutMs;

    for (const volume of volumes) {
      while (this.volumes.byDockerName(volumeDockerName(volume))?.primary !== node) {
        if (Date.now() > deadline) throw new Error(`volume ${volume} was not handed to this node`);

        await sleep(250);
      }
    }
  }

  // Both: commit / abort.

  private async commit(payload: MigrationCommit): Promise<void> {
    const key = MigrationService.key(payload.role, payload.migration, payload.attempt);
    const session = this.sessions.get(key);
    const base = { ...payload, channel: migrationChannel(payload.migration) };

    if (!session) return this.report(base, 'commit', { status: 'done' });

    this.cancelled.add(key);
    await this.tasks.get(key);

    if (session.role === 'source') {
      // The target runs the replica: the frozen original goes (still disconnected, so no FIN / RST leaks).
      if (session.containerId) await this.workloads.removeContainer(session.containerId, session.replica);
    } else {
      this.transfer.close(session.migration, session.attempt, 'committed');
    }

    await this.finish(key, session, payload.role === 'target');
    this.report(session, 'commit', { status: 'done' });
  }

  private async abort(payload: MigrationAbort): Promise<void> {
    const key = MigrationService.key(payload.role, payload.migration, payload.attempt);
    const session = this.sessions.get(key);
    const base = { ...payload, channel: migrationChannel(payload.migration) };

    this.cancelled.add(key);
    await this.tasks.get(key);

    if (payload.role === 'target') {
      if (session) this.transfer.close(session.migration, session.attempt, 'aborted');

      const holderId = (session as TargetSession | undefined)?.holderId;

      // Whatever was restored goes, and the volumes are demoted before the source may promote them again.
      if (holderId) await this.restored.removeReplica(holderId);

      for (const volume of payload.volumes) await this.volumes.unmount(volumeDockerName(volume));

      if (session) await this.finish(key, session, false);

      return this.report(session ?? base, 'abort', { status: 'done' });
    }

    if (!session) {
      const running = (await this.workloads.containerOf(payload.replica))?.State === 'running';

      return this.report(base, 'abort', { status: 'done', resumed: running });
    }

    const resumed = await this.resume(session as SourceSession);

    await this.finish(key, session, false);
    this.report(session, 'abort', { status: 'done', resumed });
  }

  /**
   * Brings the source back after a failed attempt: paused tasks are reconnected and thawed; tasks a dump stopped
   * (replicated volumes, gVisor) are restored from the local dump / image into a fresh placeholder (connections kept),
   * or —
   * if that fails — started again through Docker. Returns whether the replica runs again.
   */
  private async resume(session: SourceSession): Promise<boolean> {
    if (session.state === 'resumed') return session.resumed ?? true;

    const container = session.containerId;
    let resumed = false;

    try {
      if (session.frozen === 'paused' && container) {
        if (session.hostInterface) await this.checkpoints.connect(session.hostInterface, session.routes ?? []);

        await this.checkpoints.unpause(container);
        resumed = true;
      } else if (session.frozen === 'stopped' && container) {
        resumed = await this.resumeStopped(session, container);
      } else {
        if (session.hostInterface) await this.checkpoints.connect(session.hostInterface, session.routes ?? []);

        resumed = (await this.workloads.containerOf(session.replica))?.State === 'running';
      }

      if (container && session.restartPolicy && session.frozen !== 'stopped')
        await this.checkpoints.setRestartPolicy(container, session.restartPolicy).catch(() => undefined);
    } catch (error) {
      this.logger.warn(`Resuming ${session.replica} failed: ${messageOf(error)}`);
    }

    session.state = 'resumed';
    session.resumed = resumed;
    await this.persist(session).catch(() => undefined);

    return resumed;
  }

  private async resumeStopped(session: SourceSession, container: string): Promise<boolean> {
    for (const volume of session.volumes) {
      const assignment = this.volumes.byDockerName(volumeDockerName(volume));
      const peer = assignment?.replicas.find((r) => r.node === session.target);

      if (!assignment || !peer) continue;

      const status = await this.commands
        .json<DrbdPeerStatus[]>('drbdsetup', ['status', drbdResourceName(assignment), '--json'])
        .then((s) => s[0])
        .catch(() => undefined);

      if (!peerReleased(status, drbdHost(peer), assignment.replicas.length)) {
        this.logger.warn(`${session.replica} not resumed: ${session.target} may still hold ${volume} as primary`);

        return false;
      }
    }

    try {
      await this.awaitVolumes(session.volumes, RESUME_VOLUME_WAIT_MS);
    } catch (error) {
      // The volumes went to the target (restore was sent): the short-stop fallback takes over from here.
      this.logger.warn(`${session.replica} not resumed: ${messageOf(error)}`);

      return false;
    }

    const spec = this.workloads.specOf(session.replica);
    const finalDir = join(session.dir, 'final');
    const image = join(finalDir, session.runtime === 'runsc' ? 'checkpoint.img' : 'inventory.img');

    if (spec && (await stat(image).catch(() => null))) {
      try {
        const options = await this.workloads.createOptions(spec, this.workloads.dnsServers());

        if (!options) throw new Error('image blocked by policy');

        await this.workloads.removeContainer(container, session.replica);

        const holderId = await this.restored.createHolder(options, session.migration);

        if (await stat(join(session.dir, 'upper.tar')).catch(() => null))
          await this.checkpoints.applyUpper(
            join(session.dir, 'upper.tar'),
            await this.checkpoints.createdUpperdir(holderId),
          );

        await this.restored.restore(
          holderId,
          finalDir,
          join(session.dir, 'resume-work'),
          session.runtime === 'runsc' ? await this.sandboxOf(session.dir) : undefined,
        );
        this.workloads.watchRestored();

        return true;
      } catch (error) {
        this.logger.warn(`Local restore of ${session.replica} failed, starting it fresh: ${messageOf(error)}`);

        const holder = await this.workloads.containerOf(session.replica);

        if (holder) await this.workloads.removeContainer(holder.Id, session.replica);
      }
    }

    // Cold start through Docker (state lost, data on the volume kept).
    const current = await this.workloads.containerOf(session.replica);

    if (current) {
      if (session.restartPolicy) await this.checkpoints.setRestartPolicy(current.Id, session.restartPolicy);

      await this.workloads.startContainer(current.Id);

      return true;
    }

    if (!spec) return false;

    await this.workloads.createReplica(spec);

    return (await this.workloads.containerOf(session.replica))?.State === 'running';
  }

  private async finish(key: string, session: Session, restored: boolean): Promise<void> {
    await this.firewall.revoke(session.migration).catch(() => undefined);
    await rm(session.dir, { recursive: true, force: true });
    this.sessions.delete(key);
    this.tasks.delete(key);
    this.cancelled.delete(key);
    this.registry.end(session.replica, restored);
  }
}
