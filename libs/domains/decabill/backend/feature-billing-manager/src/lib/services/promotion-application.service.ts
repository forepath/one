import { Injectable } from '@nestjs/common';

import {
  PromotionAdvantageType,
  PromotionRedemptionStatus,
  type FreeDaysAdvantageConfig,
} from '../constants/promotion.constants';
import { TaxCategory } from '../constants/tax-category.constants';
import type { InvoicePromotionApplicationDraft } from '../dto/promotion.dto';
import type { PromotionRedemptionEntity } from '../entities/promotion-redemption.entity';
import { InvoicePromotionApplicationsRepository } from '../repositories/invoice-promotion-applications.repository';
import { PromotionRedemptionsRepository } from '../repositories/promotion-redemptions.repository';
import { calculatePromotionOverlapDiscount, isPlanEligible, roundMoney } from '../utils/promotion-advantage.util';

import type { LineItemInput } from './tax-calculation.service';

export interface PromotionApplicationResult {
  discountLines: LineItemInput[];
  applications: InvoicePromotionApplicationDraft[];
  rawSubtotalNet: number;
  adjustedSubtotalNet: number;
}

export interface PromotionRedemptionUpdate {
  redemptionId: string;
  remainingAmountNet?: number;
  remainingBillingPeriods?: number;
  status?: PromotionRedemptionStatus;
}

export interface RedemptionUpdateRollback {
  redemptionId: string;
  previousRemainingAmountNet?: number | null;
  previousRemainingBillingPeriods?: number | null;
  previousStatus: PromotionRedemptionStatus;
}

@Injectable()
export class PromotionApplicationService {
  constructor(
    private readonly promotionRedemptionsRepository: PromotionRedemptionsRepository,
    private readonly invoicePromotionApplicationsRepository: InvoicePromotionApplicationsRepository,
  ) {}

  async calculatePromotions(params: {
    userId: string;
    subscriptionId: string;
    chargeLines: LineItemInput[];
    defaultTaxCategory: TaxCategory;
    chargePeriod?: { start: Date; end: Date };
    subscriptionChargeNet?: number;
  }): Promise<PromotionApplicationResult & { redemptionUpdates: PromotionRedemptionUpdate[] }> {
    const rawSubtotalNet = roundMoney(
      params.chargeLines.reduce((sum, line) => sum + line.quantity * line.unitPriceNet, 0),
    );

    if (rawSubtotalNet <= 0) {
      return {
        discountLines: [],
        applications: [],
        redemptionUpdates: [],
        rawSubtotalNet,
        adjustedSubtotalNet: rawSubtotalNet,
      };
    }

    const redemptions = await this.promotionRedemptionsRepository.findActiveBySubscription(params.subscriptionId);
    const discountLines: LineItemInput[] = [];
    const applications: InvoicePromotionApplicationDraft[] = [];
    const redemptionUpdates: PromotionRedemptionUpdate[] = [];
    let remainingCharge = rawSubtotalNet;

    for (const redemption of redemptions) {
      if (remainingCharge <= 0) {
        break;
      }

      const promotion = redemption.promotion;

      if (!promotion) {
        continue;
      }

      if (promotion.isActive === false) {
        continue;
      }

      const subscriptionPlanId = redemption.subscription?.planId;

      if (!subscriptionPlanId || !isPlanEligible(promotion, subscriptionPlanId)) {
        continue;
      }

      const calculated = this.calculateSingleRedemption(
        redemption,
        remainingCharge,
        params.defaultTaxCategory,
        params.chargePeriod,
        params.subscriptionChargeNet,
      );

      if (calculated.application.amountAppliedNet <= 0) {
        if (calculated.redemptionUpdate) {
          redemptionUpdates.push(calculated.redemptionUpdate);
        }

        continue;
      }

      discountLines.push({
        description: calculated.application.description,
        quantity: 1,
        unitPriceNet: -calculated.application.amountAppliedNet,
        taxCategory: calculated.application.taxCategory,
      });
      applications.push(calculated.application);

      if (calculated.redemptionUpdate) {
        redemptionUpdates.push(calculated.redemptionUpdate);
      }

      remainingCharge = roundMoney(Math.max(0, remainingCharge - calculated.application.amountAppliedNet));
    }

    const discountTotal = roundMoney(applications.reduce((sum, item) => sum + item.amountAppliedNet, 0));

    return {
      discountLines,
      applications,
      redemptionUpdates,
      rawSubtotalNet,
      adjustedSubtotalNet: roundMoney(Math.max(0, rawSubtotalNet - discountTotal)),
    };
  }

  async commitRedemptionUpdates(updates: PromotionRedemptionUpdate[]): Promise<void> {
    for (const update of updates) {
      await this.applyRedemptionUpdate(update);
    }
  }

  async commitRedemptionUpdatesWithRollback(updates: PromotionRedemptionUpdate[]): Promise<RedemptionUpdateRollback[]> {
    if (updates.length === 0) {
      return [];
    }

    const rollbacks: RedemptionUpdateRollback[] = [];

    for (const update of updates) {
      const redemption = await this.promotionRedemptionsRepository.findByIdOrThrow(update.redemptionId);

      rollbacks.push({
        redemptionId: update.redemptionId,
        previousRemainingAmountNet: redemption.remainingAmountNet,
        previousRemainingBillingPeriods: redemption.remainingBillingPeriods,
        previousStatus: redemption.status,
      });
    }

    await this.commitRedemptionUpdates(updates);

    return rollbacks;
  }

  async rollbackRedemptionUpdates(rollbacks: RedemptionUpdateRollback[]): Promise<void> {
    for (const rollback of rollbacks) {
      await this.promotionRedemptionsRepository.update(rollback.redemptionId, {
        remainingAmountNet: rollback.previousRemainingAmountNet ?? undefined,
        remainingBillingPeriods: rollback.previousRemainingBillingPeriods ?? undefined,
        status: rollback.previousStatus,
      });
    }
  }

  async revertPromotionApplicationsForInvoice(invoiceId: string): Promise<void> {
    const applications = await this.invoicePromotionApplicationsRepository.findByInvoiceId(invoiceId);

    for (const application of applications) {
      const redemption = application.redemption;

      if (!redemption) {
        continue;
      }

      const patch: Partial<PromotionRedemptionEntity> = {};
      const amountAppliedNet = Number(application.amountAppliedNet ?? 0);
      const periodsConsumed = application.periodsConsumed ?? 0;

      if (periodsConsumed > 0) {
        patch.remainingBillingPeriods = (redemption.remainingBillingPeriods ?? 0) + periodsConsumed;
        patch.status = PromotionRedemptionStatus.ACTIVE;
      }

      if (amountAppliedNet > 0 && redemption.remainingAmountNet != null) {
        patch.remainingAmountNet = roundMoney(Number(redemption.remainingAmountNet) + amountAppliedNet);
        patch.status = PromotionRedemptionStatus.ACTIVE;
      }

      if (redemption.status === PromotionRedemptionStatus.EXPIRED && periodsConsumed === 0 && amountAppliedNet > 0) {
        patch.status = PromotionRedemptionStatus.ACTIVE;
      }

      if (Object.keys(patch).length > 0) {
        await this.promotionRedemptionsRepository.update(redemption.id, patch);
      }
    }
  }

  private calculateSingleRedemption(
    redemption: PromotionRedemptionEntity,
    chargeNet: number,
    defaultTaxCategory: TaxCategory,
    chargePeriod?: { start: Date; end: Date },
    subscriptionChargeNet?: number,
  ): { application: InvoicePromotionApplicationDraft; redemptionUpdate?: PromotionRedemptionUpdate } {
    const promotion = redemption.promotion!;

    switch (promotion.advantageType) {
      case PromotionAdvantageType.FREE_BILLING_PERIODS:
        return this.calculateFreeBillingPeriods(redemption, chargeNet, defaultTaxCategory, subscriptionChargeNet);
      case PromotionAdvantageType.FREE_DAYS:
        return this.calculateFreeDays(redemption, chargeNet, defaultTaxCategory, chargePeriod, subscriptionChargeNet);
      case PromotionAdvantageType.FIXED_AMOUNT_NET:
        return this.calculateFixedAmount(redemption, chargeNet, defaultTaxCategory);
      default:
        return { application: this.emptyApplication(redemption, defaultTaxCategory) };
    }
  }

  private calculateFreeBillingPeriods(
    redemption: PromotionRedemptionEntity,
    chargeNet: number,
    taxCategory: TaxCategory,
    subscriptionChargeNet?: number,
  ): { application: InvoicePromotionApplicationDraft; redemptionUpdate?: PromotionRedemptionUpdate } {
    const periods = redemption.remainingBillingPeriods ?? 0;

    if (periods <= 0) {
      return { application: this.emptyApplication(redemption, taxCategory) };
    }

    const waiverBase = subscriptionChargeNet ?? chargeNet;
    const amountAppliedNet = roundMoney(Math.min(waiverBase, chargeNet));
    const remaining = periods - 1;

    return {
      application: {
        redemptionId: redemption.id,
        amountAppliedNet,
        periodsConsumed: 1,
        description: `Promotion ${redemption.codeSnapshot} (free billing period)`,
        taxCategory,
      },
      redemptionUpdate: {
        redemptionId: redemption.id,
        remainingBillingPeriods: remaining,
        status: remaining <= 0 ? PromotionRedemptionStatus.EXHAUSTED : PromotionRedemptionStatus.ACTIVE,
      },
    };
  }

  private calculateFreeDays(
    redemption: PromotionRedemptionEntity,
    chargeNet: number,
    taxCategory: TaxCategory,
    chargePeriod?: { start: Date; end: Date },
    subscriptionChargeNet?: number,
  ): { application: InvoicePromotionApplicationDraft; redemptionUpdate?: PromotionRedemptionUpdate } {
    const benefitStart = redemption.benefitStartsAt ?? chargePeriod?.start ?? new Date();
    const benefitEnd =
      redemption.benefitEndsAt ??
      (() => {
        const end = new Date(benefitStart);
        const days = redemption.promotion?.advantageConfig
          ? ((redemption.promotion.advantageConfig as FreeDaysAdvantageConfig).days ?? 0)
          : 0;

        end.setDate(end.getDate() + days);

        return end;
      })();

    if (chargePeriod && chargePeriod.end <= chargePeriod.start) {
      return { application: this.emptyApplication(redemption, taxCategory) };
    }

    if (chargePeriod && chargePeriod.end.getTime() <= benefitStart.getTime()) {
      return { application: this.emptyApplication(redemption, taxCategory) };
    }

    let amountAppliedNet = 0;
    const prorationBase = subscriptionChargeNet ?? chargeNet;

    if (chargePeriod && chargePeriod.end > chargePeriod.start) {
      amountAppliedNet = calculatePromotionOverlapDiscount(
        prorationBase,
        chargePeriod.start,
        chargePeriod.end,
        benefitStart,
        benefitEnd,
      );
    }

    amountAppliedNet = roundMoney(Math.min(amountAppliedNet, chargeNet));

    const benefitFullyPastCharge = chargePeriod != null && benefitEnd.getTime() <= chargePeriod.end.getTime();
    const redemptionUpdate: PromotionRedemptionUpdate | undefined = benefitFullyPastCharge
      ? { redemptionId: redemption.id, status: PromotionRedemptionStatus.EXPIRED }
      : undefined;

    if (amountAppliedNet <= 0) {
      return { application: this.emptyApplication(redemption, taxCategory), redemptionUpdate };
    }

    return {
      application: {
        redemptionId: redemption.id,
        amountAppliedNet,
        periodsConsumed: 0,
        description: `Promotion ${redemption.codeSnapshot} (free days)`,
        taxCategory,
      },
      redemptionUpdate,
    };
  }

  private calculateFixedAmount(
    redemption: PromotionRedemptionEntity,
    chargeNet: number,
    taxCategory: TaxCategory,
  ): { application: InvoicePromotionApplicationDraft; redemptionUpdate?: PromotionRedemptionUpdate } {
    const remaining = Number(redemption.remainingAmountNet ?? 0);

    if (remaining <= 0) {
      return {
        application: this.emptyApplication(redemption, taxCategory),
        redemptionUpdate: {
          redemptionId: redemption.id,
          status: PromotionRedemptionStatus.EXHAUSTED,
        },
      };
    }

    const amountAppliedNet = roundMoney(Math.min(remaining, chargeNet));
    const newRemaining = roundMoney(remaining - amountAppliedNet);

    return {
      application: {
        redemptionId: redemption.id,
        amountAppliedNet,
        periodsConsumed: 0,
        description: `Promotion ${redemption.codeSnapshot} (credit)`,
        taxCategory,
      },
      redemptionUpdate: {
        redemptionId: redemption.id,
        remainingAmountNet: newRemaining,
        status: newRemaining <= 0 ? PromotionRedemptionStatus.EXHAUSTED : PromotionRedemptionStatus.ACTIVE,
      },
    };
  }

  private async applyRedemptionUpdate(update: PromotionRedemptionUpdate): Promise<void> {
    const patch: Partial<PromotionRedemptionEntity> = {};

    if (update.remainingAmountNet != null) {
      patch.remainingAmountNet = update.remainingAmountNet;
    }

    if (update.remainingBillingPeriods != null) {
      patch.remainingBillingPeriods = update.remainingBillingPeriods;
    }

    if (update.status != null) {
      patch.status = update.status;
    }

    if (Object.keys(patch).length === 0) {
      return;
    }

    await this.promotionRedemptionsRepository.update(update.redemptionId, patch);
  }

  private emptyApplication(
    redemption: PromotionRedemptionEntity,
    taxCategory: TaxCategory,
  ): InvoicePromotionApplicationDraft {
    return {
      redemptionId: redemption.id,
      amountAppliedNet: 0,
      periodsConsumed: 0,
      description: `Promotion ${redemption.codeSnapshot}`,
      taxCategory,
    };
  }
}
