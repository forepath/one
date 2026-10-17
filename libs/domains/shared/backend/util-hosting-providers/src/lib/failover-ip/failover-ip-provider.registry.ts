import { Injectable, Logger } from '@nestjs/common';

import type { FailoverIpProvider, FailoverIpProviderFactory } from './failover-ip-provider.types';
import { hetznerFailoverIpProviderFactory } from './hetzner-failover-ip.provider';

/** Env var for further failover-IP providers as dynamic plugins. */
export const DYNAMIC_FAILOVER_IP_PROVIDERS_ENV = 'DYNAMIC_FAILOVER_IP_PROVIDERS';

@Injectable()
export class FailoverIpProviderRegistry {
  private readonly logger = new Logger(FailoverIpProviderRegistry.name);
  private readonly factories = new Map<string, FailoverIpProviderFactory<never>>();

  constructor() {
    this.register(hetznerFailoverIpProviderFactory);
  }

  register<C>(factory: FailoverIpProviderFactory<C>): void {
    if (this.factories.has(factory.id)) {
      this.logger.warn(`Failover-IP provider ${factory.id} registered twice; keeping the first`);

      return;
    }

    this.factories.set(factory.id, factory as FailoverIpProviderFactory<never>);
  }

  create<C>(id: string, config: C): FailoverIpProvider {
    const factory = this.factories.get(id) as FailoverIpProviderFactory<C> | undefined;

    if (!factory) throw new Error(`unknown failover-IP provider ${id}`);

    return factory.create(config);
  }
}
