import { Injectable } from '@nestjs/common';

import { ProviderPriceSnapshotsRepository } from '../repositories/provider-price-snapshots.repository';

@Injectable()
export class ProviderPricingService {
  constructor(private readonly snapshotsRepository: ProviderPriceSnapshotsRepository) {}

  async snapshot(
    provider: string,
    providerProductId: string,
    raw: Record<string, unknown>,
    resolved: number,
    currency: string,
  ) {
    return await this.snapshotsRepository.create({
      provider,
      providerProductId,
      rawPricePayload: raw,
      resolvedBasePrice: resolved.toString(),
      currency,
    });
  }
}
