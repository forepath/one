import { Injectable } from '@nestjs/common';
import type { MigrationInterface } from 'typeorm';

import type { IntegratedProvisioningService } from '../utils/cloud-init/integrated-provisioning-service';
import type { ContributorJobDefinition } from '../utils/contributor-job.types';
import type { ServiceTabDefinition } from '../utils/service-detail-tabs.utils';

/** Inputs for an integrated stack to build cloud-init user-data at provision time. */
export interface IntegratedStackProvisionContext {
  hostname: string;
  baseDomain: string;
  effectiveConfig: Record<string, unknown>;
}

/**
 * First-party or dynamically loaded integrated product stack.
 * First-party stacks provide `buildUserData`; tab-only DYNAMIC modules may omit it.
 */
export interface IntegratedStackModule {
  readonly key: IntegratedProvisioningService | string;
  readonly displayName: string;
  /**
   * Cloud-init user-data for this stack. Required to provision the product; omitted on tab-only modules.
   */
  readonly buildUserData?: (ctx: IntegratedStackProvisionContext) => string;
  /**
   * Per-provisioning secrets the stack needs in its user-data (e.g. Loadweaver's one-time admin claim token). Called
   * right before `buildUserData`; the returned entries are merged into the effective config and persisted in the
   * item's encrypted `configSnapshot` (never part of item responses) so the stack can show them to the customer later.
   */
  readonly prepareProvisioningConfig?: () => Record<string, unknown>;
  /**
   * SSH update command for already-provisioned hosts (image pull / compose recreate).
   */
  readonly buildUpdateCommand?: () => string;
  /**
   * The product updates itself (e.g. Loadweaver's own rollout from signed release bundles). The subscription-update
   * scheduler then never runs a compose image pull for it; `buildUpdateCommand`, if any, must not pull or recreate
   * the product (Loadweaver only re-pins its console image to the version the cluster installed).
   */
  readonly selfUpdating?: boolean;
  /**
   * Additional service-detail tabs when the item's configSnapshot.service matches this key.
   */
  readonly serviceTabs?: ServiceTabDefinition[];
  readonly jobs?: ContributorJobDefinition[];
  readonly migrations?: Array<new () => MigrationInterface>;
}

/**
 * Registry of integrated stack modules (first-party contributors + DYNAMIC_INTEGRATED_STACK_MODULES).
 */
@Injectable()
export class IntegratedStackRegistryService {
  private readonly modules = new Map<string, IntegratedStackModule>();

  register(module: IntegratedStackModule): void {
    this.modules.set(module.key, module);
  }

  get(key: string): IntegratedStackModule | undefined {
    return this.modules.get(key);
  }

  has(key: string): boolean {
    return this.modules.has(key);
  }

  list(): IntegratedStackModule[] {
    return Array.from(this.modules.values());
  }
}
