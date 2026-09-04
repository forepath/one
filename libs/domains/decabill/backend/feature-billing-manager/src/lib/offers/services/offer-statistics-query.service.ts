import { Injectable } from '@nestjs/common';

import { OfferStatus } from '../constants/offer-status.constants';
import type { OfferStatisticsResponseDto } from '../dto/offer.dto';
import { OffersRepository } from '../repositories/offers.repository';
import { fillMeterHistoryPeriodSeries } from '../../utils/meter-history-date.util';

@Injectable()
export class OfferStatisticsQueryService {
  constructor(private readonly offersRepository: OffersRepository) {}

  async getStatistics(params: {
    from: Date;
    to: Date;
    groupBy: 'day' | 'month';
    userId?: string;
  }): Promise<OfferStatisticsResponseDto> {
    const [
      draftCount,
      pendingCount,
      pendingGross,
      acceptedCount,
      acceptedGross,
      declinedCount,
      expiredCount,
      revokedCount,
      archivedSeries,
      acceptedSeries,
      declinedSeries,
    ] = await Promise.all([
      this.offersRepository.countByStatus(OfferStatus.DRAFT, params.userId),
      this.offersRepository.countByStatus(OfferStatus.ARCHIVED, params.userId),
      this.offersRepository.sumGrossByStatus(OfferStatus.ARCHIVED, params.userId),
      this.offersRepository.countByTimestampField({
        field: 'accepted_at',
        from: params.from,
        to: params.to,
        userId: params.userId,
      }),
      this.offersRepository.sumGrossByStatus(OfferStatus.ACCEPTED, params.userId),
      this.offersRepository.countByTimestampField({
        field: 'declined_at',
        from: params.from,
        to: params.to,
        userId: params.userId,
      }),
      this.offersRepository.countByTimestampField({
        field: 'expired_at',
        from: params.from,
        to: params.to,
        userId: params.userId,
      }),
      this.offersRepository.countByTimestampField({
        field: 'revoked_at',
        from: params.from,
        to: params.to,
        userId: params.userId,
      }),
      this.offersRepository.countTransitionSeries({
        field: 'archived_at',
        from: params.from,
        to: params.to,
        groupBy: params.groupBy,
        userId: params.userId,
      }),
      this.offersRepository.countTransitionSeries({
        field: 'accepted_at',
        from: params.from,
        to: params.to,
        groupBy: params.groupBy,
        userId: params.userId,
      }),
      this.offersRepository.countTransitionSeries({
        field: 'declined_at',
        from: params.from,
        to: params.to,
        groupBy: params.groupBy,
        userId: params.userId,
      }),
    ]);

    const from = params.from.toISOString().slice(0, 10);
    const to = params.to.toISOString().slice(0, 10);
    const archivedByPeriod = new Map(archivedSeries.map((row) => [row.period, row.count]));
    const acceptedByPeriod = new Map(acceptedSeries.map((row) => [row.period, row.count]));
    const declinedByPeriod = new Map(declinedSeries.map((row) => [row.period, row.count]));
    const series = fillMeterHistoryPeriodSeries([], from, to, params.groupBy, (period) => ({
      period,
      archivedCount: archivedByPeriod.get(period) ?? 0,
      acceptedCount: acceptedByPeriod.get(period) ?? 0,
      declinedCount: declinedByPeriod.get(period) ?? 0,
    }));

    return {
      draftCount,
      pendingCount,
      pendingGross,
      acceptedCount,
      acceptedGross,
      declinedCount,
      expiredCount,
      revokedCount,
      series,
      from,
      to,
      groupBy: params.groupBy,
    };
  }
}
