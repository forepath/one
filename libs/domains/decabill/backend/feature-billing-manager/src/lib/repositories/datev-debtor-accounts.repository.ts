import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { DatevExportScope, DatevExportStatus } from '../constants/datev-export.constants';
import { DatevDebtorAccountEntity } from '../entities/datev-debtor-account.entity';

@Injectable()
export class DatevDebtorAccountsRepository {
  constructor(
    @InjectRepository(DatevDebtorAccountEntity)
    private readonly repository: Repository<DatevDebtorAccountEntity>,
  ) {}

  async findByTenantAndUserId(tenantId: string, userId: string): Promise<DatevDebtorAccountEntity | null> {
    return await this.repository.findOne({ where: { tenantId, userId } });
  }

  async findMaxDebtorNumber(tenantId: string): Promise<number | null> {
    const row = await this.repository
      .createQueryBuilder('debtor')
      .select('MAX(debtor.debtor_number)', 'max')
      .where('debtor.tenant_id = :tenantId', { tenantId })
      .getRawOne<{ max: string | null }>();

    if (row?.max == null) {
      return null;
    }

    const parsed = parseInt(String(row.max), 10);

    return Number.isFinite(parsed) ? parsed : null;
  }

  async create(tenantId: string, userId: string, debtorNumber: number): Promise<DatevDebtorAccountEntity> {
    const entity = this.repository.create({ tenantId, userId, debtorNumber });

    return await this.repository.save(entity);
  }
}

export { DatevExportScope, DatevExportStatus };
