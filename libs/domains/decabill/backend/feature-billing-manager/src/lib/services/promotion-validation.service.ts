import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import {
  PROMOTION_INVALID_CODE_MESSAGE,
  PromotionRedemptionContext,
  PromotionSubscriptionEligibility,
} from '../constants/promotion.constants';
import type { PromotionEntity } from '../entities/promotion.entity';
import { SubscriptionStatus } from '../entities/subscription.entity';
import { PromotionsRepository } from '../repositories/promotions.repository';
import { PromotionRedemptionsRepository } from '../repositories/promotion-redemptions.repository';
import { ServicePlansRepository } from '../repositories/service-plans.repository';
import { SubscriptionsRepository } from '../repositories/subscriptions.repository';

import { BillingAuditLogService } from './billing-audit-log.service';
import { isPlanEligible, normalizePromotionCode } from '../utils/promotion-advantage.util';

export interface PromotionValidationInput {
  userId: string;
  code: string;
  redemptionContext: PromotionRedemptionContext;
  subscriptionId?: string;
  planId?: string;
}

export interface ResolvedPromotionTarget {
  planId: string;
  subscriptionId?: string;
}

@Injectable()
export class PromotionValidationService {
  private readonly logger = new Logger(PromotionValidationService.name);

  constructor(
    private readonly promotionsRepository: PromotionsRepository,
    private readonly promotionRedemptionsRepository: PromotionRedemptionsRepository,
    private readonly subscriptionsRepository: SubscriptionsRepository,
    private readonly servicePlansRepository: ServicePlansRepository,
    private readonly auditLog: BillingAuditLogService,
  ) {}

  async resolvePromotion(code: string): Promise<PromotionEntity> {
    const promotion = await this.promotionsRepository.findByCode(normalizePromotionCode(code));

    if (!promotion) {
      throw new BadRequestException(PROMOTION_INVALID_CODE_MESSAGE);
    }

    return promotion;
  }

  async validatePromotion(
    input: PromotionValidationInput,
  ): Promise<{ promotion: PromotionEntity; target: ResolvedPromotionTarget }> {
    const promotion = await this.resolvePromotion(input.code);
    const target = await this.resolveTarget(input);
    const now = new Date();

    this.assertPromotionActive(promotion, now);
    this.assertSubscriptionEligibility(promotion, input.redemptionContext);
    this.assertPlanEligible(promotion, target.planId);

    if (input.subscriptionId) {
      await this.assertSubscriptionOwnership(input.userId, input.subscriptionId, input.redemptionContext);
    }

    await this.assertUsageLimits(promotion, input.userId);

    return { promotion, target };
  }

  private async resolveTarget(input: PromotionValidationInput): Promise<ResolvedPromotionTarget> {
    if (input.redemptionContext === PromotionRedemptionContext.EXISTING) {
      if (!input.subscriptionId) {
        throw new BadRequestException(PROMOTION_INVALID_CODE_MESSAGE);
      }

      const subscription = await this.subscriptionsRepository.findByIdOrThrow(input.subscriptionId);

      if (subscription.userId !== input.userId) {
        await this.logRejection('promotion.subscription_not_owned', input);

        throw new BadRequestException(PROMOTION_INVALID_CODE_MESSAGE);
      }

      this.assertExistingSubscriptionStatus(subscription.status);

      return { planId: subscription.planId, subscriptionId: subscription.id };
    }

    if (input.subscriptionId) {
      const subscription = await this.subscriptionsRepository.findByIdOrThrow(input.subscriptionId);

      if (subscription.userId !== input.userId) {
        throw new BadRequestException(PROMOTION_INVALID_CODE_MESSAGE);
      }

      return { planId: subscription.planId, subscriptionId: subscription.id };
    }

    if (!input.planId) {
      throw new BadRequestException(PROMOTION_INVALID_CODE_MESSAGE);
    }

    await this.servicePlansRepository.findByIdOrThrow(input.planId);

    return { planId: input.planId };
  }

  private assertPromotionActive(promotion: PromotionEntity, now: Date): void {
    if (!promotion.isActive) {
      throw new BadRequestException(PROMOTION_INVALID_CODE_MESSAGE);
    }

    if (now < promotion.redeemableFrom || now > promotion.redeemableTo) {
      throw new BadRequestException(PROMOTION_INVALID_CODE_MESSAGE);
    }
  }

  private assertSubscriptionEligibility(promotion: PromotionEntity, context: PromotionRedemptionContext): void {
    const eligibility = promotion.subscriptionEligibility;

    if (eligibility === PromotionSubscriptionEligibility.NEW && context === PromotionRedemptionContext.EXISTING) {
      throw new BadRequestException(PROMOTION_INVALID_CODE_MESSAGE);
    }

    if (eligibility === PromotionSubscriptionEligibility.EXISTING && context === PromotionRedemptionContext.NEW) {
      throw new BadRequestException(PROMOTION_INVALID_CODE_MESSAGE);
    }
  }

  private assertPlanEligible(promotion: PromotionEntity, planId: string): void {
    if (!isPlanEligible(promotion, planId)) {
      void this.auditLog.log({
        process: 'promotion.validate',
        level: 'warn',
        message: 'Promotion plan not eligible',
        context: { promotionId: promotion.id, planId, reason: 'promotion.plan_not_eligible' },
      });

      throw new BadRequestException(PROMOTION_INVALID_CODE_MESSAGE);
    }
  }

  private assertExistingSubscriptionStatus(status: SubscriptionStatus): void {
    const allowed = [
      SubscriptionStatus.ACTIVE,
      SubscriptionStatus.PENDING_BACKORDER,
      SubscriptionStatus.PENDING_CANCEL,
    ];

    if (!allowed.includes(status)) {
      throw new BadRequestException(PROMOTION_INVALID_CODE_MESSAGE);
    }
  }

  private async assertSubscriptionOwnership(
    userId: string,
    subscriptionId: string,
    context: PromotionRedemptionContext,
  ): Promise<void> {
    const subscription = await this.subscriptionsRepository.findByIdOrThrow(subscriptionId);

    if (subscription.userId !== userId) {
      throw new BadRequestException(PROMOTION_INVALID_CODE_MESSAGE);
    }

    if (context === PromotionRedemptionContext.EXISTING) {
      this.assertExistingSubscriptionStatus(subscription.status);
    }
  }

  private async assertUsageLimits(promotion: PromotionEntity, userId: string): Promise<void> {
    if (promotion.maxTotalRedemptions != null) {
      const total = await this.promotionRedemptionsRepository.countByPromotion(promotion.id);

      if (total >= promotion.maxTotalRedemptions) {
        throw new BadRequestException(PROMOTION_INVALID_CODE_MESSAGE);
      }
    }

    const userCount = await this.promotionRedemptionsRepository.countByPromotionAndUser(promotion.id, userId);

    if (userCount >= promotion.maxPerUserRedemptions) {
      throw new BadRequestException(PROMOTION_INVALID_CODE_MESSAGE);
    }
  }

  private async logRejection(reason: string, input: PromotionValidationInput): Promise<void> {
    await this.auditLog.log({
      process: 'promotion.validate',
      level: 'warn',
      message: 'Promotion validation failed',
      userId: input.userId,
      context: { reason, code: normalizePromotionCode(input.code), redemptionContext: input.redemptionContext },
    });
  }
}
