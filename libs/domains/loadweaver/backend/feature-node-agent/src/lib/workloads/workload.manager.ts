import { mkdir, rm, statfs, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { RegistryClient, WorkloadSpec, WorkloadStatus } from '@forepath/loadweaver/shared/util-agent-protocol';
import { PRIVATE_REGISTRY_HOST } from '@forepath/loadweaver/shared/util-model';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type Docker from 'dockerode';

import { DOCKER } from '../host/docker.provider';
import {
  containerName,
  containerOptions,
  MANAGED_LABEL,
  secretDir,
  WORKLOAD_HASH_LABEL,
  WORKLOAD_LABEL,
  workloadState,
} from './workload-container';
import { SecretBroker } from './secret-broker.service';
import { routedImage } from '../registry/image-routing';
import { blockedBy, ImageScanner } from '../images/image-scanner';

/** `statfs` type of tmpfs; secret files are only ever written there (3.22). */
const TMPFS_MAGIC = 0x01021994;

export function runtimeDir(env: NodeJS.ProcessEnv = process.env): string {
  return env['LOADWEAVER_RUNTIME_DIR'] || '/run/loadweaver';
}

/**
 * Runs the node's workloads through the Docker API (3.11): one container per replica, re-created when its spec
 * hash changes, removed when it is no longer desired. Containers Loadweaver didn't create are never touched.
 */
@Injectable()
export class WorkloadManager {
  private readonly logger = new Logger(WorkloadManager.name);

  /** Workloads an image policy kept from starting, reported as failed. */
  private readonly blocked = new Map<string, { message: string; specHash: string }>();

  constructor(
    @Inject(DOCKER) private readonly docker: Docker,
    private readonly secrets: SecretBroker,
    private readonly scanner: ImageScanner,
  ) {}

  private async managed(): Promise<Docker.ContainerInfo[]> {
    return await this.docker.listContainers({
      all: true,
      filters: { label: [`${MANAGED_LABEL}=true`, WORKLOAD_LABEL] },
    });
  }

  /** Applies the desired workloads; returns true if anything changed. */
  async apply(workloads: WorkloadSpec[], dnsServers: string[], registry?: RegistryClient): Promise<boolean> {
    const existing = await this.managed();
    const desired = new Map(workloads.map((w) => [w.id, w]));

    for (const id of [...this.blocked.keys()]) if (!desired.has(id)) this.blocked.delete(id);
    let changed = false;

    for (const container of existing) {
      const id = container.Labels[WORKLOAD_LABEL];

      if (!desired.has(id)) {
        this.blocked.delete(id);
        await this.remove(container.Id, id);
        changed = true;
      }
    }

    for (const spec of workloads) {
      const current = existing.find((c) => c.Labels[WORKLOAD_LABEL] === spec.id);

      if (current && current.Labels[WORKLOAD_HASH_LABEL] === spec.specHash) {
        // Jobs run once per spec; services are kept running by Docker's restart policy.
        if (spec.kind === 'service' && current.State !== 'running' && spec.restart !== 'no') {
          await this.docker.getContainer(current.Id).start();
          changed = true;
        }

        continue;
      }

      await this.create(spec, dnsServers, registry, current?.Id);
      changed = true;
    }

    // Running images are rescanned daily (3.22).
    this.scanner.track(
      (await this.managed()).flatMap((c) => {
        const spec = workloads.find((w) => w.id === c.Labels[WORKLOAD_LABEL]);
        const digest = spec ? /@(sha256:[0-9a-f]{64})$/.exec(spec.image)?.[1] : undefined;

        return digest && c.Image ? [{ image: c.Image, digest }] : [];
      }),
    );

    return changed;
  }

  /** Pulls and checks the new image first: a blocked update keeps the running version instead of an outage. */
  private async create(
    spec: WorkloadSpec,
    dnsServers: string[],
    registry?: RegistryClient,
    replaces?: string,
  ): Promise<void> {
    const image = await this.pullThroughCluster(spec.image, registry);

    if (!(await this.allowedByPolicy(spec, image))) return;

    if (replaces) await this.remove(replaces, spec.id);

    const secretFiles = await this.writeSecrets(spec);
    const container = await this.docker.createContainer(
      containerOptions({ ...spec, image }, { dnsServers, secretFiles }),
    );

    await container.start();
    this.logger.log(`Started ${spec.id} (${containerName(spec.id)})`);
  }

  /**
   * Image policies (3.22): with vulnerability limits, the pulled image is scanned first; `enforce` keeps a violating
   * (or unscannable) image from starting, `monitor` only logs. Without limits the scan runs in the background, for the
   * report.
   */
  private async allowedByPolicy(spec: WorkloadSpec, image: string): Promise<boolean> {
    const digest = /@(sha256:[0-9a-f]{64})$/.exec(spec.image)?.[1];

    this.blocked.delete(spec.id);

    if (!digest) return true;

    if (!spec.imagePolicy) {
      void this.scanner.scan(image, digest).catch(() => undefined);

      return true;
    }

    const scan = await this.scanner.scan(image, digest).catch(() => null);
    // Each policy on its own: monitor rules only log, any violated enforce rule blocks.
    const violations = spec.imagePolicy.flatMap((rule) => {
      const blocked = scan ? blockedBy(scan, rule) : null;
      const reason =
        blocked === null
          ? `image ${spec.image} could not be scanned`
          : blocked > 0
            ? `image ${spec.image} has ${blocked} ${rule.block.join(' / ').toLowerCase()} vulnerabilities`
            : null;

      return reason ? [{ mode: rule.mode, reason }] : [];
    });

    for (const v of violations.filter((v) => v.mode === 'monitor'))
      this.logger.warn(`${spec.id}: ${v.reason} (image policy, monitor)`);

    const enforced = violations.find((v) => v.mode === 'enforce');

    if (!enforced) return true;

    this.logger.warn(`${spec.id}: not started, ${enforced.reason} (image policy)`);
    this.blocked.set(spec.id, { message: `blocked by image policy: ${enforced.reason}`, specHash: spec.specHash });

    return false;
  }

  private async writeSecrets(spec: WorkloadSpec): Promise<{ source: string; target: string }[]> {
    if (spec.secrets.length === 0) return [];

    const dir = secretDir(runtimeDir(), spec.id);

    await mkdir(dir, { recursive: true, mode: 0o700 });

    const fs = await statfs(dir);

    if (Number(fs.type) !== TMPFS_MAGIC) throw new Error(`refusing to write secrets: ${dir} is not on tmpfs`);

    const files: { source: string; target: string }[] = [];

    for (const [index, secret] of spec.secrets.entries()) {
      const value = await this.secrets.fetch(spec.id, secret.ref);
      const source = join(dir, String(index));

      await writeFile(source, value, { mode: secret.mode ?? 0o444 });
      value.fill(0);
      files.push({ source, target: secret.target });
    }

    return files;
  }

  private async remove(containerId: string, workloadId: string): Promise<void> {
    const container = this.docker.getContainer(containerId);

    try {
      await container.stop();
    } catch {
      // already stopped
    }

    await container.remove({ force: true });
    await rm(secretDir(runtimeDir(), workloadId), { recursive: true, force: true });
    this.logger.log(`Removed ${workloadId}`);
  }

  /**
   * Pulls through the built-in registry (3.22). If the cluster registry can't deliver a public image, the node pulls
   * it from upstream directly; private images only exist in the cluster.
   */
  private async pullThroughCluster(image: string, registry?: RegistryClient): Promise<string> {
    const routed = routedImage(image, registry);

    if (routed === image) {
      await this.pull(image);

      return image;
    }

    try {
      await this.pull(routed);

      return routed;
    } catch (error) {
      if (image.startsWith(`${PRIVATE_REGISTRY_HOST}/`)) throw error;

      this.logger.warn(
        `Cluster registry could not deliver ${image}, pulling from upstream: ${error instanceof Error ? error.message : String(error)}`,
      );
      await this.pull(image);

      return image;
    }
  }

  private async pull(image: string): Promise<void> {
    try {
      await this.docker.getImage(image).inspect();

      return;
    } catch {
      // not present yet
    }

    const stream = await this.docker.pull(image);

    await new Promise<void>((resolve, reject) =>
      this.docker.modem.followProgress(stream, (error: Error | null) => (error ? reject(error) : resolve())),
    );
  }

  /** Current state of every managed workload, reported to the control plane. */
  async status(): Promise<WorkloadStatus> {
    const result: WorkloadStatus['workloads'] = [];

    for (const container of await this.managed()) {
      try {
        const info = await this.docker.getContainer(container.Id).inspect();
        const state = workloadState(info);

        result.push({
          id: container.Labels[WORKLOAD_LABEL],
          specHash: container.Labels[WORKLOAD_HASH_LABEL] ?? '',
          ...state,
        });
      } catch (error) {
        result.push({
          id: container.Labels[WORKLOAD_LABEL],
          specHash: '',
          state: 'failed',
          message: error instanceof Error ? error.message.slice(0, 500) : 'inspect failed',
        });
      }
    }

    for (const [id, blocked] of this.blocked) {
      const running = result.find((w) => w.id === id);

      // A blocked update keeps the old version running: it reports why the new one didn't start.
      if (running) running.message = blocked.message;
      else result.push({ id, specHash: blocked.specHash, state: 'failed', message: blocked.message });
    }

    return { workloads: result };
  }
}
