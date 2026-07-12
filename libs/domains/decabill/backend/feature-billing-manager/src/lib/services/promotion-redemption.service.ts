import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import {
  PROMOTION_INVALID_CODE_MESSAGE,
  PromotionAdvantageType,
  PromotionRedemptionContext,
  PromotionRedemptionStatus,
} from '../constants/promotion.constants';
import type { PromotionRedemptionResponseDto, PromotionValidationResponseDto } from '../dto/promotion.dto';
import type { PromotionEntity } from '../entities/promotion.entity';
import type { PromotionRedemptionEntity } from '../entities/promotion-redemption.entity';
import { PromotionRedemptionsRepository } from '../repositories/promotion-redemptions.repository';
import { PromotionsRepository } from '../repositories/promotions.repository';
import { ServicePlansRepository } from '../repositories/service-plans.repository';
import { SubscriptionsRepository } from '../repositories/subscriptions.repository';
import {
  buildActivePromotionDisplay,
  buildAdvantageSummary,
  computeBenefitWindow,
  normalizePromotionCode,
  resolveValidatedBenefitStart,
} from '../utils/promotion-advantage.util';

import { BillingAuditLogService } from './billing-audit-log.service';
import { PricingService } from './pricing.service';
import { PromotionValidationService } from './promotion-validation.service';
import { SubscriptionChargePeriodService } from './subscription-charge-period.service';
import type { ResolvedPromotionTarget } from './promotion-validation.service';

@Injectable()
export class PromotionRedemptionService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly promotionValidationService: PromotionValidationService,
    private readonly promotionsRepository: PromotionsRepository,
    private readonly promotionRedemptionsRepository: PromotionRedemptionsRepository,
    private readonly subscriptionsRepository: SubscriptionsRepository,
    private readonly servicePlansRepository: ServicePlansRepository,
    private readonly pricingService: PricingService,
    private readonly subscriptionChargePeriodService: SubscriptionChargePeriodService,
    private readonly auditLog: BillingAuditLogService,
  ) {}

  async validate(
    userId: string,
    code: string,
    redemptionContext: PromotionRedemptionContext,
    options: { subscriptionId?: string; planId?: string },
  ): Promise<PromotionValidationResponseDto> {
    try {
      const { promotion, target } = await this.promotionValidationService.validatePromotion({
        userId,
        code,
        redemptionContext,
        subscriptionId: options.subscriptionId,
        planId: options.planId,
      });

      return await this.buildValidationSuccess(promotion, target, redemptionContext);
    } catch (error) {
      if (error instanceof BadRequestException) {
        return { valid: false, message: PROMOTION_INVALID_CODE_MESSAGE };
      }

      throw error;
    }
  }

  async redeem(
    userId: string,
    code: string,
    subscriptionId: string,
    redemptionContext: PromotionRedemptionContext,
    options?: { benefitStartsAt?: string },
  ): Promise<PromotionRedemptionResponseDto> {
    const normalized = normalizePromotionCode(code);
    const promotion = await this.promotionValidationService.resolvePromotion(normalized);

    return await this.dataSource.transaction(async (manager) => {
      const locked = await this.promotionsRepository.findByIdForUpdate(promotion.id, manager);

      if (!locked) {
        throw new BadRequestException(PROMOTION_INVALID_CODE_MESSAGE);
      }

      await this.promotionValidationService.validatePromotion({
        userId,
        code: normalized,
        redemptionContext,
        subscriptionId,
      });

      const hasActiveRedemption = await this.promotionRedemptionsRepository.hasActiveRedemptionForSubscription(
        locked.id,
        subscriptionId,
        manager,
      );

      if (hasActiveRedemption) {
        throw new BadRequestException(PROMOTION_INVALID_CODE_MESSAGE);
      }

      const benefitReference = resolveValidatedBenefitStart(options?.benefitStartsAt);
      const benefit = computeBenefitWindow(locked, benefitReference);
      const now = new Date();
      const redemption = await this.promotionRedemptionsRepository.create(
        {
          promotionId: locked.id,
          userId,
          subscriptionId,
          codeSnapshot: locked.code,
          redemptionContext,
          status: PromotionRedemptionStatus.ACTIVE,
          redeemedAt: now,
          benefitStartsAt: benefit.benefitStartsAt,
          benefitEndsAt: benefit.benefitEndsAt,
          remainingAmountNet: benefit.remainingAmountNet,
          remainingBillingPeriods: benefit.remainingBillingPeriods,
        },
        manager,
      );

      await this.auditLog.log({
        process: 'promotion.redeem',
        level: 'info',
        message: 'Promotion redeemed',
        userId,
        context: { promotionId: locked.id, redemptionId: redemption.id, subscriptionId },
      });

      redemption.promotion = locked;

      return await this.mapRedemptionEntity(redemption);
    });
  }

  async listForUser(userId: string, limit: number, offset: number) {
    const { items, total } = await this.promotionRedemptionsRepository.findByUser(userId, limit, offset);

    return {
      items: await Promise.all(items.map((item) => this.mapRedemptionEntity(item))),
      total,
      limit,
      offset,
    };
  }

  async listActiveForUser(userId: string, limit: number, offset: number) {
    const { items, total } = await this.promotionRedemptionsRepository.findActiveByUser(userId, limit, offset);

    return {
      items: await Promise.all(items.map((item) => this.mapRedemptionEntity(item))),
      total,
      limit,
      offset,
    };
  }

  private async buildValidationSuccess(
    promotion: PromotionEntity,
    target: ResolvedPromotionTarget,
    redemptionContext: PromotionRedemptionContext,
  ): Promise<PromotionValidationResponseDto> {
    const preview = computeBenefitWindow(promotion);
    const response: PromotionValidationResponseDto = {
      valid: true,
      code: promotion.code,
      promotionName: promotion.name,
      subscriptionEligibility: promotion.subscriptionEligibility,
      advantageType: promotion.advantageType,
      advantageSummary: buildAdvantageSummary(promotion),
      amountNet:
        promotion.advantageType === PromotionAdvantageType.FIXED_AMOUNT_NET ? preview.remainingAmountNet : undefined,
      currency: promotion.advantageType === PromotionAdvantageType.FIXED_AMOUNT_NET ? 'EUR' : undefined,
      days:
        promotion.advantageType === PromotionAdvantageType.FREE_DAYS
          ? (promotion.advantageConfig as { days: number }).days
          : undefined,
      periods:
        promotion.advantageType === PromotionAdvantageType.FREE_BILLING_PERIODS
          ? (promotion.advantageConfig as { periods: number }).periods
          : undefined,
      benefitStartsAt: preview.benefitStartsAt.toISOString(),
      benefitEndsAt: preview.benefitEndsAt?.toISOString(),
      applicablePlanIds: promotion.applicablePlanIds ?? null,
    };

    if (redemptionContext === PromotionRedemptionContext.EXISTING && target.subscriptionId) {
      const subscription = await this.subscriptionsRepository.findByIdOrThrow(target.subscriptionId);
      const plan = await this.servicePlansRepository.findByIdOrThrow(target.planId);
      const pricing = await this.pricingService.calculate(plan);
      const chargePeriod = await this.subscriptionChargePeriodService.resolveChargePeriod(
        subscription,
        plan,
        pricing.totalPrice,
        new Date(),
      );

      if (chargePeriod) {
        response.chargePeriodStart = chargePeriod.periodStart.toISOString();
        response.chargePeriodEnd = chargePeriod.periodEnd.toISOString();
      }
    }

    return response;
  }

  async mapRedemptionEntity(redemption: PromotionRedemptionEntity): Promise<PromotionRedemptionResponseDto> {
    const promotion = redemption.promotion;

    if (!promotion) {
      throw new BadRequestException('Promotion not found for redemption');
    }

    const subscription = redemption.subscriptionId
      ? await this.subscriptionsRepository.findById(redemption.subscriptionId)
      : null;
    const plan = subscription ? await this.servicePlansRepository.findById(subscription.planId) : undefined;
    const display = buildActivePromotionDisplay(redemption);

    return {
      id: redemption.id,
      code: redemption.codeSnapshot,
      promotionName: promotion.name,
      subscriptionId: redemption.subscriptionId,
      subscriptionNumber: subscription?.number,
      planName: plan?.name,
      redemptionContext: redemption.redemptionContext,
      status: redemption.status,
      redeemedAt: redemption.redeemedAt.toISOString(),
      advantageType: promotion.advantageType,
      advantageSummary: buildAdvantageSummary(promotion),
      validFrom: display.validFrom.toISOString(),
      validTo: display.validTo?.toISOString(),
      remainingMonetaryNet: display.remainingMonetaryNet,
      remainingPeriods: display.remainingPeriods,
    };
  }
}
