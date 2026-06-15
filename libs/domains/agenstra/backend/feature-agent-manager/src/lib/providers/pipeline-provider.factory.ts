import { Injectable, Logger } from '@nestjs/common';

import { PipelineProvider } from './pipeline-provider.interface';

/**
 * Factory service for getting the appropriate pipeline provider based on provider type.
 * Supports multiple CI/CD provider implementations simultaneously.
 */
@Injectable()
export class PipelineProviderFactory {
  private readonly logger = new Logger(PipelineProviderFactory.name);
  private readonly providers = new Map<string, PipelineProvider>();

  /**
   * Register a pipeline provider.
   * @param provider - The pipeline provider implementation to register
   */
  registerProvider(provider: PipelineProvider): void {
    const type = provider.getType();

    if (this.providers.has(type)) {
      this.logger.warn(`Provider with type '${type}' is already registered. Overwriting existing provider.`);
    }

    this.providers.set(type, provider);
    this.logger.log(`Registered pipeline provider: ${type}`);
  }

  /**
   * Get a pipeline provider by type.
   * @param type - The provider type identifier
   * @returns The pipeline provider instance
   * @throws Error if provider is not found
   */
  getProvider(type: string): PipelineProvider {
    const provider = this.providers.get(type);

    if (!provider) {
      const availableTypes = Array.from(this.providers.keys()).join(', ');

      throw new Error(`Pipeline provider with type '${type}' not found. Available types: ${availableTypes || 'none'}`);
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
  getAllProviders(): PipelineProvider[] {
    return Array.from(this.providers.values());
  }
}
