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

  /**
   * Atomically adds `delta` (negative on voids / credit notes) to the year's cross-border B2C total and returns
   * the totals before and after (no lost updates under concurrent issuance).
   */
  async adjustTotal(
    tenantId: string,
    calendarYear: number,
    delta: number,
  ): Promise<{ previous: number; next: number; thresholdEur: number; thresholdExceededAt: Date | null }> {
    const rows: Array<{ total: string; threshold_eur: string; threshold_exceeded_at: Date | null }> =
      await this.repository.manager.query(
        `
          INSERT INTO billing_oss_threshold_ledgers (tenant_id, calendar_year, cross_border_b2c_net_total, threshold_eur)
          VALUES ($1, $2, GREATEST($3::numeric, 0), $4)
          ON CONFLICT (tenant_id, calendar_year)
          DO UPDATE SET cross_border_b2c_net_total =
            GREATEST(billing_oss_threshold_ledgers.cross_border_b2c_net_total + $3::numeric, 0),
            updated_at = now()
          RETURNING cross_border_b2c_net_total AS total, threshold_eur, threshold_exceeded_at
        `,
        [tenantId, calendarYear, delta, this.parseThreshold()],
      );
    const row = rows[0];
    const next = Math.round(Number(row.total) * 100) / 100;

    return {
      previous: Math.round((next - delta) * 100) / 100,
      next,
      thresholdEur: Number(row.threshold_eur),
      thresholdExceededAt: row.threshold_exceeded_at ? new Date(row.threshold_exceeded_at) : null,
    };
  }

  async markThresholdExceeded(tenantId: string, calendarYear: number, at: Date): Promise<boolean> {
    const result = await this.repository
      .createQueryBuilder()
      .update(OssThresholdLedgerEntity)
      .set({ thresholdExceededAt: at })
      .where('tenant_id = :tenantId AND calendar_year = :calendarYear AND threshold_exceeded_at IS NULL', {
        tenantId,
        calendarYear,
      })
      .execute();

    return (result.affected ?? 0) > 0;
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
