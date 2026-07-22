import { getTenantIdOrDefault } from '@forepath/shared/backend';
import { Injectable } from '@nestjs/common';

import { BillingNotificationPublisher } from '../notifications/billing-notification.publisher';
import { OssThresholdLedgersRepository } from '../repositories/oss-threshold-ledgers.repository';

export interface OssThresholdDecision {
  /** True when destination-country VAT (OSS) should apply. */
  ossDestinationApplies: boolean;
  crossBorderB2cNetTotal: number;
  thresholdEur: number;
  thresholdExceeded: boolean;
  registeredOverride: boolean;
}

@Injectable()
export class OssThresholdService {
  constructor(
    private readonly ledgersRepository: OssThresholdLedgersRepository,
    private readonly notifications: BillingNotificationPublisher,
  ) {}

  isOssRegisteredOverride(): boolean {
    const raw = (process.env.BILLING_OSS_REGISTERED ?? '').trim().toLowerCase();

    return raw === 'true' || raw === '1';
  }

  async getDecision(params?: { tenantId?: string; at?: Date }): Promise<OssThresholdDecision> {
    if (this.isOssRegisteredOverride()) {
      return {
        ossDestinationApplies: true,
        crossBorderB2cNetTotal: 0,
        thresholdEur: 10_000,
        thresholdExceeded: true,
        registeredOverride: true,
      };
    }

    const tenantId = params?.tenantId ?? getTenantIdOrDefault() ?? 'unified';
    const year = (params?.at ?? new Date()).getUTCFullYear();
    const ledger = await this.ledgersRepository.findOrCreate(tenantId, year);
    const total = Number(ledger.crossBorderB2cNetTotal);
    const threshold = Number(ledger.thresholdEur);
    const exceeded = total >= threshold || Boolean(ledger.thresholdExceededAt);

    return {
      ossDestinationApplies: exceeded,
      crossBorderB2cNetTotal: total,
      thresholdEur: threshold,
      thresholdExceeded: exceeded,
      registeredOverride: false,
    };
  }

  /**
   * Record net amount for an EU cross-border B2C (non-reverse-charge) invoice.
   * Call after issue when the supply is EU issuer → other EU country and not reverse charge.
   */
  async recordCrossBorderB2cNet(params: {
    netAmount: number;
    tenantId?: string;
    at?: Date;
  }): Promise<OssThresholdDecision> {
    if (this.isOssRegisteredOverride() || params.netAmount <= 0) {
      return this.getDecision(params);
    }

    const tenantId = params.tenantId ?? getTenantIdOrDefault() ?? 'unified';
    const at = params.at ?? new Date();
    const year = at.getUTCFullYear();
    const ledger = await this.ledgersRepository.findOrCreate(tenantId, year);
    const previous = Number(ledger.crossBorderB2cNetTotal);
    const threshold = Number(ledger.thresholdEur);
    const next = Math.round((previous + params.netAmount) * 100) / 100;
    const wasExceeded = previous >= threshold || Boolean(ledger.thresholdExceededAt);

    ledger.crossBorderB2cNetTotal = next;

    if (!wasExceeded && next >= threshold) {
      ledger.thresholdExceededAt = at;
      await this.ledgersRepository.save(ledger);
      this.notifications.publish('oss.threshold_exceeded', {
        tenantId,
        calendarYear: year,
        crossBorderB2cNetTotal: next,
        thresholdEur: threshold,
      });
    } else {
      await this.ledgersRepository.save(ledger);
    }

    return {
      ossDestinationApplies: next >= threshold || Boolean(ledger.thresholdExceededAt),
      crossBorderB2cNetTotal: next,
      thresholdEur: threshold,
      thresholdExceeded: next >= threshold || Boolean(ledger.thresholdExceededAt),
      registeredOverride: false,
    };
  }
}
