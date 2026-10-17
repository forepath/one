import { createHash } from 'node:crypto';
import { request } from 'node:http';
import { basename, join } from 'node:path';

import { Logger } from '@nestjs/common';
import type Docker from 'dockerode';

import { MANAGED_LABEL, type ManagedContainers, type ManagedContainerSpec } from '../host/managed-containers';

const logger = new Logger('EnvoyHandover');
const DRAINING = '-draining-';

/** How long the old Envoy keeps serving its connections after the new one took over (seconds). */
export function envoyDrainSeconds(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env['LOADWEAVER_ENVOY_DRAIN_SECONDS']);

  return Number.isFinite(raw) && raw >= 0 && raw <= 3600 ? raw : 30;
}

/**
 * Admin socket of an Envoy built from `image`, inside the container's run directory. One per image, so the next
 * version can start while the current one still owns its socket (3.26 hot handover).
 */
export function envoyAdminSocketName(image: string): string {
  return `admin-${createHash('sha256').update(image).digest('hex').slice(0, 12)}.sock`;
}

function adminCall(
  socketPath: string,
  method: 'GET' | 'POST',
  path: string,
  timeoutMs = 2_000,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ socketPath, method, path, timeout: timeoutMs }, (res) => {
      const chunks: Buffer[] = [];

      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });

    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

async function waitReady(socketPath: string, timeoutMs: number): Promise<void> {
  const end = Date.now() + timeoutMs;
  let last = 'no answer';

  while (Date.now() < end) {
    try {
      const res = await adminCall(socketPath, 'GET', '/ready');

      if (res.status === 200) return;

      last = `${res.status} ${res.body.trim()}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }

    await new Promise((r) => setTimeout(r, 250));
  }

  throw new Error(`the new Envoy did not become ready: ${last}`);
}

/**
 * Updates an Envoy (ingress, node proxy) without dropping connections (3.26 "hot restart with connection draining").
 * Envoy's own hot restart needs both processes in one container; across images the agent does the equivalent:
 * the running container is renamed, the new one starts next to it (listeners use SO_REUSEPORT, Envoy's default on
 * Linux, so both accept), and once the new one is ready the old one drains (`/drain_listeners?graceful`: new
 * connections go to the new Envoy, existing ones finish) and is removed after the drain time. If the new one doesn't
 * get ready, it is removed and the old one keeps serving under its name.
 */
export class EnvoyHandover {
  constructor(
    private readonly containers: ManagedContainers,
    private readonly docker: Docker,
  ) {}

  /** `runDir`: the host directory mounted as the container's `run/` (where admin sockets live). */
  async ensure(spec: ManagedContainerSpec, runDir: string, drainSeconds = envoyDrainSeconds()): Promise<boolean> {
    await this.cleanup(spec.name, drainSeconds);

    let current: Docker.ContainerInspectInfo | null = null;

    try {
      current = await this.docker.getContainer(spec.name).inspect();
    } catch {
      current = null;
    }

    const imageChanges =
      !!current &&
      current.State.Running &&
      current.Config.Labels?.[MANAGED_LABEL] === 'true' &&
      current.Config.Image !== spec.image;

    if (!current || !imageChanges) return await this.containers.ensure(spec);

    const oldImage = current.Config.Image;
    const draining = `${spec.name}${DRAINING}${Date.now()}`;

    await this.docker.getContainer(spec.name).rename({ name: draining });

    try {
      await this.containers.pull(spec.image);
      await this.containers.ensure(spec);
      await waitReady(join(runDir, envoyAdminSocketName(spec.image)), 60_000);
    } catch (error) {
      // The old Envoy keeps serving under its name.
      await this.containers.remove(spec.name);
      await this.docker.getContainer(draining).rename({ name: spec.name });
      throw error;
    }

    // Older agents used one admin socket for every image.
    const sockets = [join(runDir, envoyAdminSocketName(oldImage)), join(runDir, 'admin.sock')];
    let drained = false;

    for (const socket of sockets) {
      try {
        if ((await adminCall(socket, 'POST', '/drain_listeners?graceful')).status === 200) {
          drained = true;
          break;
        }
      } catch {
        // try the next socket
      }
    }

    if (!drained)
      logger.warn(`${spec.name}: the previous Envoy could not be drained; it is stopped after ${drainSeconds} s`);

    logger.log(`${spec.name}: ${basename(oldImage)} → ${basename(spec.image)} handed over, draining ${drainSeconds} s`);
    setTimeout(() => void this.containers.remove(draining), drainSeconds * 1000).unref();

    return true;
  }

  /** Removes draining Envoys left behind (e.g. by an agent restart during a handover) once their time is up. */
  private async cleanup(name: string, drainSeconds: number): Promise<void> {
    const all = await this.docker.listContainers({ all: true, filters: { label: [`${MANAGED_LABEL}=true`] } });

    for (const c of all)
      for (const n of c.Names.map((x) => x.replace(/^\//, ''))) {
        if (!n.startsWith(`${name}${DRAINING}`)) continue;

        const since = Number(n.slice(name.length + DRAINING.length));

        if (!Number.isFinite(since) || Date.now() - since > drainSeconds * 1000) await this.containers.remove(n);
      }
  }
}
