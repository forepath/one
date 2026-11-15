import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { SubscriptionNumberSequenceEntity } from '../entities/subscription-number-sequence.entity';
import { resolveNumberScopeKey } from '../utils/number-scope.utils';

@Injectable()
export class SubscriptionNumberSequencesRepository {
  constructor(
    @InjectRepository(SubscriptionNumberSequenceEntity)
    private readonly repository: Repository<SubscriptionNumberSequenceEntity>,
  ) {}

  async nextSubscriptionNumber(): Promise<{ number: string; numberScope: string }> {
    const scopeKey = resolveNumberScopeKey();

    return await this.repository.manager.transaction(async (manager) => {
      const rows = await manager.query(
        `
          INSERT INTO billing_subscription_number_sequences (scope_key, last_value)
          VALUES ($1, 1)
          ON CONFLICT (scope_key)
          DO UPDATE SET last_value = billing_subscription_number_sequences.last_value + 1
          RETURNING last_value
        `,
        [scopeKey],
      );
      const lastValue = Number(rows?.[0]?.last_value);

      if (!Number.isFinite(lastValue) || lastValue < 1) {
        throw new Error(`Failed to allocate subscription number for scope ${scopeKey}`);
      }

      return {
        number: `SUB-${String(lastValue).padStart(6, '0')}`,
        numberScope: scopeKey,
      };
    });
  }
}
