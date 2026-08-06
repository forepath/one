import { Injectable } from '@nestjs/common';

import type { DeclaredMeterDefinition } from '../dto/declared-meter.dto';
import type { MeterCollectContext, MeterCollectSample } from '../dto/meter-collect.types';

/**
 * Runtime provider module: collectMeters + optional meter declarations.
 * Distinct from ProviderDetailDto metadata (DYNAMIC_BILLING_PROVIDER_METADATA).
 */
export interface BillingProviderModule {
  /** Matches provider metadata id (hetzner, digital-ocean, …). */
  readonly id: string;
  /**
   * Optional declared meters for interval resolution / sync helpers.
   * Catalog sync still prefers metadata meters when present on ProviderDetailDto.
   */
  readonly meters?: DeclaredMeterDefinition[];
  collectMeters(ctx: MeterCollectContext): Promise<MeterCollectSample[]>;
}

/**
 * Registry of runtime billing provider modules (built-in + DYNAMIC_BILLING_PROVIDER_MODULES).
 */
@Injectable()
export class ProviderModuleRegistryService {
  private readonly modules = new Map<string, BillingProviderModule>();

  register(module: BillingProviderModule): void {
    this.modules.set(module.id, module);
  }

  get(id: string): BillingProviderModule | undefined {
    return this.modules.get(id);
  }

  has(id: string): boolean {
    return this.modules.has(id);
  }

  list(): BillingProviderModule[] {
    return Array.from(this.modules.values());
  }
}
