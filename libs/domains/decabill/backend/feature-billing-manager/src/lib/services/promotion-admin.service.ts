import { BadRequestException, Injectable } from '@nestjs/common';

import { PromotionAdvantageType, PromotionSubscriptionEligibility } from '../constants/promotion.constants';
import type {
  AdminPromotionResponseDto,
  CreateAdminPromotionDto,
  PaginatedAdminPromotionsResponseDto,
  PaginatedPromotionRedemptionsResponseDto,
  UpdateAdminPromotionDto,
} from '../dto/promotion.dto';
import type { PromotionEntity } from '../entities/promotion.entity';
import { PromotionRedemptionsRepository } from '../repositories/promotion-redemptions.repository';
import { PromotionsRepository } from '../repositories/promotions.repository';
import { ServicePlansRepository } from '../repositories/service-plans.repository';
import { validateAdvantageConfig } from '../utils/promotion-advantage.util';

import { PromotionRedemptionService } from './promotion-redemption.service';

@Injectable()
export class PromotionAdminService {
  constructor(
    private readonly promotionsRepository: PromotionsRepository,
    private readonly promotionRedemptionsRepository: PromotionRedemptionsRepository,
    private readonly servicePlansRepository: ServicePlansRepository,
    private readonly promotionRedemptionService: PromotionRedemptionService,
  ) {}

  async list(limit: number, offset: number): Promise<PaginatedAdminPromotionsResponseDto> {
    const { items, total } = await this.promotionsRepository.findAll(limit, offset);

    return {
      items: await Promise.all(items.map((item) => this.mapPromotion(item))),
      total,
      limit,
      offset,
    };
  }

  async get(id: string): Promise<AdminPromotionResponseDto> {
    const promotion = await this.promotionsRepository.findByIdOrThrow(id);

    return await this.mapPromotion(promotion);
  }

  async create(dto: CreateAdminPromotionDto): Promise<AdminPromotionResponseDto> {
    this.validateDto(dto);
    await this.validateApplicablePlans(dto.applicablePlanIds);

    const promotion = await this.promotionsRepository.create({
      code: dto.code,
      name: dto.name,
      description: dto.description,
      redeemableFrom: new Date(dto.redeemableFrom),
      redeemableTo: new Date(dto.redeemableTo),
      maxTotalRedemptions: dto.maxTotalRedemptions,
      maxPerUserRedemptions: dto.maxPerUserRedemptions,
      isActive: dto.isActive,
      advantageType: dto.advantageType,
      advantageConfig: dto.advantageConfig,
      applicablePlanIds: this.normalizeApplicablePlanIds(dto.applicablePlanIds),
      subscriptionEligibility: dto.subscriptionEligibility ?? PromotionSubscriptionEligibility.BOTH,
    });

    return await this.mapPromotion(promotion);
  }

  async update(id: string, dto: UpdateAdminPromotionDto): Promise<AdminPromotionResponseDto> {
    this.validateDto(dto);
    await this.validateApplicablePlans(dto.applicablePlanIds);

    const promotion = await this.promotionsRepository.update(id, {
      code: dto.code,
      name: dto.name,
      description: dto.description,
      redeemableFrom: new Date(dto.redeemableFrom),
      redeemableTo: new Date(dto.redeemableTo),
      maxTotalRedemptions: dto.maxTotalRedemptions,
      maxPerUserRedemptions: dto.maxPerUserRedemptions,
      isActive: dto.isActive,
      advantageType: dto.advantageType,
      advantageConfig: dto.advantageConfig,
      applicablePlanIds: this.normalizeApplicablePlanIds(dto.applicablePlanIds),
      subscriptionEligibility: dto.subscriptionEligibility,
    });

    return await this.mapPromotion(promotion);
  }

  async deactivate(id: string): Promise<AdminPromotionResponseDto> {
    const promotion = await this.promotionsRepository.update(id, { isActive: false });

    return await this.mapPromotion(promotion);
  }

  async listRedemptions(
    promotionId: string,
    limit: number,
    offset: number,
  ): Promise<PaginatedPromotionRedemptionsResponseDto> {
    await this.promotionsRepository.findByIdOrThrow(promotionId);
    const { items, total } = await this.promotionRedemptionsRepository.findByPromotion(promotionId, limit, offset);

    return {
      items: await Promise.all(items.map((item) => this.promotionRedemptionService.mapRedemptionEntity(item))),
      total,
      limit,
      offset,
    };
  }

  private validateDto(dto: CreateAdminPromotionDto): void {
    if (new Date(dto.redeemableFrom) >= new Date(dto.redeemableTo)) {
      throw new BadRequestException('Redeemable from must be before redeemable to');
    }

    if (dto.maxPerUserRedemptions < 1) {
      throw new BadRequestException('Max per user redemptions must be at least 1');
    }

    validateAdvantageConfig(dto.advantageType, dto.advantageConfig);
  }

  private normalizeApplicablePlanIds(planIds?: string[]): string[] | null {
    if (!planIds || planIds.length === 0) {
      return null;
    }

    return [...new Set(planIds)];
  }

  private async validateApplicablePlans(planIds?: string[]): Promise<void> {
    if (!planIds || planIds.length === 0) {
      return;
    }

    for (const planId of new Set(planIds)) {
      await this.servicePlansRepository.findByIdOrThrow(planId);
    }
  }

  private async mapPromotion(promotion: PromotionEntity): Promise<AdminPromotionResponseDto> {
    const redemptionCount = await this.promotionRedemptionsRepository.countByPromotion(promotion.id);
    const applicablePlans = await this.resolveApplicablePlans(promotion.applicablePlanIds);

    return {
      id: promotion.id,
      code: promotion.code,
      name: promotion.name,
      description: promotion.description,
      redeemableFrom: promotion.redeemableFrom.toISOString(),
      redeemableTo: promotion.redeemableTo.toISOString(),
      maxTotalRedemptions: promotion.maxTotalRedemptions ?? undefined,
      maxPerUserRedemptions: promotion.maxPerUserRedemptions,
      isActive: promotion.isActive,
      advantageType: promotion.advantageType,
      advantageConfig: { ...promotion.advantageConfig },
      applicablePlanIds: promotion.applicablePlanIds ?? null,
      applicablePlans,
      subscriptionEligibility: promotion.subscriptionEligibility,
      redemptionCount,
      createdAt: promotion.createdAt.toISOString(),
      updatedAt: promotion.updatedAt.toISOString(),
    };
  }

  private async resolveApplicablePlans(planIds: string[] | null | undefined) {
    if (!planIds || planIds.length === 0) {
      return [];
    }

    const plans = await Promise.all(planIds.map((id) => this.servicePlansRepository.findById(id)));
    const resolved = plans.filter((plan): plan is NonNullable<typeof plan> => plan != null);

    return resolved.map((plan) => ({
      id: plan.id,
      name: plan.name,
      serviceTypeName: plan.serviceType?.name ?? '',
    }));
  }
}
