import type { BillingAddonModule } from '../../services/addon-module-registry.service';
import { clampContributorJobIntervalMs } from '../../utils/contributor-job.types';
import { CONTAINER_MANAGER_MODULE_KEY } from '../../utils/plan-addons.utils';

import type { ContainerManagerCollectService } from './services/container-manager-collect.service';

const DEFAULT_COLLECT_INTERVAL_MS = 60_000;

/**
 * First-party Container Manager addon module.
 * Host diagnostics run over SSH from ContainerManagerService; provision/teardown are readiness no-ops.
 */
export function createBuiltinAddonModules(collectService?: ContainerManagerCollectService): BillingAddonModule[] {
  return [
    {
      key: CONTAINER_MANAGER_MODULE_KEY,
      displayName: 'Container Manager',
      serviceTabs: [
        {
          id: 'container-manager',
          label: 'Container Manager',
          order: 100,
        },
      ],
      jobs: collectService
        ? [
            {
              key: 'collect-stats',
              intervalMs: parseContainerManagerCollectIntervalMs(),
              run: (ctx) => collectService.collectTenant(ctx),
            },
          ]
        : [],
      async provision(): Promise<void> {
        // No remote install required; Docker is already present on integrated stacks.
      },
      async teardown(): Promise<void> {
        // No remote teardown; diagnostics are read-only.
      },
    },
  ];
}

function parseContainerManagerCollectIntervalMs(): number {
  const raw = process.env.BILLING_CONTAINER_MANAGER_COLLECT_INTERVAL?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : DEFAULT_COLLECT_INTERVAL_MS;

  return clampContributorJobIntervalMs(Number.isFinite(parsed) ? parsed : DEFAULT_COLLECT_INTERVAL_MS);
}
