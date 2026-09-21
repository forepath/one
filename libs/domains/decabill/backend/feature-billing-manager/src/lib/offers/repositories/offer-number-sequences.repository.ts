import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { OfferNumberSequenceEntity } from '../entities/offer-number-sequence.entity';
import { resolveNumberScopeKey } from '../../utils/number-scope.utils';

@Injectable()
export class OfferNumberSequencesRepository {
  constructor(
    @InjectRepository(OfferNumberSequenceEntity)
    private readonly repository: Repository<OfferNumberSequenceEntity>,
  ) {}

  async nextOfferNumber(year: number): Promise<{ number: string; numberScope: string }> {
    const tenantId = resolveNumberScopeKey();

    return await this.repository.manager.transaction(async () => {
      const rows = await this.repository.query(
        `
          INSERT INTO billing_offer_number_sequences (tenant_id, year, last_value)
          VALUES ($1, $2, 1)
          ON CONFLICT (tenant_id, year)
          DO UPDATE SET last_value = billing_offer_number_sequences.last_value + 1
          RETURNING last_value
        `,
        [tenantId, year],
      );

      const lastValue = Number(rows?.[0]?.last_value);

      if (!Number.isFinite(lastValue) || lastValue < 1) {
        throw new Error(`Failed to allocate offer number for scope ${tenantId} year ${year}`);
      }

      return {
        number: `OFF-${year}-${String(lastValue).padStart(5, '0')}`,
        numberScope: tenantId,
      };
    });
  }
}
