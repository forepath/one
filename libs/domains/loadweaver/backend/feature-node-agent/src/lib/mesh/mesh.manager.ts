import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { NodeNetworkConfig } from '@forepath/loadweaver/shared/util-agent-protocol';
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type Docker from 'dockerode';

import { DOCKER } from '../host/docker.provider';
import { ManagedContainers } from '../host/managed-containers';
import { envoyImage } from '../ingress/envoy-config';
import { podNetworkSpec } from '../network/pod-network.manager';
import { AgentStateStore } from '../state/agent-state.store';
import { EnvoyHandover, envoyAdminSocketName } from '../updates/envoy-handover';
import {
  MESH_CONTAINER,
  MESH_DIR,
  meshSpec,
  renderMeshBootstrap,
  renderMeshClusters,
  renderMeshListeners,
  renderMeshSecrets,
} from './mesh-config';
import { WorkloadIdentityManager } from './workload-identity.manager';

/**
 * The node proxy (3.7): one Envoy for east-west traffic and web egress of the node's workloads, configured through files it watches
 * (filesystem xDS, secrets via file-based SDS so rotating identities needs no listener drain). Service ports of an
 * identity that has no certificate yet are left out until it arrives.
 */
/** Identities are checked this often for renewal (24 h certificates, renewed after 12 h). */
const RENEW_CHECK_MS = 10 * 60_000;

@Injectable()
export class MeshManager implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MeshManager.name);
  private last: { nodeName: string; network: NodeNetworkConfig } | null = null;

  private readonly handover: EnvoyHandover;

  constructor(
    private readonly containers: ManagedContainers,
    private readonly state: AgentStateStore,
    private readonly identities: WorkloadIdentityManager,
    @Inject(DOCKER) docker: Docker,
  ) {
    this.handover = new EnvoyHandover(containers, docker);
    // New certificates: render again with what is ready now.
    this.identities.watch(() => this.refresh());
  }

  private timer: NodeJS.Timeout | null = null;

  onModuleInit(): void {
    this.timer = setInterval(() => this.refresh(), RENEW_CHECK_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Again with the last configuration: renews identities that are due and renders what is ready. */
  private refresh(): void {
    if (this.last)
      void this.apply(this.last.nodeName, this.last.network).catch((error: unknown) =>
        this.logger.warn(`Mesh update: ${error instanceof Error ? error.message : String(error)}`),
      );
  }

  private get dir(): string {
    return join(this.state.dir, 'mesh', 'proxy');
  }

  /** Writes a resource file atomically (holds private keys: root only); returns true if it changed. */
  private async swap(file: string, content: string): Promise<boolean> {
    const path = join(this.dir, 'dynamic', file);

    if ((await readFile(path, 'utf8').catch(() => null)) === content) return false;

    await writeFile(join(this.dir, 'dynamic', `.${file}.new`), content, { mode: 0o600 });
    await rename(join(this.dir, 'dynamic', `.${file}.new`), path);

    return true;
  }

  /** One file per secret, swapped by rename; files of secrets no longer used go. */
  private async writeSecrets(files: ReadonlyMap<string, string>): Promise<boolean> {
    const dir = join(this.dir, 'secrets');
    let changed = false;

    for (const [file, content] of files) {
      if ((await readFile(join(dir, file), 'utf8').catch(() => null)) === content) continue;

      await writeFile(join(dir, `.${file}.new`), content, { mode: 0o600 });
      await rename(join(dir, `.${file}.new`), join(dir, file));
      changed = true;
    }

    for (const file of await readdir(dir)) {
      if (!files.has(file)) {
        await rm(join(dir, file), { force: true });
        changed = true;
      }
    }

    return changed;
  }

  private queue: Promise<unknown> = Promise.resolve();

  /** Serialized: the reconciler, renewals and certificate deliveries all apply, one at a time. */
  async apply(nodeName: string, network: NodeNetworkConfig): Promise<boolean> {
    const run = this.queue.then(() => this.applyNow(nodeName, network));

    this.queue = run.catch(() => undefined);

    return await run;
  }

  private async applyNow(nodeName: string, network: NodeNetworkConfig): Promise<boolean> {
    const mesh = network.mesh;
    const egressFilter = network.egressFilter;

    if (!mesh && !egressFilter) {
      this.last = null;
      await this.identities.ensure([]);

      const removed = await this.containers.remove(MESH_CONTAINER);

      await rm(this.dir, { recursive: true, force: true });

      return removed;
    }

    this.last = { nodeName, network };

    const wanted = mesh?.identities ?? [];

    await this.identities.ensure(wanted);

    const identity = await this.state.identity();
    const ca = await this.identities.ca();
    const held = ca ? await this.identities.held(wanted) : [];
    const ready = new Set(held.map((h) => h.identity));
    const clusterId = identity?.clusterId ?? '';
    // One admin socket per image: a new release's proxy starts next to the running one (3.26 handover).
    const image = envoyImage();
    const bootstrap = renderMeshBootstrap(nodeName, `${MESH_DIR}/run/${envoyAdminSocketName(image)}`);

    await mkdir(join(this.dir, 'dynamic'), { recursive: true, mode: 0o700 });
    await mkdir(join(this.dir, 'secrets'), { recursive: true, mode: 0o700 });
    await mkdir(join(this.dir, 'run'), { recursive: true, mode: 0o700 });
    await writeFile(join(this.dir, 'bootstrap.json'), bootstrap, { mode: 0o600 });

    // Secrets and clusters before the listeners that use them.
    const secrets = await this.writeSecrets(renderMeshSecrets(held, ca ?? ''));
    const clusters = await this.swap('cds.json', renderMeshClusters(mesh, { clusterId, ready, egressFilter }));
    const listeners = await this.swap(
      'lds.json',
      renderMeshListeners(mesh, {
        clusterId,
        gateways: podNetworkSpec(network).gateways,
        overlay: network.addresses,
        ready,
        egressFilter,
        egressAddresses: network.remoteAccess?.active ? [network.remoteAccess.address.split('/')[0]] : [],
      }),
    );
    const container = await this.handover.ensure(meshSpec(this.dir, bootstrap, image), join(this.dir, 'run'));

    return secrets || clusters || listeners || container;
  }
}
