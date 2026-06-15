import { Injectable, Logger } from '@nestjs/common';

import { AgentProvider } from './agent-provider.interface';

/**
 * Factory service for getting the appropriate agent provider based on agent type.
 * Supports multiple agent implementations simultaneously.
 */
@Injectable()
export class AgentProviderFactory {
  private readonly logger = new Logger(AgentProviderFactory.name);
  private readonly providers = new Map<string, AgentProvider>();

  /**
   * Register an agent provider.
   * @param provider - The agent provider implementation to register
   */
  registerProvider(provider: AgentProvider): void {
    const type = provider.getType();

    if (this.providers.has(type)) {
      this.logger.warn(`Provider with type '${type}' is already registered. Overwriting existing provider.`);
    }

    this.providers.set(type, provider);
    this.logger.log(`Registered agent provider: ${type}`);
  }

  /**
   * Get an agent provider by type.
   * @param type - The agent type identifier
   * @returns The agent provider instance
   * @throws Error if provider is not found
   */
  getProvider(type: string): AgentProvider {
    const provider = this.providers.get(type);

    if (!provider) {
      const availableTypes = Array.from(this.providers.keys()).join(', ');

      throw new Error(`Agent provider with type '${type}' not found. Available types: ${availableTypes || 'none'}`);
    }

    return provider;
  }

  /**
   * Check if a provider type is registered.
   * @param type - The agent type identifier
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
}
