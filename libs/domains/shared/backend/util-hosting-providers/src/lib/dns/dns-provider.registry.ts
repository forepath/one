import { Injectable, Logger } from '@nestjs/common';

import { cloudflareDnsProviderFactory } from './cloudflare-dns.provider';
import type { DnsProvider, DnsProviderFactory } from './dns-provider.types';

/** Env var for further DNS providers as dynamic plugins (Hetzner DNS, DigitalOcean, Route 53, ...). */
export const DYNAMIC_DNS_PROVIDERS_ENV = 'DYNAMIC_DNS_PROVIDERS';

/** Built-in and plugin DNS provider factories, looked up by id. */
@Injectable()
export class DnsProviderRegistry {
  private readonly logger = new Logger(DnsProviderRegistry.name);
  private readonly factories = new Map<string, DnsProviderFactory<never>>();

  constructor() {
    this.register(cloudflareDnsProviderFactory);
  }

  register<C>(factory: DnsProviderFactory<C>): void {
    if (this.factories.has(factory.id)) {
      this.logger.warn(`DNS provider ${factory.id} registered twice; keeping the first`);

      return;
    }

    this.factories.set(factory.id, factory as DnsProviderFactory<never>);
  }

  list(): { id: string; displayName: string }[] {
    return [...this.factories.values()].map((f) => ({ id: f.id, displayName: f.displayName }));
  }

  create<C>(id: string, config: C): DnsProvider {
    const factory = this.factories.get(id) as DnsProviderFactory<C> | undefined;

    if (!factory) throw new Error(`unknown DNS provider ${id}`);

    return factory.create(config);
  }
}
