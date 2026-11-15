import { Injectable } from '@nestjs/common';

import type { ContributorJobDefinition, RegisteredContributorJob } from '../utils/contributor-job.types';
import { sanitizeContributorJobDefinition } from '../utils/contributor-job.types';

import { AddonModuleRegistryService } from './addon-module-registry.service';
import { CloudInitModuleRegistryService } from './cloud-init-module-registry.service';
import { IntegratedStackRegistryService } from './integrated-stack-registry.service';
import { ProviderModuleRegistryService } from './provider-module-registry.service';

@Injectable()
export class ContributorJobRegistryService {
  private jobs: RegisteredContributorJob[] = [];

  constructor(
    private readonly addonModuleRegistry: AddonModuleRegistryService,
    private readonly integratedStackRegistry: IntegratedStackRegistryService,
    private readonly cloudInitModuleRegistry: CloudInitModuleRegistryService,
    private readonly providerModuleRegistry: ProviderModuleRegistryService,
  ) {}

  /**
   * Flatten and validate jobs from provider, addon, integrated-stack, and CloudInit code modules.
   * Call after builtin + `DYNAMIC_*` registration.
   */
  rebuild(): void {
    const next: RegisteredContributorJob[] = [];
    const seen = new Set<string>();

    this.appendJobs(next, seen, 'provider', this.providerModuleRegistry.list());
    this.appendJobs(next, seen, 'addon', this.addonModuleRegistry.list());
    this.appendJobs(next, seen, 'integrated', this.integratedStackRegistry.list());
    this.appendJobs(next, seen, 'cloud-init', this.cloudInitModuleRegistry.list());

    this.jobs = next;
  }

  list(): RegisteredContributorJob[] {
    return [...this.jobs];
  }

  private appendJobs(
    target: RegisteredContributorJob[],
    seen: Set<string>,
    source: RegisteredContributorJob['source'],
    modules: ReadonlyArray<{ key?: string; id?: string; jobs?: ContributorJobDefinition[] }>,
  ): void {
    for (const module of modules) {
      const sourceKey = (module.key ?? module.id)?.trim() ?? '';

      for (const raw of module.jobs ?? []) {
        const definition = sanitizeContributorJobDefinition(raw);
        const identity = `${source}:${sourceKey}:${definition.key}`;

        if (seen.has(identity)) {
          throw new Error('Duplicate contributor job registration');
        }

        seen.add(identity);
        target.push({ source, sourceKey, definition });
      }
    }
  }
}
