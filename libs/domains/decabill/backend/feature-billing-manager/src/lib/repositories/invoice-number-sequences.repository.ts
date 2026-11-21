import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { InvoiceNumberSequenceEntity } from '../entities/invoice-number-sequence.entity';
import { resolveNumberScopeKey } from '../utils/number-scope.utils';

@Injectable()
export class InvoiceNumberSequencesRepository {
  constructor(
    @InjectRepository(InvoiceNumberSequenceEntity)
    private readonly repository: Repository<InvoiceNumberSequenceEntity>,
  ) {}

  /** Allocates the next number; pass the issuing transaction's manager so a failed issue does not burn a number. */
  async nextInvoiceNumber(year: number, outerManager?: EntityManager): Promise<string> {
    const tenantId = resolveNumberScopeKey();
    const run = async (manager: EntityManager): Promise<string> => {
      const rows = await manager.query(
        `
          INSERT INTO billing_invoice_number_sequences (tenant_id, year, last_value)
          VALUES ($1, $2, 1)
          ON CONFLICT (tenant_id, year)
          DO UPDATE SET last_value = billing_invoice_number_sequences.last_value + 1
          RETURNING last_value
        `,
        [tenantId, year],
      );
      const lastValue = Number(rows?.[0]?.last_value);

      if (!Number.isFinite(lastValue) || lastValue < 1) {
        throw new Error(`Failed to allocate invoice number for scope ${tenantId} year ${year}`);
      }

      return `INV-${year}-${String(lastValue).padStart(5, '0')}`;
    };

    return outerManager ? await run(outerManager) : await this.repository.manager.transaction(run);
  }
}
