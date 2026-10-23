import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  agentMessage,
  migrationChannel,
  type Envelope,
  type MigrationAbort,
  type MigrationCommit,
  type MigrationProgress,
  type MigrationReportPhase,
  type TransferEndpoint,
  type VmMigrationPrepare,
  type VmMigrationStart,
  type VmMigrationSwitchover,
  type WorkloadSpec,
} from '@forepath/loadweaver/shared/util-agent-protocol';
import {
  MICROVM_RUN_CONFIG_DIR,
  MICROVM_TOOLS_DIR,
  MICROVM_VMM_UID,
} from '@forepath/shared/backend/util-microvm-bridge';
import { Inject, Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import type Docker from 'dockerode';

import { BackupJobs, type JobOutput } from '../backups/backup-jobs';
import { CommandRunner } from '../host/command-runner';
import { DOCKER } from '../host/docker.provider';
import { LiveSessionsService } from '../live/live-sessions.service';
import {
  applyPass,
  commandSyncOps,
  fdPath,
  openTree,
  parsePassMeta,
  passTarFile,
  readPassTar,
  scanPass,
  type GuestManifest,
  type GuestSyncOps,
  type PassMeta,
  type SyncMode,
} from '../microvm/guest-sync';
import { GuestVolumes } from '../microvm/guest-volumes';
import { replicaPaths, vmrootConfig } from '../microvm/rootfs-cache';
import { AgentStateStore, stateDir } from '../state/agent-state.store';
import { VmSupport } from '../vm/vm-support.service';
import { VolumeManager } from '../volumes/volume.manager';
import {
  guestVolumeList,
  MICROVM_GUEST_MOUNT,
  MICROVM_MIGRATION_SUBDIR,
  microvmRunDir,
  microvmVolumesDir,
  type GuestVolume,
} from '../workloads/workload-container';
import { upperdirFromMountinfo } from '../workloads/checkpoint.manager';
import { runtimeDir, WorkloadManager } from '../workloads/workload.manager';
import { MigrationSessions } from './migration-sessions';
import { TransferFirewall } from './transfer-firewall';
import {
  listenRelay,
  sendCheckpointBatch,
  TransferService,
  type RelayListener,
  type TransferCredentials,
} from './transfer.service';

/**
 * QEMU live migration of full VMs on this node (3.35 / M7.4, feature `vm-migration`): the node side of the control
 * plane's `vmMigrationPrepare` / `vmMigrationStart` / `vmMigrationSwitchover` and of `migrationCommit` /
 * `migrationAbort` for these sessions, with `migrationProgress` on the session's channel. Commands are idempotent per
 * (migration, attempt, type): a repeated command re-reports the current state.
 *
 * Target (prepare): the VM's disks enter the dual-primary window (`allow-two-primaries` on this side), the launcher is
 * created on the kept addresses (extra NICs on their kept-address networks) and started in incoming mode (marker
 * `migration/incoming`: it waits for the domain instead of booting, also after a restart); the transfer endpoint
 * relays the source's connections to the launcher's libvirt session socket, promoting the disks on the first one (the
 * source allowed two primaries by then). `restore` is reported once the domain runs here.
 * Source (start): disks dual-primary, Docker's restart policy off (a launcher whose domain left must not cold-boot
 * it), a relay socket in the launcher's run directory, then `vm-ctl migrate` (libvirt tunnelled p2p, auto-converge,
 * downtime limit = the freeze budget) with the job polled once a second (`precopy` running); `precopy` / `freeze`
 * done when QEMU switched over (the freeze is the measured downtime). Switchover: the guest is paused (a paused guest
 * dirties nothing, so the migration completes).
 * Commit: the source removes its launcher and demotes; both end the dual-primary window. Abort: the target destroys
 * the incoming launcher and demotes; the source cancels the job (the guest keeps running there) and ends the window
 * once the target let go. DRBD's `after-sb-*` policies stay `disconnect`.
 *
 * Generic microVMs (M7 W10b) migrate over QMP instead of libvirt's p2p (`vm-ctl qmp-migrate`, with QEMU's
 * pause-before-switchover). The target is created like any replica (image layers unpacked and verified by diffID,
 * overlay mounted, the volume directory without the volumes) and started paused with `-incoming defer`; its endpoint
 * relays to QEMU's incoming socket and applies, as they arrive, the source's guest tree passes (the writable layer
 * through the merged directory, tmpfs volumes) and the volume hand-over. The source pre-copies the guest trees
 * (file-level passes while the guest runs), then QEMU's memory. In the pre-switchover pause (guest stopped) it sends the
 * final pass; with filesystem volumes it then holds the rest of QEMU's stream in the relay, lets QEMU finish, ends the
 * volumes' virtiofsd, unmounts and demotes them and sends the hand-over (the target promotes and mounts them) before
 * the held stream goes out: the target's virtiofsd finds every path when it loads the device state, and a volume is
 * never mounted on two nodes. The target resumes the guest once the incoming migration completed; its bridge daemon
 * re-attaches (`--resync`). An abort before the hand-over resumes the guest on the source (`migrate-cancel`); after
 * the volumes' virtiofsd went it can't (resumed: false, the control plane's short stop takes over).
 *
 * Bundled microVMs (M7 F5, Agenstra's images whose launcher runs in migration mode) take the same QMP path. Their guest
 * root is the launcher container's `/guest`: the passes scan the `guest/` part of the source container's writable
 * layer (Docker's overlay upper) and are applied through the target container's `/guest`, leaving out the launchers'
 * mount points (volumes, tmpfs, secrets); tmpfs volumes as for generic microVMs. Their filesystem volumes are bound
 * from the agent's volume directory to their targets below `/guest` (`rslave`); the image root's virtiofsd holds
 * them, so the source releases them by killing its launcher once QEMU's state left (instead of `fs-release`), then
 * unmounts, demotes and hands over as above. Guest networking is QEMU user-mode: the guest's open TCP connections are
 * reset by the move (memory, processes and files move).
 */

type Role = 'source' | 'target';
/**
 * Full VM (libvirt p2p), generic or bundled microVM (QMP + guest tree pre-copy); sessions before W10b are VMs.
 */
type LauncherKind = 'vm' | 'generic' | 'bundled';

interface SessionBase {
  role: Role;
  kind?: LauncherKind;
  migration: string;
  attempt: number;
  replica: string;
  channel: string;
  dir: string;
  state: string;
  volumes: string[];
  error?: string;
}

interface TargetSession extends SessionBase {
  role: 'target';
  source: string;
  token: string;
  spec: WorkloadSpec;
  addresses: string[];
  expiresInSeconds: number;
  endpoint?: TransferEndpoint;
  promoted?: boolean;
  freezeMs?: number;
  /** MicroVMs: filesystem volumes (handed over in the freeze) and tmpfs targets (pre-copied). */
  fsVolumes?: GuestVolume[];
  tmpfsTargets?: string[];
  /** The final guest pass arrived: the freeze runs, the incoming migration is watched closely. */
  finalReceived?: boolean;
  takenOver?: boolean;
}

interface SourceSession extends SessionBase {
  role: 'source';
  target: string;
  endpoint: TransferEndpoint;
  token: string;
  containerId?: string;
  restartPolicy?: string;
  suspended?: boolean;
  round: number;
  totalBytes: number;
  dirtyBytesPerSecond?: number;
  freezeMs?: number;
  resumed?: boolean;
  /** MicroVMs: the launcher's pid (tmpfs volumes through its root), volumes and tmpfs targets. */
  pid?: number;
  /** Bundled microVMs: the launcher container's writable layer (overlay upper) and its mount points below `/guest`. */
  upper?: string;
  mountPoints?: string[];
  fsVolumes?: GuestVolume[];
  tmpfsTargets?: string[];
  /** The volumes' virtiofsd ended and the volumes were demoted here (no resume on this node any more). */
  released?: boolean;
  /** The target confirmed the volume hand-over. */
  handedOver?: boolean;
}

type Session = SourceSession | TargetSession;

const kindOf = (session: Pick<SessionBase, 'kind'>): LauncherKind => session.kind ?? 'vm';
/** Generic and bundled microVMs migrate over QMP with guest tree passes and the volume hand-over. */
const isMicrovm = (session: Pick<SessionBase, 'kind'>): boolean => kindOf(session) !== 'vm';

/** The QEMU path of a workload spec: full VM, generic or bundled microVM. */
function launcherKindOfSpec(spec: WorkloadSpec | undefined): LauncherKind | null {
  if (spec?.vm) return 'vm';

  return spec?.microvm?.mode === 'generic' || spec?.microvm?.mode === 'bundled' ? spec.microvm.mode : null;
}

/**
 * A launcher container's mount points below `/guest` (Docker's `Mounts`), relative to it: what a bundled microVM's
 * guest tree passes leave out (volumes, tmpfs, secrets, binds belong to the launcher, not to its writable layer).
 */
export function guestMountPoints(mounts: readonly { Destination?: string }[] | undefined): string[] {
  return [
    ...new Set(
      (mounts ?? [])
        .map((m) => m.Destination ?? '')
        .filter((d) => d.startsWith(`${MICROVM_GUEST_MOUNT}/`))
        .map((d) => d.slice(MICROVM_GUEST_MOUNT.length + 1).replace(/\/+$/, ''))
        .filter((d) => d !== ''),
    ),
  ].sort();
}

export type VmMigrationMessageType = 'vmMigrationPrepare' | 'vmMigrationStart' | 'vmMigrationSwitchover';

/** `vm-ctl` inside the launcher (wraps `virsh` as the VMM user). */
export const VM_CTL = `${MICROVM_TOOLS_DIR}/vm-ctl`;
/** The incoming-mode marker in a VM launcher's migration directory. */
export const INCOMING_MARKER = 'incoming';
/** The source's local end of the relay, as the launcher's libvirt sees it. */
export const PEER_SOCKET = 'peer.sock';
export const PEER_SOCKET_IN_LAUNCHER = `${MICROVM_RUN_CONFIG_DIR}/${MICROVM_MIGRATION_SUBDIR}/${PEER_SOCKET}`;
/** libvirt's session socket inside a launcher (`XDG_RUNTIME_DIR` of the VMM user, launcher-lib.sh). */
export const LAUNCHER_LIBVIRT_SOCKET = '/dev/shm/agenstra-microvm/vmm/run/libvirt/libvirt-sock';
/** QEMU's incoming migration socket in a generic microVM launcher started in incoming mode (launch-generic). */
export const LAUNCHER_INCOMING_SOCKET = '/dev/shm/agenstra-microvm/vmm/incoming.sock';
/** Batch of a generic microVM's volume hand-over (the target promotes and mounts them). */
export const HANDOVER_BATCH = 'handover';
/** Guest tree passes while the guest runs: at most this many, until one is this small. */
const GUEST_PASSES = 4;
const GUEST_CONVERGE_BYTES = 8 * 1024 ** 2;
/** What the relay may hold of QEMU's final stream during the volume hand-over (final dirty memory + device state). */
const GATE_MAX_BYTES = 2 * 1024 ** 3;
/** How long QEMU may take from the switch-over to `completed`. */
const COMPLETE_TIMEOUT_MS = 60_000;
/** Poll interval while the guest is (about to be) stopped. */
const FREEZE_POLL_MS = 100;
/** How long the end of the dual-primary window is retried (DRBD refuses while the peer is still primary). */
const SETTLE_MS = 120_000;
const SETTLE_INTERVAL_MS = 2_000;
const POLL_MS = 1_000;
const CTL_TIMEOUT_MS = 15_000;
/** How long a killed bundled launcher may take to stop (its volumes are released after it). */
const KILL_TIMEOUT_MS = 10_000;
/** The environment of a bundled launcher in migration mode (workload-container.ts). */
export const BUNDLED_MIGRATION_ENV = 'AGENSTRA_MICROVM_MIGRATION=1';

export function vmMigrationsDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(stateDir(env), 'vm-migrations');
}

/** The target launcher's libvirt session socket, reached from the host through the launcher's root (pid). */
export function launcherLibvirtSocket(pid: number): string {
  return `/proc/${pid}/root${LAUNCHER_LIBVIRT_SOCKET}`;
}

/** The target launcher's QEMU incoming socket (generic microVMs). */
export function launcherIncomingSocket(pid: number): string {
  return `/proc/${pid}/root${LAUNCHER_INCOMING_SOCKET}`;
}

function messageOf(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2000);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const UNITS: Record<string, number> = { b: 1, kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4 };

/** A migration job as `virsh domjobinfo` reports it (`--completed`: the finished job with its total downtime). */
export interface DomJobInfo {
  type?: string;
  elapsedMs?: number;
  processedBytes?: number;
  remainingBytes?: number;
  totalBytes?: number;
  dirtyBytesPerSecond?: number;
  iteration?: number;
  expectedDowntimeMs?: number;
  downtimeMs?: number;
}

/** Parses `virsh domjobinfo` (sizes with binary units, dirty rate in pages / s × page size). */
export function parseDomJobInfo(stdout: string): DomJobInfo {
  const fields = new Map<string, string>();

  for (const line of stdout.split('\n')) {
    const index = line.indexOf(':');

    if (index > 0) fields.set(line.slice(0, index).trim().toLowerCase(), line.slice(index + 1).trim());
  }

  const number = (key: string) => {
    const value = Number.parseFloat(fields.get(key) ?? '');

    return Number.isFinite(value) ? value : undefined;
  };
  const bytes = (key: string) => {
    const match = /^([\d.]+)\s*([a-z]+)?/i.exec(fields.get(key) ?? '');
    const unit = UNITS[(match?.[2] ?? 'b').toLowerCase()];

    return match && unit ? Math.round(Number.parseFloat(match[1]) * unit) : undefined;
  };
  const dirtyPages = number('dirty rate');
  const pageSize = number('page size') ?? 4096;
  const info: DomJobInfo = {
    type: fields.get('job type'),
    elapsedMs: number('time elapsed'),
    processedBytes: bytes('data processed'),
    remainingBytes: bytes('data remaining'),
    totalBytes: bytes('data total'),
    dirtyBytesPerSecond: dirtyPages === undefined ? undefined : Math.round(dirtyPages * pageSize),
    iteration: number('iteration'),
    expectedDowntimeMs: number('expected downtime'),
    downtimeMs: number('total downtime'),
  };

  return Object.fromEntries(Object.entries(info).filter(([, v]) => v !== undefined)) as DomJobInfo;
}

/** QMP `query-migrate` (`vm-ctl migrate-status`, through `virsh qemu-monitor-command`): status and memory progress. */
export interface QueryMigrate extends DomJobInfo {
  status?: string;
  error?: string;
}

export function parseQueryMigrate(stdout: string): QueryMigrate {
  let value: Record<string, unknown>;

  try {
    value = JSON.parse(stdout.trim() || '{}') as Record<string, unknown>;
  } catch {
    return {};
  }

  const result = (value['return'] ?? value) as Record<string, unknown>;
  const ram = (result['ram'] ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const dirtyPages = num(ram['dirty-pages-rate']);
  const info: QueryMigrate = {
    status: typeof result['status'] === 'string' ? result['status'] : undefined,
    error: typeof result['error-desc'] === 'string' ? result['error-desc'].slice(0, 500) : undefined,
    processedBytes: num(ram['transferred']),
    remainingBytes: num(ram['remaining']),
    totalBytes: num(ram['total']),
    dirtyBytesPerSecond:
      dirtyPages === undefined ? undefined : Math.round(dirtyPages * (num(ram['page-size']) ?? 4096)),
    iteration: num(ram['dirty-sync-count']),
    expectedDowntimeMs: num(result['expected-downtime']),
    downtimeMs: num(result['downtime']),
  };

  return Object.fromEntries(Object.entries(info).filter(([, v]) => v !== undefined)) as QueryMigrate;
}

@Injectable()
export class VmMigrationService implements OnModuleDestroy {
  private readonly logger = new Logger(VmMigrationService.name);
  private send: ((envelope: Envelope) => unknown) | null = null;
  private readonly sessions = new Map<string, Session>();
  private readonly tasks = new Map<string, Promise<void>>();
  private readonly cancelled = new Set<string>();
  private readonly relays = new Map<string, RelayListener>();
  /** Generic microVMs: per source session, what the target has of each guest tree (index 0: the writable layer). */
  private readonly manifests = new Map<string, GuestManifest[]>();
  private readonly firewall: TransferFirewall;
  private destroyed = false;
  /** The source's relay socket (replaceable in tests). */
  listenRelay: typeof listenRelay = listenRelay;
  /** Batches to the target (replaceable in tests). */
  sendBatch: typeof sendCheckpointBatch = sendCheckpointBatch;
  /** Guest tree passes (replaceable in tests). */
  syncOps: GuestSyncOps;
  /** A launcher process' `/proc` directory (its root, its mountinfo; replaceable in tests). */
  procDir = (pid: number): string => `/proc/${pid}`;
  /** Poll / retry interval scale (tests). */
  pollMs = POLL_MS;
  freezePollMs = FREEZE_POLL_MS;
  settleIntervalMs = SETTLE_INTERVAL_MS;

  constructor(
    @Inject(DOCKER) private readonly docker: Docker,
    private readonly state: AgentStateStore,
    private readonly commands: CommandRunner,
    private readonly workloads: WorkloadManager,
    private readonly transfer: TransferService,
    private readonly registry: MigrationSessions,
    private readonly volumes: VolumeManager,
    private readonly jobs: BackupJobs,
    @Optional() private readonly vms?: VmSupport,
    @Optional() private readonly guestVolumes?: GuestVolumes,
    @Optional() private readonly live?: LiveSessionsService,
  ) {
    this.firewall = new TransferFirewall(commands);
    this.syncOps = commandSyncOps(commands);
  }

  attach(send: (envelope: Envelope) => unknown): void {
    this.send = send;
  }

  onModuleDestroy(): void {
    this.destroyed = true;

    for (const key of this.sessions.keys()) this.cancelled.add(key);

    for (const relay of this.relays.values()) void relay.close().catch(() => undefined);
  }

  private static key(role: Role, migration: string, attempt: number): string {
    return `${role}:${migration}#${attempt}`;
  }

  /** Whether a commit / abort belongs to a QEMU session of this node (else the checkpoint path handles it). */
  owns(role: Role, migration: string, attempt: number): boolean {
    return this.sessions.has(VmMigrationService.key(role, migration, attempt));
  }

  /**
   * Sessions of a previous agent process (crash / update): reloaded so commit and abort still work; their disks stay
   * in the dual-primary window (no demotion / adjust by the reconcile) until then. Relays died with the process, so a
   * running migration failed and the control plane aborts it.
   */
  async recover(): Promise<void> {
    for (const name of await readdir(vmMigrationsDir()).catch(() => [] as string[])) {
      const raw = await readFile(join(vmMigrationsDir(), name, 'session.json'), 'utf8').catch(() => null);

      if (!raw) continue;

      const { session } = JSON.parse(raw) as { session: Session };

      this.sessions.set(VmMigrationService.key(session.role, session.migration, session.attempt), session);
      this.registry.begin(session.replica);

      if (isMicrovm(session)) {
        session.volumes.forEach((v) => this.volumes.holdForMigration(v));

        if (session.role === 'target') this.workloads.expectIncoming(session.replica);
      } else {
        session.volumes.forEach((v) => this.volumes.holdDualPrimary(v));

        if (session.role === 'target') this.vms?.expectIncoming(session.replica);
      }

      this.logger.log(`Recovered VM migration ${session.role} session of ${session.replica} (${session.state})`);
    }
  }

  /** Entry point for `vmMigration*` and — for sessions this service owns — `migrationCommit` / `migrationAbort`. */
  async handle(
    type: VmMigrationMessageType | 'migrationCommit' | 'migrationAbort',
    payload: VmMigrationPrepare | VmMigrationStart | VmMigrationSwitchover | MigrationCommit | MigrationAbort,
  ): Promise<void> {
    const phase: MigrationReportPhase =
      type === 'vmMigrationPrepare'
        ? 'prepare'
        : type === 'migrationCommit'
          ? 'commit'
          : type === 'migrationAbort'
            ? 'abort'
            : 'precopy';

    try {
      switch (type) {
        case 'vmMigrationPrepare':
          return this.prepare(payload as VmMigrationPrepare);
        case 'vmMigrationStart':
          return this.start(payload as VmMigrationStart);
        case 'vmMigrationSwitchover':
          return await this.switchover(payload as VmMigrationSwitchover);
        case 'migrationCommit':
          return await this.commit(payload as MigrationCommit);
        case 'migrationAbort':
          return await this.abort(payload as MigrationAbort);
      }
    } catch (error) {
      const p = payload as { migration: string; attempt: number; replica: string };

      this.report(
        { migration: p.migration, attempt: p.attempt, replica: p.replica, channel: migrationChannel(p.migration) },
        phase,
        { status: 'failed', error: messageOf(error) },
      );
    }
  }

  // Reporting and bookkeeping.

  private report(
    session: Pick<SessionBase, 'migration' | 'attempt' | 'replica' | 'channel'>,
    phase: MigrationReportPhase,
    fields: Omit<MigrationProgress, 'migration' | 'attempt' | 'replica' | 'phase'>,
  ): void {
    this.send?.(
      agentMessage(
        'migrationProgress',
        {
          migration: session.migration,
          attempt: session.attempt,
          replica: session.replica,
          phase,
          ...fields,
          ...(fields.error ? { error: fields.error.slice(0, 2048) } : {}),
        },
        { channel: session.channel },
      ),
    );
  }

  private async persist(session: Session): Promise<void> {
    await mkdir(session.dir, { recursive: true, mode: 0o700 });

    const file = join(session.dir, 'session.json');

    await writeFile(`${file}.tmp`, JSON.stringify({ session }), { mode: 0o600 });
    await rename(`${file}.tmp`, file);
  }

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

  private sessionDir(role: Role, migration: string, attempt: number): string {
    return join(vmMigrationsDir(), `${migration}-${attempt}-${role}`);
  }

  private migrationDir(replica: string): string {
    return join(microvmRunDir(runtimeDir(), replica), MICROVM_MIGRATION_SUBDIR);
  }

  /** `vm-ctl <args>` in a launcher; throws on failure / timeout. */
  private async ctl(containerId: string, args: string[], timeoutMs = CTL_TIMEOUT_MS): Promise<JobOutput> {
    const result = await this.jobs.exec(containerId, [VM_CTL, ...args], timeoutMs);

    if (result.exitCode === null)
      throw new Error(`vm-ctl ${args[0]} timed out after ${Math.round(timeoutMs / 1000)} s`);

    if (result.exitCode !== 0)
      throw new Error(`vm-ctl ${args[0]} failed (exit ${result.exitCode}): ${result.combined.trim().slice(-500)}`);

    return result;
  }

  private async domainState(containerId: string): Promise<string> {
    return (await this.ctl(containerId, ['state']).catch(() => null))?.stdout.trim().split('\n')[0]?.trim() ?? '';
  }

  /**
   * Ends the dual-primary window of `volumes` (retried while the peer is still primary, up to two minutes); a disk
   * that can't settle stays marked, so the reconcile keeps its hands off it, and is logged.
   */
  private settle(volumes: readonly string[]): Promise<void> {
    const deadline = Date.now() + SETTLE_MS;
    const left = new Set(volumes);

    const attempt = async (): Promise<void> => {
      for (const volume of [...left]) {
        try {
          await this.volumes.setDualPrimary(volume, false);
          left.delete(volume);
        } catch (error) {
          if (Date.now() > deadline || this.destroyed) {
            this.logger.warn(`${volume}: dual-primary window not closed: ${messageOf(error)}`);
            left.delete(volume);
          }
        }
      }

      if (left.size === 0) return;

      await sleep(this.settleIntervalMs);

      return attempt();
    };

    return attempt();
  }

  private async finish(key: string, session: Session, restored: boolean): Promise<void> {
    await this.relays
      .get(key)
      ?.close()
      .catch(() => undefined);
    this.relays.delete(key);
    await this.firewall.revoke(session.migration).catch(() => undefined);
    await rm(session.dir, { recursive: true, force: true });
    this.sessions.delete(key);
    this.tasks.delete(key);
    this.cancelled.delete(key);
    this.manifests.delete(key);

    if (isMicrovm(session)) session.volumes.forEach((v) => this.volumes.endMigrationHold(v));

    this.registry.end(session.replica, restored);
  }

  // Target: prepare.

  private prepare(payload: VmMigrationPrepare): void {
    const key = VmMigrationService.key('target', payload.migration, payload.attempt);
    const existing = this.sessions.get(key) as TargetSession | undefined;

    if (existing) {
      if (existing.state === 'failed') this.report(existing, 'prepare', { status: 'failed', error: existing.error });
      else if (existing.endpoint && existing.state !== 'preparing')
        this.report(existing, 'prepare', { status: 'done', endpoint: existing.endpoint });
      else this.report(existing, 'prepare', { status: 'running' });

      if (existing.state === 'restored')
        this.report(existing, 'restore', {
          status: 'done',
          ...(existing.freezeMs !== undefined ? { freezeMs: existing.freezeMs } : {}),
        });

      return;
    }

    // Bundled microVMs: the target's launcher must run in migration mode (its image declares it), else the
    // replica's creation fails below (prepareMicrovm refuses an incoming bundled image without an incoming mode).
    const kind = launcherKindOfSpec(payload.spec);

    if (!kind) throw new Error('only full VMs and microVMs migrate through QEMU');

    const session: TargetSession = {
      role: 'target',
      kind,
      migration: payload.migration,
      attempt: payload.attempt,
      replica: payload.replica,
      channel: migrationChannel(payload.migration),
      dir: this.sessionDir('target', payload.migration, payload.attempt),
      state: 'preparing',
      volumes: payload.volumes,
      source: payload.source,
      token: payload.token,
      spec: payload.spec,
      addresses: payload.addresses,
      expiresInSeconds: payload.expiresInSeconds,
    };

    if (kind !== 'vm') {
      session.fsVolumes = guestVolumeList(payload.spec);
      session.volumes = session.fsVolumes.map((v) => v.volume);
      session.tmpfsTargets = payload.spec.volumes.flatMap((v) => (v.type === 'tmpfs' ? [v.target] : []));
    }

    this.sessions.set(key, session);
    this.registry.begin(session.replica);
    this.report(session, 'prepare', { status: 'running' });
    this.run(key, async () => {
      try {
        const applied = await this.state.appliedState();
        const overlay = applied?.network.addresses ?? [];
        const address = overlay.find((a) => !a.includes(':')) ?? overlay[0];

        if (!address) throw new Error('this node has no overlay address yet');

        if (kind !== 'vm') {
          // Filesystem volumes: handed over during the freeze (single primary), the reconcile keeps its hands off.
          session.volumes.forEach((v) => this.volumes.holdForMigration(v));
        } else {
          // Dual-primary window, this side (the source allows it before it connects); promotion on the first relay.
          for (const volume of session.volumes) await this.volumes.setDualPrimary(volume, true);
        }

        await this.persist(session);

        const migrationDir = this.migrationDir(session.replica);

        await mkdir(migrationDir, { recursive: true, mode: 0o711 });
        await writeFile(join(migrationDir, INCOMING_MARKER), `${session.migration}\n`, { mode: 0o644 });

        if (kind !== 'vm') this.workloads.expectIncoming(session.replica);
        else this.vms?.expectIncoming(session.replica);

        // The replica on the kept addresses (extra NICs keep theirs from `spec.vm.nics`), started in incoming mode.
        // Generic microVMs: the image layers are unpacked (verified by diffID) and the overlay mounted here first;
        // bundled ones: the image (pulled by digest) in migration mode, volumes left out until the hand-over.
        await this.workloads.createReplica({ ...session.spec, addresses: session.addresses });

        const launcher = await this.workloads.containerOf(session.replica);

        if (!launcher) throw new Error(`the launcher of ${session.replica} was not created (image policy?)`);

        const pid = async () => (await this.docker.getContainer(launcher.Id).inspect()).State.Pid;
        const endpoint = await this.transfer.open(
          {
            migration: session.migration,
            attempt: session.attempt,
            token: session.token,
            peer: session.source,
            dir: session.dir,
            expiresInSeconds: session.expiresInSeconds,
            address,
            credentials: await this.credentials(),
          },
          kind !== 'vm'
            ? {
                socketPath: async () => launcherIncomingSocket(await pid()),
                onBatch: (batch) => this.applyBatch(session, launcher.Id, batch),
              }
            : {
                onConnect: () => this.promote(session),
                socketPath: async () => launcherLibvirtSocket(await pid()),
              },
        );
        const peerAddresses = applied?.network.wireguard.find((l) => l.peer === session.source)?.peerAddresses ?? [];

        if (peerAddresses.length > 0)
          await this.firewall.allow('input', peerAddresses, endpoint.port, session.migration);

        session.endpoint = endpoint;
        session.state = 'prepared';
        await this.persist(session);
        this.report(session, 'prepare', { status: 'done', endpoint });

        if (kind !== 'vm') void this.watchIncomingMicrovm(key, session, launcher.Id);
        else void this.watchIncoming(key, session, launcher.Id);
      } catch (error) {
        session.state = 'failed';
        session.error = messageOf(error);
        await this.persist(session).catch(() => undefined);
        this.report(session, 'prepare', { status: 'failed', error: session.error });
      }
    });
  }

  /**
   * A batch from the source (microVMs): a guest tree pass (`guest-<n>`, `guest-final`) applied to the merged
   * directory (generic) or the launcher's `/guest` (bundled) and the tmpfs volumes, or the volume hand-over. The source
   * gets its answer only afterwards.
   */
  private async applyBatch(session: TargetSession, containerId: string, batch: string): Promise<void> {
    if (batch === HANDOVER_BATCH) {
      if (!this.guestVolumes) throw new Error('this node agent cannot mount microVM volumes');

      const dir = microvmVolumesDir(runtimeDir(), session.replica);
      const pid = kindOf(session) === 'bundled' ? await this.launcherPid(containerId) : 0;

      for (const volume of session.fsVolumes ?? []) {
        await this.guestVolumes.attach(dir, volume, true);

        // Bundled: the mount propagated into the running launcher keeps the flags it had when it was made (a
        // read-only remount on the host doesn't propagate), so read-only volumes are remounted there as well.
        if (pid && volume.readOnly)
          await this.commands.run('nsenter', [
            '-t',
            String(pid),
            '-m',
            '--',
            'mount',
            '-o',
            'remount,bind,ro',
            `${MICROVM_GUEST_MOUNT}${volume.target}`,
          ]);
      }

      session.takenOver = true;
      await this.persist(session);

      return;
    }

    if (!/^guest-(\d{1,4}|final)$/.test(batch)) throw new Error(`unexpected batch ${batch}`);

    if (batch === 'guest-final') session.finalReceived = true;

    const dir = join(session.dir, batch);

    try {
      const index = JSON.parse(await readFile(join(dir, 'pass.json'), 'utf8')) as {
        roots?: { root?: unknown; meta?: unknown }[];
      };
      const tmpfs = session.tmpfsTargets ?? [];
      const info = await this.docker.getContainer(containerId).inspect();
      const pid = info.State.Pid;
      const bundled = kindOf(session) === 'bundled';

      for (const entry of index.roots ?? []) {
        const root = Number(entry.root);

        if (!Number.isInteger(root) || root < 0 || root > tmpfs.length) throw new Error('invalid guest tree');

        const handle =
          root !== 0
            ? await openTree(`${this.procDir(pid)}/root`, `${MICROVM_GUEST_MOUNT}${tmpfs[root - 1]}`)
            : bundled
              ? await openTree(`${this.procDir(pid)}/root`, MICROVM_GUEST_MOUNT)
              : await openTree(replicaPaths(vmrootConfig(), session.replica).merged);

        try {
          await applyPass({
            root: fdPath(handle),
            tar: readPassTar(join(dir, `${root}.tar`)),
            meta: parsePassMeta(entry.meta),
            ops: this.syncOps,
            // Bundled: this launcher's own mount points below /guest stay as they are.
            ...(bundled && root === 0 ? { exclude: guestMountPoints(info.Mounts) } : {}),
          });
        } finally {
          await handle.close();
        }
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  private async launcherPid(containerId: string): Promise<number> {
    const pid = (await this.docker.getContainer(containerId).inspect()).State.Pid;

    if (!pid) throw new Error('the incoming launcher does not run');

    return pid;
  }

  /**
   * MicroVMs: once QEMU's incoming migration completed (it stays paused), the guest is resumed here and
   * `restore` reported. Polled slowly until the final guest pass arrived, closely during the freeze.
   */
  private async watchIncomingMicrovm(key: string, session: TargetSession, containerId: string): Promise<void> {
    const started = Date.now();

    while (!this.cancelled.has(key) && this.sessions.get(key) === session && !this.destroyed) {
      if (Date.now() - started > session.expiresInSeconds * 1000) return;

      const status = parseQueryMigrate(
        (await this.ctl(containerId, ['migrate-status']).catch(() => null))?.stdout ?? '',
      );

      if (status.status === 'failed') {
        this.report(session, 'restore', {
          status: 'failed',
          error: `incoming migration failed: ${status.error ?? ''}`,
        });

        return;
      }

      if (status.status === 'completed') {
        if ((await this.domainState(containerId)) !== 'running')
          await this.ctl(containerId, ['resume']).catch(() => undefined);

        if ((await this.domainState(containerId)) === 'running') {
          session.state = 'restored';
          await this.persist(session).catch(() => undefined);
          this.report(session, 'restore', { status: 'done' });

          return;
        }
      }

      await sleep(session.finalReceived ? this.freezePollMs : this.pollMs);
    }
  }

  /** The target's disks become primary next to the source's (the source allowed two primaries before connecting). */
  private async promote(session: TargetSession): Promise<void> {
    if (session.promoted) return;

    for (const volume of session.volumes) await this.volumes.promoteForMigration(volume);

    session.promoted = true;
    await this.persist(session);
  }

  /** `restore` done once the domain runs here (QEMU resumes on its own after the switch-over). */
  private async watchIncoming(key: string, session: TargetSession, containerId: string): Promise<void> {
    const started = Date.now();

    while (!this.cancelled.has(key) && this.sessions.get(key) === session && !this.destroyed) {
      if (Date.now() - started > session.expiresInSeconds * 1000) return;

      if ((await this.domainState(containerId)) === 'running') {
        session.state = 'restored';
        await this.persist(session).catch(() => undefined);
        this.report(session, 'restore', { status: 'done' });

        return;
      }

      await sleep(this.pollMs);
    }
  }

  // Source: start + switchover.

  private start(payload: VmMigrationStart): void {
    const key = VmMigrationService.key('source', payload.migration, payload.attempt);
    const existing = this.sessions.get(key) as SourceSession | undefined;

    if (existing) return this.reportSource(existing);

    const session: SourceSession = {
      role: 'source',
      migration: payload.migration,
      attempt: payload.attempt,
      replica: payload.replica,
      channel: migrationChannel(payload.migration),
      dir: this.sessionDir('source', payload.migration, payload.attempt),
      state: 'starting',
      volumes: [],
      target: payload.target,
      endpoint: payload.endpoint,
      token: payload.token,
      round: 0,
      totalBytes: 0,
    };

    const kind = launcherKindOfSpec(this.workloads.specOf(payload.replica));

    if (kind === 'generic' || kind === 'bundled') session.kind = kind;

    this.sessions.set(key, session);
    this.registry.begin(session.replica);
    this.report(session, 'precopy', { status: 'running', round: 0 });
    this.run(key, async () => {
      try {
        if (isMicrovm(session)) await this.migrateMicrovm(key, session, payload);
        else await this.migrate(key, session, payload);
      } catch (error) {
        session.state = 'failed';
        session.error = messageOf(error);
        await this.persist(session).catch(() => undefined);
        this.report(session, 'precopy', { status: 'failed', error: session.error });
      }
    });
  }

  private reportSource(session: SourceSession): void {
    if (session.state === 'failed' || session.state === 'aborted')
      return this.report(session, 'precopy', { status: 'failed', error: session.error ?? 'migration failed' });

    if (session.state !== 'migrated')
      return this.report(session, 'precopy', {
        status: 'running',
        round: session.round,
        totalBytes: session.totalBytes,
      });

    this.report(session, 'precopy', { status: 'done', round: session.round, totalBytes: session.totalBytes });
    this.report(session, 'freeze', {
      status: 'done',
      ...(session.freezeMs !== undefined ? { freezeMs: session.freezeMs } : {}),
    });
  }

  private async migrate(key: string, session: SourceSession, payload: VmMigrationStart): Promise<void> {
    const launcher = await this.workloads.containerOf(session.replica);
    const spec = this.workloads.specOf(session.replica);

    if (!launcher || launcher.State !== 'running') throw new Error(`VM ${session.replica} doesn't run on this node`);

    if (!spec?.vm) throw new Error(`${session.replica} is no virtual machine`);

    session.containerId = launcher.Id;
    session.volumes = spec.vm.disks.map((d) => d.volume);

    const info = await this.docker.getContainer(launcher.Id).inspect();

    session.restartPolicy = info.HostConfig.RestartPolicy?.Name || 'no';
    session.state = 'migrating';
    await this.persist(session);

    for (const volume of session.volumes) await this.volumes.setDualPrimary(volume, true);

    // A launcher whose domain left exits: Docker must not start it again (it would cold-boot the VM a second time).
    await this.docker.getContainer(launcher.Id).update({ RestartPolicy: { Name: 'no' } });

    await this.openRelay(key, session);

    const bandwidthMiB = payload.maxBandwidthBps ? Math.max(1, Math.floor(payload.maxBandwidthBps / 1024 ** 2)) : 0;
    let settled = false;
    const job = this.ctl(
      launcher.Id,
      [
        'migrate',
        PEER_SOCKET_IN_LAUNCHER,
        String(payload.downtimeLimitMs),
        ...(bandwidthMiB > 0 ? [String(bandwidthMiB)] : []),
      ],
      (payload.maxSeconds + 120) * 1000,
    ).finally(() => (settled = true));
    const started = Date.now();
    let overdue: string | null = null;

    job.catch(() => undefined);

    while (!settled && !this.cancelled.has(key)) {
      await sleep(this.pollMs);

      if (settled) break;

      const progress = parseDomJobInfo((await this.ctl(launcher.Id, ['jobinfo']).catch(() => null))?.stdout ?? '');

      if (progress.processedBytes !== undefined) {
        session.round = progress.iteration ?? session.round;
        session.totalBytes = progress.processedBytes;
        session.dirtyBytesPerSecond = progress.dirtyBytesPerSecond;
        this.report(session, 'precopy', {
          status: 'running',
          round: Math.min(1000, session.round),
          ...(progress.remainingBytes !== undefined ? { bytes: progress.remainingBytes } : {}),
          totalBytes: session.totalBytes,
          ...(session.dirtyBytesPerSecond !== undefined ? { dirtyBytesPerSecond: session.dirtyBytesPerSecond } : {}),
        });
      }

      if (!overdue && Date.now() - started > payload.maxSeconds * 1000) {
        overdue = `pre-copy did not converge within ${payload.maxSeconds} s`;
        await this.ctl(launcher.Id, ['migrate-abort']).catch(() => undefined);
      }
    }

    try {
      await job;
    } catch (error) {
      throw new Error(overdue ?? messageOf(error));
    }

    if (overdue) throw new Error(overdue);

    const completed = parseDomJobInfo(
      (await this.ctl(launcher.Id, ['jobinfo-completed']).catch(() => null))?.stdout ?? '',
    );

    session.state = 'migrated';
    session.freezeMs = completed.downtimeMs;
    session.totalBytes = completed.processedBytes ?? session.totalBytes;
    await this.persist(session);
    this.reportSource(session);
  }

  /** The source's relay socket in the launcher's migration directory, relayed over mTLS to the target's endpoint. */
  private async openRelay(key: string, session: SourceSession): Promise<void> {
    const migrationDir = this.migrationDir(session.replica);

    await mkdir(migrationDir, { recursive: true, mode: 0o711 });
    this.relays.set(
      key,
      await this.listenRelay({
        socketPath: join(migrationDir, PEER_SOCKET),
        owner: { uid: MICROVM_VMM_UID, gid: MICROVM_VMM_UID },
        endpoint: session.endpoint,
        credentials: await this.credentials(),
        peer: session.target,
        token: session.token,
        migration: session.migration,
        attempt: session.attempt,
      }),
    );
    await this.firewall.allow('output', [session.endpoint.address], session.endpoint.port, session.migration);
  }

  /**
   * One pass over a microVM's guest trees (the writable layer, the tmpfs volumes): what changed since the target's
   * last confirmed pass, as a batch the target applies before answering. Returns the file bytes sent. Bundled: the
   * `guest/` part of the launcher container's writable layer (absent until the guest changed something), without the
   * launcher's mount points.
   */
  private async syncGuest(key: string, session: SourceSession, batch: string): Promise<number> {
    const dir = join(session.dir, batch);
    const manifests = [...(this.manifests.get(key) ?? [])];
    const bundled = kindOf(session) === 'bundled';
    const trees: {
      root: number;
      mode: SyncMode;
      open: () => Promise<Awaited<ReturnType<typeof openTree>> | null>;
      exclude?: string[];
    }[] = [
      bundled
        ? {
            root: 0,
            mode: 'overlay',
            open: () =>
              openTree(session.upper ?? '', MICROVM_GUEST_MOUNT).catch((error: NodeJS.ErrnoException) => {
                if (error.code === 'ENOENT') return null;

                throw error;
              }),
            exclude: session.mountPoints ?? [],
          }
        : { root: 0, mode: 'overlay', open: () => openTree(replicaPaths(vmrootConfig(), session.replica).upper) },
      ...(session.tmpfsTargets ?? []).map((target, index) => ({
        root: index + 1,
        mode: 'plain' as const,
        open: () => openTree(`${this.procDir(session.pid ?? 0)}/root`, `${MICROVM_GUEST_MOUNT}${target}`),
      })),
    ];
    const roots: { root: number; meta: PassMeta }[] = [];
    let bytes = 0;

    await mkdir(dir, { recursive: true, mode: 0o700 });

    try {
      for (const tree of trees) {
        const handle = await tree.open();

        // A bundled launcher's writable layer without `guest/`: nothing of the guest changed yet.
        if (!handle) continue;

        try {
          const result = await scanPass({
            root: handle,
            mode: tree.mode,
            previous: manifests[tree.root] ?? new Map(),
            out: passTarFile(join(dir, `${tree.root}.tar`)),
            ops: this.syncOps,
            ...(tree.exclude ? { exclude: tree.exclude } : {}),
          });

          manifests[tree.root] = result.manifest;
          roots.push({ root: tree.root, meta: result.meta });
          bytes += result.bytes;
        } finally {
          await handle.close();
        }
      }

      await writeFile(join(dir, 'pass.json'), JSON.stringify({ roots }), { mode: 0o600 });
      await this.sendTo(session, batch, [batch]);
      // Only what the target confirmed counts as its state.
      this.manifests.set(key, manifests);

      return bytes;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  private async sendTo(session: SourceSession, batch: string, paths: string[]): Promise<number> {
    return await this.sendBatch({
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

  /** Waits for QEMU's migration (source or incoming side) to reach `completed`; throws when it failed. */
  private async migrationCompleted(containerId: string, timeoutMs: number): Promise<QueryMigrate> {
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      const status = parseQueryMigrate(
        (await this.ctl(containerId, ['migrate-status']).catch(() => null))?.stdout ?? '',
      );

      if (status.status === 'completed') return status;

      if (status.status === 'failed' || status.status === 'cancelled')
        throw new Error(`QEMU migration ${status.status}${status.error ? `: ${status.error}` : ''}`);

      if (Date.now() > deadline) throw new Error(`QEMU did not complete the migration within ${timeoutMs / 1000} s`);

      await sleep(this.freezePollMs);
    }
  }

  /**
   * MicroVM, source (generic M7 W10b, bundled M7 F5): guest tree passes while the guest runs, QEMU's memory pre-copy
   * over QMP to the pre-switchover pause, then the freeze: final guest pass, QEMU's device state (held in the relay
   * while the volumes are handed over), `completed`.
   */
  private async migrateMicrovm(key: string, session: SourceSession, payload: VmMigrationStart): Promise<void> {
    const launcher = await this.workloads.containerOf(session.replica);
    const spec = this.workloads.specOf(session.replica);
    const kind = kindOf(session);

    if (!launcher || launcher.State !== 'running')
      throw new Error(`microVM ${session.replica} doesn't run on this node`);

    if (!spec?.microvm || spec.microvm.mode !== kind) throw new Error(`${session.replica} is no ${kind} microVM`);

    const info = await this.docker.getContainer(launcher.Id).inspect();
    const volumes = guestVolumeList(spec);

    if (kind === 'bundled') {
      // Only a launcher in migration mode has migratable devices (and its volumes in the agent's directory).
      if (!(info.Config.Env ?? []).includes(BUNDLED_MIGRATION_ENV))
        throw new Error(`${session.replica}: its launcher does not run in migration mode (older image or container)`);

      session.upper = await this.containerUpper(info);
      session.mountPoints = guestMountPoints(info.Mounts);
    }

    session.containerId = launcher.Id;
    session.pid = info.State.Pid;
    session.fsVolumes = volumes;
    session.volumes = volumes.map((v) => v.volume);
    session.tmpfsTargets = spec.volumes.flatMap((v) => (v.type === 'tmpfs' ? [v.target] : []));
    session.restartPolicy = info.HostConfig.RestartPolicy?.Name || 'no';
    session.state = 'migrating';
    session.volumes.forEach((v) => this.volumes.holdForMigration(v));
    await this.persist(session);

    if (volumes.length > 0 && !this.guestVolumes) throw new Error('this node agent cannot hand microVM volumes over');

    // A launcher whose guest left exits: Docker must not start it again (it would boot the workload a second time).
    await this.docker.getContainer(launcher.Id).update({ RestartPolicy: { Name: 'no' } });
    await this.openRelay(key, session);

    // 1. The guest trees while the guest runs, until a pass is small.
    for (let pass = 1; pass <= GUEST_PASSES; pass++) {
      if (this.cancelled.has(key)) throw new Error('migration cancelled');

      const bytes = await this.syncGuest(key, session, `guest-${pass}`);

      session.round = pass;
      session.totalBytes += bytes;
      this.report(session, 'precopy', {
        status: 'running',
        round: session.round,
        bytes,
        totalBytes: session.totalBytes,
      });

      if (bytes <= GUEST_CONVERGE_BYTES) break;
    }

    // 2. Memory, until QEMU pauses before the switch-over (the guest is stopped from then on).
    const bandwidthMiB = payload.maxBandwidthBps ? Math.max(1, Math.floor(payload.maxBandwidthBps / 1024 ** 2)) : 0;

    await this.ctl(launcher.Id, [
      'qmp-migrate',
      PEER_SOCKET_IN_LAUNCHER,
      String(payload.downtimeLimitMs),
      ...(bandwidthMiB > 0 ? [String(bandwidthMiB)] : []),
    ]);

    const started = Date.now();
    const guestRounds = session.round;
    const guestBytes = session.totalBytes;
    let reported = 0;

    for (;;) {
      if (this.cancelled.has(key)) throw new Error('migration cancelled');

      const status = parseQueryMigrate(
        (await this.ctl(launcher.Id, ['migrate-status']).catch(() => null))?.stdout ?? '',
      );

      if (status.status === 'pre-switchover') break;

      if (status.status === 'failed' || status.status === 'cancelled' || status.status === 'completed')
        throw new Error(
          status.status === 'completed'
            ? 'QEMU switched over without pausing first'
            : `QEMU migration ${status.status}${status.error ? `: ${status.error}` : ''}`,
        );

      if (status.processedBytes !== undefined && Date.now() - reported >= this.pollMs) {
        reported = Date.now();
        session.round = guestRounds + (status.iteration ?? 0);
        session.totalBytes = guestBytes + status.processedBytes;
        session.dirtyBytesPerSecond = status.dirtyBytesPerSecond;
        this.report(session, 'precopy', {
          status: 'running',
          round: Math.min(1000, session.round),
          ...(status.remainingBytes !== undefined ? { bytes: status.remainingBytes } : {}),
          totalBytes: session.totalBytes,
          ...(status.dirtyBytesPerSecond !== undefined ? { dirtyBytesPerSecond: status.dirtyBytesPerSecond } : {}),
        });
      }

      if (Date.now() - started > payload.maxSeconds * 1000) {
        await this.ctl(launcher.Id, ['migrate-cancel']).catch(() => undefined);
        throw new Error(`pre-copy did not converge within ${payload.maxSeconds} s`);
      }

      await sleep(this.freezePollMs);
    }

    // 3. The freeze: the guest is stopped, QEMU waits before sending the device state.
    const freezeStarted = Date.now();

    session.state = 'freezing';
    await this.persist(session);
    session.totalBytes += await this.syncGuest(key, session, 'guest-final');

    const relay = this.relays.get(key);

    if (volumes.length > 0) relay?.gate(GATE_MAX_BYTES);

    await this.ctl(launcher.Id, ['migrate-continue']);

    let completed: QueryMigrate | null = null;

    if (volumes.length > 0) {
      // QEMU's last data (device state incl. the volumes' virtiofsd state) waits in the relay: the target's virtiofsd
      // must find the volumes mounted when it loads that state, and the source must have let go of them by then.
      completed = await this.migrationCompleted(launcher.Id, COMPLETE_TIMEOUT_MS);

      // Generic: the volumes' own virtiofsd ends. Bundled: the image root's virtiofsd holds them (and the launcher's
      // mount namespace may hold them directly), so the launcher goes — its guest's state already left.
      if (kind === 'bundled') await this.killLauncher(launcher.Id);
      else await this.ctl(launcher.Id, ['fs-release']);

      session.released = true;
      await this.persist(session);

      const dir = microvmVolumesDir(runtimeDir(), session.replica);

      for (const volume of volumes) await this.guestVolumes?.detach(dir, volume, 'migration');

      await this.sendTo(session, HANDOVER_BATCH, []);
      session.handedOver = true;
      await this.persist(session);
      relay?.release();
    }

    // (A bundled launcher killed for the hand-over can't answer any more: its `completed` was read before.)
    completed ??= await this.migrationCompleted(launcher.Id, COMPLETE_TIMEOUT_MS);

    session.state = 'migrated';
    session.freezeMs = Math.max(completed.downtimeMs ?? 0, Date.now() - freezeStarted);
    session.totalBytes = guestBytes + (completed.processedBytes ?? session.totalBytes - guestBytes);
    await this.persist(session);
    this.reportSource(session);
  }

  /** The overlay upper of a running launcher container (its root mount; Docker's graph driver data as fallback). */
  private async containerUpper(info: Docker.ContainerInspectInfo): Promise<string> {
    const fromMountinfo = upperdirFromMountinfo(
      await readFile(`${this.procDir(info.State.Pid)}/mountinfo`, 'utf8').catch(() => ''),
    );
    const upper = fromMountinfo ?? (info.GraphDriver?.Data as Record<string, string> | undefined)?.['UpperDir'];

    if (!upper) throw new Error(`no writable layer found for the launcher of ${info.Name.replace(/^\//, '')}`);

    return upper;
  }

  /** Kills a launcher and waits until it stopped (its mount namespace, and with it every mount there, is gone). */
  private async killLauncher(containerId: string): Promise<void> {
    const container = this.docker.getContainer(containerId);

    await container.kill({ signal: 'SIGKILL' }).catch(() => undefined);

    const deadline = Date.now() + KILL_TIMEOUT_MS;

    while ((await container.inspect()).State.Running) {
      if (Date.now() > deadline) throw new Error('the source launcher did not stop');

      await sleep(this.freezePollMs);
    }
  }

  /** Forces the switch-over of a pre-copy that doesn't converge: the guest pauses, the rest moves in one go. */
  private async switchover(payload: VmMigrationSwitchover): Promise<void> {
    const session = this.sessions.get(VmMigrationService.key('source', payload.migration, payload.attempt)) as
      | SourceSession
      | undefined;

    if (!session || session.state !== 'migrating' || session.suspended || !session.containerId) return;

    await this.ctl(session.containerId, ['suspend']);
    session.suspended = true;
    await this.persist(session);
    this.logger.log(`${session.replica}: switch-over forced (guest paused)`);
  }

  // Both: commit / abort.

  private async commit(payload: MigrationCommit): Promise<void> {
    const key = VmMigrationService.key(payload.role, payload.migration, payload.attempt);
    const session = this.sessions.get(key);
    const base = { ...payload, channel: migrationChannel(payload.migration) };

    if (!session) return this.report(base, 'commit', { status: 'done' });

    this.cancelled.add(key);
    await this.tasks.get(key);

    const generic = isMicrovm(session);

    if (session.role === 'source') {
      const launcher = await this.workloads.containerOf(session.replica);

      if (generic) {
        // (Generic and bundled microVMs.) Sessions in the replica end with a reason; new ones go to the target. The paused guest's state left:
        // destroyed without the stop grace, then the launcher, the writable layer and the (released) volumes go.
        await this.live
          ?.closeReplicaSessions(session.replica, `replica migrated to ${(session as SourceSession).target}`)
          .catch(() => undefined);

        if (launcher) await this.ctl(launcher.Id, ['destroy']).catch(() => undefined);
      }

      // The VM runs on the target: the source's launcher goes (its domain left), its disks go secondary.
      if (launcher) await this.workloads.removeContainer(launcher.Id, session.replica);

      for (const volume of generic ? [] : session.volumes)
        await this.volumes
          .demoteBlock(volume)
          .catch((error: unknown) => this.logger.warn(`Demoting ${volume}: ${messageOf(error)}`));

      await this.finish(key, session, false);

      if (!generic) void this.settle(session.volumes);
    } else {
      this.transfer.close(session.migration, session.attempt, 'committed');
      // From now on the launcher starts normally (its next restart cold-boots, as any VM's).
      await rm(join(this.migrationDir(session.replica), INCOMING_MARKER), { force: true });

      if (generic) this.workloads.incomingDone(session.replica);
      else this.vms?.incomingDone(session.replica);

      await this.finish(key, session, true);

      if (!generic) void this.settle(session.volumes);
    }

    this.report(session, 'commit', { status: 'done' });
  }

  private async abort(payload: MigrationAbort): Promise<void> {
    const key = VmMigrationService.key(payload.role, payload.migration, payload.attempt);
    const session = this.sessions.get(key);
    const base = { ...payload, channel: migrationChannel(payload.migration) };

    if (payload.role === 'target') {
      // Stop the job first (the source's guest keeps running), then whatever arrived here goes.
      this.cancelled.add(key);
      this.transfer.close(payload.migration, payload.attempt, 'aborted');
      await this.relays
        .get(key)
        ?.close()
        .catch(() => undefined);
      await this.tasks.get(key);

      const launcher = await this.workloads.containerOf(payload.replica);

      if (launcher) await this.workloads.removeContainer(launcher.Id, payload.replica);

      await rm(join(this.migrationDir(payload.replica), INCOMING_MARKER), { force: true });

      // (A generic microVM's volumes were unmounted and demoted with its launcher, if it had taken them over.)
      const volumes = session?.volumes ?? payload.volumes;

      for (const volume of volumes)
        await this.volumes
          .demoteBlock(volume)
          .catch((error: unknown) => this.logger.warn(`Demoting ${volume}: ${messageOf(error)}`));

      this.vms?.incomingDone(payload.replica);
      this.workloads.incomingDone(payload.replica);

      if (session) await this.finish(key, session, false);

      void this.settle(volumes.filter((v) => this.volumes.inDualPrimary(v)));

      return this.report(session ?? base, 'abort', { status: 'done' });
    }

    if (!session) {
      const running = (await this.workloads.containerOf(payload.replica))?.State === 'running';

      return this.report(base, 'abort', { status: 'done', resumed: running });
    }

    const resumed = await this.resume(key, session as SourceSession);

    await this.finish(key, session, false);
    // The target demotes at its abort; until then DRBD refuses to end the window here (retried).
    if (!isMicrovm(session)) void this.settle(session.volumes);

    this.report(session, 'abort', { status: 'done', resumed });
  }

  /** After an abort during the hand-over: the source mounts its volumes again (retried while the target holds them). */
  private async retakeVolumes(session: SourceSession): Promise<void> {
    const dir = microvmVolumesDir(runtimeDir(), session.replica);
    const deadline = Date.now() + SETTLE_MS;

    for (const volume of session.fsVolumes ?? []) {
      for (;;) {
        try {
          await this.guestVolumes?.attach(dir, volume, true);
          break;
        } catch (error) {
          if (Date.now() > deadline || this.destroyed) {
            this.logger.warn(`${volume.volume}: not mounted again after the aborted hand-over: ${messageOf(error)}`);
            break;
          }

          await sleep(this.settleIntervalMs);
        }
      }
    }
  }

  /** Cancels the job on the source; the guest keeps (or goes back to) running here. */
  private async resume(key: string, session: SourceSession): Promise<boolean> {
    if (session.state === 'aborted') return session.resumed ?? false;

    const container = session.containerId;
    const generic = isMicrovm(session);

    if (container && (session.state === 'migrating' || session.state === 'freezing'))
      await this.ctl(container, [generic ? 'migrate-cancel' : 'migrate-abort']).catch(() => undefined);

    this.cancelled.add(key);
    await this.tasks.get(key);

    let resumed = false;

    if (generic && session.released) {
      // The volumes' virtiofsd is gone: the guest can't go on here. Volumes the target never got are mounted here
      // again (once it let go), so the control plane's short stop finds them where its primary still is.
      if (!session.handedOver) await this.retakeVolumes(session);
    } else if (container) {
      if (session.suspended || (await this.domainState(container)) === 'paused')
        await this.ctl(container, ['resume']).catch(() => undefined);

      resumed = (await this.domainState(container)) === 'running';

      // Only a launcher that still runs its guest gets its restart policy back (never one whose domain left).
      if (resumed && session.restartPolicy)
        await this.docker
          .getContainer(container)
          .update({ RestartPolicy: { Name: session.restartPolicy } })
          .catch(() => undefined);
    }

    session.state = 'aborted';
    session.resumed = resumed;
    await this.persist(session).catch(() => undefined);

    return resumed;
  }
}
