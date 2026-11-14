import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { SupplierInvoiceNumberSequenceEntity } from '../entities/supplier-invoice-number-sequence.entity';
import { resolveNumberScopeKey } from '../utils/number-scope.utils';

@Injectable()
export class SupplierInvoiceNumberSequencesRepository {
  constructor(
    @InjectRepository(SupplierInvoiceNumberSequenceEntity)
    private readonly repository: Repository<SupplierInvoiceNumberSequenceEntity>,
  ) {}

  async nextInvoiceNumber(year: number): Promise<string> {
    const tenantId = resolveNumberScopeKey();

    return await this.repository.manager.transaction(async (manager) => {
      const rows = await manager.query(
        `
          INSERT INTO billing_supplier_invoice_number_sequences (tenant_id, year, last_value)
          VALUES ($1, $2, 1)
          ON CONFLICT (tenant_id, year)
          DO UPDATE SET last_value = billing_supplier_invoice_number_sequences.last_value + 1
          RETURNING last_value
        `,
        [tenantId, year],
      );
      const lastValue = Number(rows?.[0]?.last_value);

      if (!Number.isFinite(lastValue) || lastValue < 1) {
        throw new Error(`Failed to allocate supplier invoice number for scope ${tenantId} year ${year}`);
      }

      return `SINV-${year}-${String(lastValue).padStart(5, '0')}`;
    });
  }
}
