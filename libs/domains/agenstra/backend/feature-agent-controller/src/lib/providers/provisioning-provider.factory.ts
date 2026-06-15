import { Injectable, Logger } from '@nestjs/common';

import { ProvisioningProvider } from './provisioning-provider.interface';

/**
 * Factory service for getting the appropriate provisioning provider based on provider type.
 * Supports multiple cloud provider implementations simultaneously.
 */
@Injectable()
export class ProvisioningProviderFactory {
  private readonly logger = new Logger(ProvisioningProviderFactory.name);
  private readonly providers = new Map<string, ProvisioningProvider>();

  /**
   * Register a provisioning provider.
   * @param provider - The provisioning provider implementation to register
   */
  registerProvider(provider: ProvisioningProvider): void {
    const type = provider.getType();

    if (this.providers.has(type)) {
      this.logger.warn(`Provider with type '${type}' is already registered. Overwriting existing provider.`);
    }

    this.providers.set(type, provider);
    this.logger.log(`Registered provisioning provider: ${type}`);
  }

  /**
   * Get a provisioning provider by type.
   * @param type - The provider type identifier
   * @returns The provisioning provider instance
   * @throws Error if provider is not found
   */
  getProvider(type: string): ProvisioningProvider {
    const provider = this.providers.get(type);

    if (!provider) {
      const availableTypes = Array.from(this.providers.keys()).join(', ');

      throw new Error(
        `Provisioning provider with type '${type}' not found. Available types: ${availableTypes || 'none'}`,
      );
    }

    return provider;
  }

  /**
   * Check if a provider type is registered.
   * @param type - The provider type identifier
   * @returns True if provider is registered, false otherwise
   */
  hasProvider(type: string): boolean {
    return this.providers.has(type);
  }

  /**
   * Get all registered provider types.
   * @returns Array of registered provider type strings
   */
  getRegisteredTypes(): string[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Get all registered providers.
   * @returns Array of registered provider instances
   */
  getAllProviders(): ProvisioningProvider[] {
    return Array.from(this.providers.values());
  }
}
