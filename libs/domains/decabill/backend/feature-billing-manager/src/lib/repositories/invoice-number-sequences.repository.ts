import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { InvoiceNumberSequenceEntity } from '../entities/invoice-number-sequence.entity';
import { getRequiredTenantId } from '../utils/tenant-query.utils';

@Injectable()
export class InvoiceNumberSequencesRepository {
  constructor(
    @InjectRepository(InvoiceNumberSequenceEntity)
    private readonly repository: Repository<InvoiceNumberSequenceEntity>,
  ) {}

  async nextInvoiceNumber(year: number): Promise<string> {
    const tenantId = getRequiredTenantId();

    return await this.repository.manager.transaction(async (manager) => {
      const repo = manager.getRepository(InvoiceNumberSequenceEntity);
      let row = await repo.findOne({ where: { year, tenantId } });

      if (!row) {
        row = repo.create({ year, tenantId, lastValue: 0 });
      }

      row.lastValue += 1;
      await repo.save(row);

      return `INV-${year}-${String(row.lastValue).padStart(5, '0')}`;
    });
  }
}
