import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { OssThresholdLedgerEntity } from '../entities/oss-threshold-ledger.entity';

@Injectable()
export class OssThresholdLedgersRepository {
  constructor(
    @InjectRepository(OssThresholdLedgerEntity)
    private readonly repository: Repository<OssThresholdLedgerEntity>,
  ) {}

  async findOrCreate(tenantId: string, calendarYear: number): Promise<OssThresholdLedgerEntity> {
    const existing = await this.repository.findOne({ where: { tenantId, calendarYear } });

    if (existing) {
      return existing;
    }

    const thresholdEur = this.parseThreshold();
    const entity = this.repository.create({
      tenantId,
      calendarYear,
      crossBorderB2cNetTotal: 0,
      thresholdEur,
    });

    return await this.repository.save(entity);
  }

  async save(entity: OssThresholdLedgerEntity): Promise<OssThresholdLedgerEntity> {
    return await this.repository.save(entity);
  }

  private parseThreshold(): number {
    const raw = process.env.BILLING_OSS_THRESHOLD_EUR;
    const parsed = raw !== undefined ? Number(raw) : 10_000;

    return Number.isFinite(parsed) && parsed > 0 ? parsed : 10_000;
  }
}
