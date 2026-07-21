import { Injectable } from '@nestjs/common';

import type { TrustScoreProvider } from './trust-score-provider.interface';

@Injectable()
export class TrustScoreProviderRegistry {
  private readonly providers = new Map<string, TrustScoreProvider>();

  register(provider: TrustScoreProvider): void {
    this.providers.set(provider.id, provider);
  }

  getProviders(): TrustScoreProvider[] {
    return Array.from(this.providers.values());
  }
}
