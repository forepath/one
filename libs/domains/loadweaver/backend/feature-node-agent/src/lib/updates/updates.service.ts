import { createHash } from 'node:crypto';
import { access, mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { release as kernelRelease } from 'node:os';

import type {
  ComponentVersions,
  ControlPlaneRole,
  DesiredState,
  NodeComponents,
} from '@forepath/loadweaver/shared/util-agent-protocol';
import {
  packagePins,
  trustedReleaseKeys,
  unsignedBundlesAllowed,
  unsignedBundlesNotice,
  verifyManifest,
  type ImageComponentName,
  type ReleaseManifest,
} from '@forepath/loadweaver/shared/util-release';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type Docker from 'dockerode';

import { etcdClientUrl } from '../control-plane/control-plane-containers';
import { listMembers } from '../control-plane/etcd-client';
import { CommandRunner } from '../host/command-runner';
import { DOCKER } from '../host/docker.provider';
import { HostInfoService } from '../host/host-info.service';
import { COMPONENT_LABEL, MANAGED_LABEL } from '../host/managed-containers';
import { defaultFetch, type FetchImpl } from '../host/verified-download';
import { AgentStateStore } from '../state/agent-state.store';
import { AGENT_VERSION } from './agent-version';
import { rebootRequired } from './host-commands';
import { installedGvisor, OsUpdateManager } from './os-update.manager';
import { patroniLag, patroniRole, patroniSwitchover } from './patroni';
import {
  componentImage,
  heldComponents,
  holdComponentImage,
  imageOverrides,
  releaseImagesVersion,
  setReleaseImages,
} from './release-images';
import { SelfUpdater, selfUpdateConfig } from './self-update';
import { UpdateActions } from './update-actions';

/** Platform containers by component label (and name) → release component. */
export function componentOfContainer(label: string, name: string): ImageComponentName | null {
  if (name === 'lw-ratelimit-valkey') return 'valkey';

  const map: Record<string, ImageComponentName> = {
    etcd: 'etcd',
    postgres: 'postgres',
    queue: 'valkey',
    controlPlane: 'control-plane',
    'log-store': 'opensearch',
    'object-store': 'garage',
    registry: 'registry',
    'authoritative-dns': 'bind9',
    ingress: 'envoy',
    mesh: 'envoy',
    ratelimit: 'ratelimit',
  };

  return map[label] ?? null;
}

/** DRBD replication of this node from `drbdsetup status --json`. */
export function replicationOf(statusJson: string): { volumes: number; syncing: number; degraded: number } {
  let resources: {
    devices?: { 'disk-state'?: string }[];
    connections?: {
      'connection-state'?: string;
      peer_devices?: { 'replication-state'?: string; 'peer-disk-state'?: string }[];
    }[];
  }[] = [];

  try {
    resources = JSON.parse(statusJson);
  } catch {
    return { volumes: 0, syncing: 0, degraded: 0 };
  }

  let syncing = 0;
  let degraded = 0;

  for (const r of resources) {
    const peers = (r.connections ?? []).flatMap((c) => c.peer_devices ?? []);

    if (
      peers.some((p) => /^(SyncSource|SyncTarget|PausedSync|StartingSync|WFBitMap)/.test(p['replication-state'] ?? ''))
    )
      syncing++;
    else if (
      (r.devices ?? []).some((d) => d['disk-state'] !== 'UpToDate' && d['disk-state'] !== 'Diskless') ||
      (r.connections ?? []).some((c) => c['connection-state'] !== 'Connected') ||
      peers.some((p) => p['peer-disk-state'] !== 'UpToDate' && p['peer-disk-state'] !== 'Diskless')
    )
      degraded++;
  }

  return { volumes: resources.length, syncing, degraded };
}

const HOST_FACTS_TTL_MS = 60_000;

/** etcd's own view on this node (`/health`, member list), for the rollout's quorum gate. */
export async function etcdHealth(clientUrl: string): Promise<{ healthy: boolean; members: number }> {
  const healthy = await fetch(`${clientUrl}/health`, { signal: AbortSignal.timeout(2_000) })
    .then(async (res) => res.ok && ((await res.json()) as { health?: unknown }).health === 'true')
    .catch(() => false);
  const members = await listMembers(clientUrl)
    .then((m) => m.length)
    .catch(() => 0);

  return { healthy, members };
}

/**
 * Release components on the node (3.26): verifies the release the control plane sets (compiled-in release keys), runs
 * its images (`release-images`), coordinates actions (Patroni switchover), host updates (cluster-local apt snapshot,
 * gVisor, DRBD, reboot on request) and the agent's own swap, and reports what the node runs in hello / heartbeat.
 */
@Injectable()
export class UpdatesService {
  private readonly logger = new Logger(UpdatesService.name);
  readonly actions: UpdateActions;
  readonly os: OsUpdateManager;
  readonly selfUpdater: SelfUpdater;
  private verified: { key: string; manifest: ReleaseManifest } | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private memberAddress: string | null = null;
  /** This node runs an etcd member (control-plane member or witness). */
  private etcdLocal = false;
  /** Release of the last desired state applied completely (undefined: not read from disk yet). */
  private appliedRelease: string | null | undefined = undefined;
  private hostFacts: {
    at: number;
    facts: Pick<ComponentVersions, 'kernel' | 'rebootRequired' | 'packages' | 'gvisor' | 'drbd'>;
  } | null = null;
  /** Overridable for tests. */
  fetchImpl: FetchImpl = defaultFetch;

  constructor(
    private readonly state: AgentStateStore,
    private readonly commands: CommandRunner,
    private readonly hostInfo: HostInfoService,
    @Inject(DOCKER) private readonly docker: Docker,
  ) {
    const dir = join(state.dir, 'updates');
    // Loud on every start (M6 review L1).
    const unsigned = unsignedBundlesNotice();

    if (unsigned) this.logger.warn(unsigned);

    this.actions = new UpdateActions(dir);
    this.os = new OsUpdateManager(dir, join(state.dir, 'apt'), commands, this.actions, (url) => this.fetchImpl(url));
    this.selfUpdater = new SelfUpdater(selfUpdateConfig(state.dir), commands, this.actions, AGENT_VERSION, (url) =>
      this.fetchImpl(url),
    );
  }

  /** The release manifest after checking its signature (cached per manifest). */
  verify(components: NodeComponents): ReleaseManifest {
    const key = createHash('sha256')
      .update(components.manifest)
      .update(components.signature ?? '')
      .digest('hex');

    if (this.verified?.key === key) return this.verified.manifest;

    const { manifest } = verifyManifest(
      Buffer.from(components.manifest, 'utf8'),
      components.signature ? (JSON.parse(components.signature) as unknown) : null,
      { trustedKeys: trustedReleaseKeys(), allowUnsigned: unsignedBundlesAllowed() },
    );

    if (manifest.version !== components.release)
      throw new Error(`the manifest is release ${manifest.version}, the desired state names ${components.release}`);

    this.verified = { key, manifest };

    return manifest;
  }

  /**
   * The reconciler's first layer: the node runs the release's images from here on (managers pick them up in the same
   * apply), and a Patroni leader hands over before its member updates. No components: the node keeps its release.
   */
  async apply(components: NodeComponents | undefined, role: ControlPlaneRole, address: string): Promise<boolean> {
    this.memberAddress = role.role === 'member' ? address : null;
    this.etcdLocal = role.role === 'member' || role.role === 'witness';

    if (!components) return false;

    let manifest: ReleaseManifest;

    try {
      manifest = this.verify(components);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      await this.actions.record({
        id: `images:${components.release}`,
        kind: 'images',
        phase: 'failed',
        error: message,
      });
      throw new Error(`release ${components.release} refused: ${message}`);
    }

    const changed = releaseImagesVersion() !== manifest.version;
    // The Spilo image this member runs now (or keeps from an earlier failed switchover).
    const previousPostgres = componentImage('postgres', {});

    setReleaseImages(manifest);

    const switchover = role.role === 'member' ? components.actions?.patroniSwitchover : undefined;

    if (!switchover) holdComponentImage('postgres', null);
    else {
      const done = await this.actions.get(switchover.id);

      if (!done || done.phase !== 'done') {
        try {
          await this.actions.record({ id: switchover.id, kind: 'switchover', phase: 'installing' });
          await patroniSwitchover(address, switchover.candidate);
          await this.actions.record({ id: switchover.id, kind: 'switchover', phase: 'done' });
          holdComponentImage('postgres', null);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);

          await this.actions.record({ id: switchover.id, kind: 'switchover', phase: 'failed', error: message });
          // Never update the leader's database container without the switchover: Spilo keeps its image, every other
          // layer still converges (M6 review L2); the failed action fails the rollout step, which rolls back.
          holdComponentImage('postgres', previousPostgres);
          this.logger.warn(`Patroni switchover failed, Postgres keeps its image: ${message}`);
        }
      } else holdComponentImage('postgres', null);
    }

    if (changed) await this.actions.record({ id: `images:${manifest.version}`, kind: 'images', phase: 'done' });

    return changed;
  }

  /**
   * The reconciler applied a desired state completely (every layer, the containers included): from now on the node
   * reports its release. Not while a component is held back on an earlier image. No release: the node keeps its own.
   */
  async confirmApplied(release: string | undefined): Promise<void> {
    if (!release || heldComponents().length > 0 || release === (await this.loadAppliedRelease())) return;

    this.appliedRelease = release;

    const dir = join(this.state.dir, 'updates');

    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(join(dir, 'applied-release.new'), release, { mode: 0o600 });
    await rename(join(dir, 'applied-release.new'), join(dir, 'applied-release'));
  }

  private async loadAppliedRelease(): Promise<string | null> {
    if (this.appliedRelease === undefined)
      this.appliedRelease =
        (await readFile(join(this.state.dir, 'updates', 'applied-release'), 'utf8').catch(() => '')).trim() || null;

    return this.appliedRelease;
  }

  /**
   * After the control plane's desired state was applied: confirm a pending self-update, run the host update (and the
   * reboot once ordered), then swap the agent if the release ships another one. Serialized; never throws.
   */
  afterApply(state: DesiredState): Promise<void> {
    const run = this.chain.then(() => this.afterApplyNow(state));

    this.chain = run.catch(() => undefined);

    return run.catch((error: unknown) =>
      this.logger.warn(`Update step: ${error instanceof Error ? error.message : String(error)}`),
    );
  }

  private async afterApplyNow(state: DesiredState): Promise<void> {
    await this.selfUpdater.confirm();

    const components = state.components;

    await this.selfUpdater.clearStaleFailures(components?.release);

    const identity = await this.state.identity();

    if (!components || !identity) return;

    const manifest = this.verify(components);
    const os = await this.hostInfo.os();

    if (components.host) {
      await this.os.run(components.host, manifest, identity.controlPlaneUrl, components.artifactBase, os);
      this.hostFacts = null;

      if ((await this.actions.get(components.host.id))?.phase === 'done' && (await this.os.reboot(components.host)))
        return;
    }

    await this.selfUpdater.ensure(manifest, os.arch, identity.controlPlaneUrl, components.artifactBase);
  }

  private async facts(): Promise<NonNullable<UpdatesService['hostFacts']>['facts']> {
    if (this.hostFacts && Date.now() - this.hostFacts.at < HOST_FACTS_TTL_MS) return this.hostFacts.facts;

    const kernel = kernelRelease();
    const kernels = await readdir('/lib/modules').catch(() => [] as string[]);
    const flag = await access('/run/reboot-required').then(
      () => true,
      () => false,
    );
    const os = await this.hostInfo.os();
    const pinned = this.verified ? Object.keys(packagePins(this.verified.manifest, `${os.id}:${os.versionId}`)) : [];
    const installed = pinned.length ? await this.os.installedPackages() : {};
    const drbd =
      /version:\s*([0-9][0-9.]*)/.exec(await readFile('/proc/drbd', 'utf8').catch(() => ''))?.[1] ??
      ((await this.commands
        .run('modinfo', ['-F', 'version', 'drbd'])
        .then((r) => r.stdout.trim())
        .catch(() => '')) ||
        undefined);
    const facts = {
      kernel,
      rebootRequired: rebootRequired(kernel, kernels, flag),
      packages: Object.fromEntries(pinned.filter((p) => installed[p]).map((p) => [p, installed[p]])),
      ...((await installedGvisor()) ? { gvisor: (await installedGvisor()) as string } : {}),
      ...(drbd ? { drbd } : {}),
    };

    this.hostFacts = { at: Date.now(), facts };

    return facts;
  }

  /**
   * The reference a platform container runs, digest included (the rollout's `images` gate compares the digest). The
   * list API's `Image` is the reference the container was created from while it still resolves to the container's
   * image (VM lab: also with the containerd image store); otherwise Docker puts the image ID there (`sha256:<id>`,
   * never the release's digest), so the reference from the container's config is reported — created by digest, it
   * names exactly the content the container runs.
   */
  private async runningImage(c: { Id: string; Image: string }): Promise<string> {
    if (c.Image.includes('@sha256:')) return c.Image;

    const configured = await this.docker
      .getContainer(c.Id)
      .inspect()
      .then((info) => info.Config?.Image ?? '')
      .catch(() => '');

    return configured.includes('@sha256:') ? configured : c.Image;
  }

  /** What the node runs, for the hello and every heartbeat. */
  async report(): Promise<ComponentVersions> {
    const images: Record<string, string> = {};

    try {
      for (const c of await this.docker.listContainers({ filters: { label: [`${MANAGED_LABEL}=true`] } })) {
        const name = c.Names[0]?.replace(/^\//, '') ?? '';
        const component = componentOfContainer(c.Labels?.[COMPONENT_LABEL] ?? '', name);

        if (component && !name.includes('-draining-')) images[component] = await this.runningImage(c);
      }
    } catch {
      // Docker unavailable: no images to report
    }

    const bootId = (await readFile('/proc/sys/kernel/random/boot_id', 'utf8').catch(() => '')).trim();
    const replication = await this.commands
      .run('drbdsetup', ['status', '--json'])
      .then((r) => replicationOf(r.stdout))
      .catch(() => null);
    const postgres = this.memberAddress ? await patroniRole(this.memberAddress) : undefined;
    const postgresLag = this.memberAddress && postgres === 'replica' ? await patroniLag(this.memberAddress) : undefined;
    const etcd = this.etcdLocal ? await etcdHealth(etcdClientUrl('127.0.0.1')) : undefined;
    const snapshot = await this.os.appliedSnapshot();
    const overrides = imageOverrides();
    // Only a release whose apply completed (containers replaced), never the one merely being applied (M6 review H1).
    const release = await this.loadAppliedRelease();

    return {
      ...(release ? { release } : {}),
      images,
      ...(bootId ? { bootId: bootId.slice(0, 64) } : {}),
      ...(await this.facts()),
      ...(snapshot ? { snapshot } : {}),
      ...(replication && replication.volumes > 0 ? { replication } : {}),
      ...(postgres ? { postgres } : {}),
      ...(postgresLag !== undefined ? { postgresLag } : {}),
      ...(etcd ? { etcd } : {}),
      ...(overrides.length ? { overrides } : {}),
      actions: await this.actions.list(),
    };
  }
}
