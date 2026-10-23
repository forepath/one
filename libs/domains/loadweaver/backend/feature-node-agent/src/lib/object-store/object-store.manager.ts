import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { ObjectStoreRole } from '@forepath/loadweaver/shared/util-agent-protocol';
import { Injectable, Logger } from '@nestjs/common';

import { ManagedContainers } from '../host/managed-containers';
import { AgentStateStore } from '../state/agent-state.store';
import {
  garageContainerName,
  garageImage,
  garageSpec,
  OBJECT_STORE_COMPONENT,
  renderGarageConfig,
} from './garage-config';

const GENERATION_DIR = /^g(\d+)$/;

/**
 * Runs the Garage generations this node holds data of (3.20) and removes retired ones together with their data.
 * The control plane forms the cluster (layout, keys, buckets) through the admin API over the overlay.
 */
@Injectable()
export class ObjectStoreManager {
  private readonly logger = new Logger(ObjectStoreManager.name);

  constructor(
    private readonly containers: ManagedContainers,
    private readonly state: AgentStateStore,
  ) {}

  private get root(): string {
    return join(this.state.dir, 'garage');
  }

  async apply(role: ObjectStoreRole | undefined, overlayAddress: string | undefined): Promise<boolean> {
    const wanted = new Set((role?.generations ?? []).map((g) => g.generation));
    let changed = false;

    for (const generation of role?.generations ?? []) {
      if (!overlayAddress) throw new Error('the object store needs the node overlay address');

      const dir = join(this.root, `g${generation.generation}`);
      const config = renderGarageConfig(generation, overlayAddress);

      await mkdir(join(dir, 'meta'), { recursive: true, mode: 0o700 });
      await mkdir(join(dir, 'data'), { recursive: true, mode: 0o700 });
      // Holds the RPC secret and admin token.
      await writeFile(join(dir, 'garage.toml'), config, { mode: 0o600 });
      changed = (await this.containers.ensure(garageSpec(generation, config, dir, garageImage()))) || changed;
    }

    for (const name of await this.containers.list(OBJECT_STORE_COMPONENT)) {
      const generation = Number(/^lw-garage-g(\d+)$/.exec(name)?.[1]);

      if (!wanted.has(generation)) changed = (await this.containers.remove(name)) || changed;
    }

    // Retired generations: the control plane copied the data elsewhere before it removed them.
    const dirs = await readdir(this.root).catch(() => [] as string[]);

    for (const entry of dirs) {
      const generation = Number(GENERATION_DIR.exec(entry)?.[1]);

      if (Number.isInteger(generation) && !wanted.has(generation)) {
        await this.containers.remove(garageContainerName(generation));
        await rm(join(this.root, entry), { recursive: true, force: true });
        this.logger.log(`Removed retired object-store generation ${generation}`);
        changed = true;
      }
    }

    return changed;
  }
}
