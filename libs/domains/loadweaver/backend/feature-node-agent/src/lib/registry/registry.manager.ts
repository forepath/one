import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { RegistryRole } from '@forepath/loadweaver/shared/util-agent-protocol';
import { Injectable } from '@nestjs/common';

import { ManagedContainers } from '../host/managed-containers';
import { AgentStateStore } from '../state/agent-state.store';
import { REGISTRY_COMPONENT, registryImage, registrySpec, renderRegistryInstances } from './registry-config';

/** Runs the built-in registry instances on control-plane members (3.22). */
@Injectable()
export class RegistryManager {
  constructor(
    private readonly containers: ManagedContainers,
    private readonly state: AgentStateStore,
  ) {}

  private get dir(): string {
    return join(this.state.dir, 'registry');
  }

  async apply(role: RegistryRole | undefined, overlayAddress: string | undefined): Promise<boolean> {
    let changed = false;
    const wanted = new Set<string>();

    if (role) {
      if (!overlayAddress) throw new Error('the registry needs the node overlay address');

      await mkdir(this.dir, { recursive: true, mode: 0o700 });
      await writeFile(join(this.dir, 'ca.pem'), role.token.rootCertificatePem, { mode: 0o644 });

      for (const instance of renderRegistryInstances(role, overlayAddress)) {
        wanted.add(instance.name);
        // Holds the S3 key and the HTTP secret.
        await writeFile(join(this.dir, `${instance.name}.yml`), instance.config, { mode: 0o600 });
        changed =
          (await this.containers.ensure(
            registrySpec(instance, this.dir, role.token.rootCertificatePem, registryImage()),
          )) || changed;
      }
    }

    for (const name of await this.containers.list(REGISTRY_COMPONENT)) {
      if (wanted.has(name)) continue;

      changed = (await this.containers.remove(name)) || changed;
      await rm(join(this.dir, `${name}.yml`), { force: true });
    }

    return changed;
  }
}
