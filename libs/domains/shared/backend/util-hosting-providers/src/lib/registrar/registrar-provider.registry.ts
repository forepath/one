import { Injectable, Logger } from '@nestjs/common';

import type { RegistrarProvider, RegistrarProviderFactory } from './registrar-provider.types';

/** Env var for registrar plugins (DS publication for DNSSEC). */
export const DYNAMIC_REGISTRAR_PROVIDERS_ENV = 'DYNAMIC_REGISTRAR_PROVIDERS';

/** Registrar factories, all from plugins, looked up by id. */
@Injectable()
export class RegistrarProviderRegistry {
  private readonly logger = new Logger(RegistrarProviderRegistry.name);
  private readonly factories = new Map<string, RegistrarProviderFactory<never>>();

  register<C>(factory: RegistrarProviderFactory<C>): void {
    if (this.factories.has(factory.id)) {
      this.logger.warn(`Registrar ${factory.id} registered twice; keeping the first`);

      return;
    }

    this.factories.set(factory.id, factory as RegistrarProviderFactory<never>);
  }

  list(): { id: string; displayName: string }[] {
    return [...this.factories.values()].map((f) => ({ id: f.id, displayName: f.displayName }));
  }

  create<C>(id: string, config: C): RegistrarProvider {
    const factory = this.factories.get(id) as RegistrarProviderFactory<C> | undefined;

    if (!factory) throw new Error(`unknown registrar ${id}`);

    return factory.create(config);
  }
}
