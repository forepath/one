import { Injectable, Logger } from '@nestjs/common';

import { DEFAULT_POSTAL_PROVIDER } from '../constants/postal-letter.constants';

import type { PostalProvider } from './postal-provider.interface';

/** Registry of postal providers (built-in Pingen plus `DYNAMIC_POSTAL_PROVIDERS`), like `PaymentProcessorFactory`. */
@Injectable()
export class PostalProviderFactory {
  private readonly logger = new Logger(PostalProviderFactory.name);
  private readonly providers = new Map<string, PostalProvider>();

  registerProvider(provider: PostalProvider): void {
    const type = provider.getType();

    if (this.providers.has(type)) {
      this.logger.warn(`Postal provider '${type}' is already registered. Overwriting.`);
    }

    this.providers.set(type, provider);
    this.logger.log(`Registered postal provider: ${type}`);
  }

  /** Registered provider or `null` (unknown types never reach provider code). */
  findProvider(type: string): PostalProvider | null {
    return this.providers.get(type) ?? null;
  }

  getProvider(type: string): PostalProvider {
    const provider = this.findProvider(type);

    if (!provider) {
      const available = Array.from(this.providers.keys()).join(', ');

      throw new Error(`Postal provider '${type}' not found. Available: ${available || 'none'}`);
    }

    return provider;
  }

  getRegisteredTypes(): string[] {
    return Array.from(this.providers.keys());
  }

  /** Provider type configured for the current tenant (`BILLING_DEFAULT_POSTAL_PROVIDER`, default `pingen`). */
  resolveDefaultType(): string {
    return process.env.BILLING_DEFAULT_POSTAL_PROVIDER?.trim() || DEFAULT_POSTAL_PROVIDER;
  }

  /** The current tenant's default provider when it is registered and configured; otherwise `null`. */
  getDefaultConfiguredProvider(): PostalProvider | null {
    const provider = this.findProvider(this.resolveDefaultType());

    return provider?.isConfigured() ? provider : null;
  }
}
