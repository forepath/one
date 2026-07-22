import { Injectable } from '@nestjs/common';

import type {
  BillingStatisticsByCountryDto,
  BillingStatisticsByProductDto,
  BillingStatisticsSummaryDto,
} from '../dto/admin-billing.dto';
import { InvoicesRepository } from '../repositories/invoices.repository';
import { resolveCountryDisplayName } from '../utils/country-display-name.util';

@Injectable()
export class BillingStatisticsQueryService {
  constructor(private readonly invoicesRepository: InvoicesRepository) {}

  async getSummary(params: {
    from: Date;
    to: Date;
    groupBy: 'day' | 'month';
    userId?: string;
  }): Promise<BillingStatisticsSummaryDto> {
    const [series, paidCount] = await Promise.all([
      this.invoicesRepository.sumPaidGrossByPeriod(params.from, params.to, params.groupBy, params.userId),
      this.invoicesRepository.countPaidInPeriod(params.from, params.to, params.userId),
    ]);
    const totalGross = series.reduce((sum, point) => sum + point.totalGross, 0);

    return {
      series,
      totalGross: Math.round(totalGross * 100) / 100,
      paidCount,
      from: params.from.toISOString().slice(0, 10),
      to: params.to.toISOString().slice(0, 10),
      groupBy: params.groupBy,
    };
  }

  async getByProduct(params: { from: Date; to: Date; userId?: string }): Promise<BillingStatisticsByProductDto> {
    const items = await this.invoicesRepository.sumByPlanInPeriod(params.from, params.to, params.userId);
    const totalGross = items.reduce((sum, item) => sum + item.totalGross, 0);

    return {
      items,
      totalGross: Math.round(totalGross * 100) / 100,
      from: params.from.toISOString().slice(0, 10),
      to: params.to.toISOString().slice(0, 10),
    };
  }

  async getByCountry(params: { from: Date; to: Date; userId?: string }): Promise<BillingStatisticsByCountryDto> {
    const rows = await this.invoicesRepository.sumByBuyerCountryInPeriod(params.from, params.to, params.userId);
    const items = rows.map((row) => ({
      countryCode: row.countryCode,
      countryName:
        row.countryCode === 'UNKNOWN' ? 'Unknown' : (resolveCountryDisplayName(row.countryCode) ?? row.countryCode),
      totalGross: row.totalGross,
    }));
    const totalGross = items.reduce((sum, item) => sum + item.totalGross, 0);

    return {
      items,
      totalGross: Math.round(totalGross * 100) / 100,
      from: params.from.toISOString().slice(0, 10),
      to: params.to.toISOString().slice(0, 10),
    };
  }
}
