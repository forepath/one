import { Injectable, Logger } from '@nestjs/common';

export interface TypedProvider {
  getType(): string;
}

@Injectable()
export class ProviderRegistry<T extends TypedProvider> {
  private readonly logger = new Logger(ProviderRegistry.name);
  private readonly providers = new Map<string, T>();

  register(id: string, provider: T): void {
    if (this.providers.has(id)) {
      this.logger.warn(`Provider with id '${id}' is already registered. Overwriting existing provider.`);
    }

    this.providers.set(id, provider);
    this.logger.log(`Registered provider: ${id}`);
  }

  getProvider(id: string): T {
    const provider = this.providers.get(id);

    if (!provider) {
      const available = Array.from(this.providers.keys()).join(', ');

      throw new Error(`Provider with id '${id}' not found. Available ids: ${available || 'none'}`);
    }

    return provider;
  }

  hasProvider(id: string): boolean {
    return this.providers.has(id);
  }

  getRegisteredIds(): string[] {
    return Array.from(this.providers.keys());
  }

  /** @deprecated Use getRegisteredIds — kept for migration from legacy factories. */
  getRegisteredTypes(): string[] {
    return this.getRegisteredIds();
  }

  getAll(): T[] {
    return Array.from(this.providers.values());
  }
}
