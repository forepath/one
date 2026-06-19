import { Injectable } from '@nestjs/common';

import { ProviderDetailDto } from '../dto/provider-detail.dto';

/**
 * Registry of billing/provisioning providers.
 * Returns provider details (id, displayName, configSchema) for use in service type creation
 * and subscription configuration. Follows the same pattern as agent-controller's provider factory:
 * providers register themselves and the registry exposes the list to clients.
 */
@Injectable()
export class ProviderRegistryService {
  private readonly providers = new Map<string, ProviderDetailDto>();

  /**
   * Register a provider. Overwrites if id already exists.
   */
  register(detail: ProviderDetailDto): void {
    this.providers.set(detail.id, { ...detail });
  }

  /**
   * Get all registered provider details.
   */
  getProviders(): ProviderDetailDto[] {
    return Array.from(this.providers.values());
  }

  /**
   * Check if a provider id is registered.
   */
  hasProvider(id: string): boolean {
    return this.providers.has(id);
  }
}
