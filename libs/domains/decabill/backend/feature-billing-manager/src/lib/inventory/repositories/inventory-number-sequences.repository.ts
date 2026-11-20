import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { resolveNumberScopeKey } from '../../utils/number-scope.utils';
import { InventoryNumberSequenceEntity } from '../entities/inventory-number-sequence.entity';

@Injectable()
export class InventoryNumberSequencesRepository {
  constructor(
    @InjectRepository(InventoryNumberSequenceEntity)
    private readonly repository: Repository<InventoryNumberSequenceEntity>,
  ) {}

  /** `ART-{nnnnnn}` (no yearly reset, like customer numbers). */
  async nextArticleNumber(manager?: EntityManager): Promise<{ number: string; numberScope: string }> {
    const { value, scopeKey } = await this.next('ART', 0, manager);

    return { number: `ART-${String(value).padStart(6, '0')}`, numberScope: scopeKey };
  }

  /**
   * `{prefix}-{year}-{nnnnn}` for a movement document. Pass the movement transaction's manager so a rolled back
   * movement releases its number (no gaps from failed movements).
   */
  async nextDocumentNumber(
    prefix: string,
    year: number,
    manager?: EntityManager,
  ): Promise<{ number: string; numberScope: string }> {
    const { value, scopeKey } = await this.next(prefix, year, manager);

    return { number: `${prefix}-${year}-${String(value).padStart(5, '0')}`, numberScope: scopeKey };
  }

  private async next(
    kind: string,
    year: number,
    manager?: EntityManager,
  ): Promise<{ value: number; scopeKey: string }> {
    const scopeKey = resolveNumberScopeKey();
    const run = async (em: EntityManager) => {
      const rows = await em.query(
        `
          INSERT INTO billing_inventory_number_sequences (scope_key, kind, year, last_value)
          VALUES ($1, $2, $3, 1)
          ON CONFLICT (scope_key, kind, year)
          DO UPDATE SET last_value = billing_inventory_number_sequences.last_value + 1
          RETURNING last_value
        `,
        [scopeKey, kind, year],
      );
      const value = Number(rows?.[0]?.last_value);

      if (!Number.isFinite(value) || value < 1) {
        throw new Error(`Failed to allocate ${kind} number for scope ${scopeKey} year ${year}`);
      }

      return { value, scopeKey };
    };

    return manager ? await run(manager) : await this.repository.manager.transaction(run);
  }
}
