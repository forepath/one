import { Injectable, Logger } from '@nestjs/common';

import type { ExternalContextImportProvider } from './external-import-provider.interface';

/**
 * Resolves external context import implementations by provider id (e.g. {@code atlassian}).
 * Same registration model as {@link ProvisioningProviderFactory}.
 */
@Injectable()
export class ExternalImportProviderFactory {
  private readonly logger = new Logger(ExternalImportProviderFactory.name);
  private readonly providers = new Map<string, ExternalContextImportProvider>();

  registerProvider(provider: ExternalContextImportProvider): void {
    const id = provider.getType();

    if (this.providers.has(id)) {
      this.logger.warn(`Import provider '${id}' is already registered. Overwriting existing provider.`);
    }

    this.providers.set(id, provider);
    this.logger.log(`Registered external import provider: ${id}`);
  }

  getProvider(providerId: string): ExternalContextImportProvider {
    const provider = this.providers.get(providerId);

    if (!provider) {
      const available = Array.from(this.providers.keys()).join(', ');

      throw new Error(`Import provider '${providerId}' is not registered. Available: ${available || 'none'}`);
    }

    return provider;
  }

  hasProvider(providerId: string): boolean {
    return this.providers.has(providerId);
  }

  getRegisteredProviderIds(): string[] {
    return Array.from(this.providers.keys());
  }

  getAllProviders(): ExternalContextImportProvider[] {
    return Array.from(this.providers.values());
  }
}
