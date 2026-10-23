import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Ingress } from '@forepath/loadweaver/shared/util-agent-protocol';
import { Inject, Injectable } from '@nestjs/common';
import type Docker from 'dockerode';

import { DOCKER } from '../host/docker.provider';
import { ManagedContainers } from '../host/managed-containers';
import { defaultFetch, ensureVerifiedFile, type FetchImpl } from '../host/verified-download';
import { AgentStateStore } from '../state/agent-state.store';
import { EnvoyHandover, envoyAdminSocketName } from '../updates/envoy-handover';
import {
  ENVOY_DIR,
  envoyImage,
  envoySpec,
  INGRESS_CONTAINER,
  renderClusters,
  renderEnvoyBootstrap,
  renderListeners,
} from './envoy-config';

/** Where the control plane serves the WAF module (from its release bundle). */
export const WAF_MODULE_ROUTE = '/api/install/waf/coraza.wasm';
const MAX_WAF_MODULE_BYTES = 64 * 1024 * 1024;

/**
 * Runs the node's ingress (3.6): one Envoy, configured through files it watches (filesystem xDS). New listeners and
 * clusters are swapped in by rename, so Envoy only ever sees complete files and keeps existing connections.
 */
@Injectable()
export class IngressManager {
  private readonly handover: EnvoyHandover;

  constructor(
    private readonly containers: ManagedContainers,
    private readonly state: AgentStateStore,
    @Inject(DOCKER) docker: Docker,
  ) {
    this.handover = new EnvoyHandover(containers, docker);
  }

  private get dir(): string {
    return join(this.state.dir, 'ingress');
  }

  /** Writes a dynamic resource file atomically; returns true if it changed. */
  private async swap(file: string, content: string): Promise<boolean> {
    const path = join(this.dir, 'dynamic', file);

    if ((await readFile(path, 'utf8').catch(() => null)) === content) return false;

    const temp = join(this.dir, 'dynamic', `.${file}.loadweaver-new`);

    // Holds private keys: readable for root (Envoy runs as root without capabilities) only.
    await writeFile(temp, content, { mode: 0o600 });
    await rename(temp, path);

    return true;
  }

  /** Overridable for tests. */
  fetchImpl: FetchImpl = defaultFetch;

  /** The WAF module (verified); without it, `enforce` hosts answer 503. */
  private async wafModule(sha256: string): Promise<boolean> {
    return await ensureVerifiedFile(
      join(this.dir, 'waf', 'coraza.wasm'),
      sha256,
      WAF_MODULE_ROUTE,
      this.state,
      this.fetchImpl,
      MAX_WAF_MODULE_BYTES,
    );
  }

  async apply(nodeName: string, ingress: Ingress | undefined): Promise<boolean> {
    if (!ingress) {
      const removed = await this.containers.remove(INGRESS_CONTAINER);

      await rm(this.dir, { recursive: true, force: true });

      return removed;
    }

    await mkdir(join(this.dir, 'dynamic'), { recursive: true, mode: 0o700 });
    await mkdir(join(this.dir, 'run'), { recursive: true, mode: 0o700 });
    await mkdir(join(this.dir, 'waf'), { recursive: true, mode: 0o755 });

    const waf = ingress.wafModule ? await this.wafModule(ingress.wafModule.sha256) : false;

    // One admin socket per image: a new release's Envoy starts next to the running one (3.26 handover).
    const image = envoyImage();
    const bootstrap = renderEnvoyBootstrap(nodeName, `${ENVOY_DIR}/run/${envoyAdminSocketName(image)}`);

    await writeFile(join(this.dir, 'bootstrap.json'), bootstrap, { mode: 0o600 });

    // Clusters first: listeners reference them.
    const clusters = await this.swap('cds.json', renderClusters(ingress));
    const listeners = await this.swap('lds.json', renderListeners(ingress, { wafModule: waf }));
    const container = await this.handover.ensure(envoySpec(this.dir, bootstrap, image), join(this.dir, 'run'));

    return clusters || listeners || container;
  }
}
