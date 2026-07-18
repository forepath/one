import { RequireScopes } from '@forepath/identity/backend';
import { Body, Controller, Get, Param, ParseIntPipe, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { IsEnum, IsISO8601, IsNotEmpty, IsOptional, IsString, IsUUID, ValidateIf } from 'class-validator';

import { PromotionRedemptionContext, PromotionSubscriptionEligibility } from '../constants/promotion.constants';
import type {
  PaginatedPromotionRedemptionsResponseDto,
  PromotionValidationResponseDto,
  RedeemPromotionDto,
  ValidatePromotionDto,
} from '../dto/promotion.dto';
import { PromotionRedemptionService } from '../services/promotion-redemption.service';
import { getUserFromRequest, type RequestWithUser } from '../utils/billing-access.utils';

class ValidatePromotionBodyDto implements ValidatePromotionDto {
  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsEnum(PromotionRedemptionContext)
  redemptionContext!: PromotionRedemptionContext;

  @ValidateIf((dto: ValidatePromotionBodyDto) => dto.redemptionContext === PromotionRedemptionContext.EXISTING)
  @IsUUID('4')
  subscriptionId?: string;

  @ValidateIf((dto: ValidatePromotionBodyDto) => dto.redemptionContext === PromotionRedemptionContext.NEW)
  @IsOptional()
  @IsUUID('4')
  planId?: string;
}

class RedeemPromotionBodyDto implements RedeemPromotionDto {
  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsEnum(PromotionRedemptionContext)
  redemptionContext!: PromotionRedemptionContext;

  @IsUUID('4')
  subscriptionId!: string;

  @IsOptional()
  @IsISO8601({}, { message: 'benefitStartsAt must be an ISO 8601 date string' })
  benefitStartsAt?: string;
}

@Controller('promotions')
@RequireScopes('promotions:read')
export class PromotionsController {
  constructor(private readonly promotionRedemptionService: PromotionRedemptionService) {}

  @Post('validate')
  async validate(
    @Body() dto: ValidatePromotionBodyDto,
    @Req() req: RequestWithUser,
  ): Promise<PromotionValidationResponseDto> {
    const user = getUserFromRequest(req);

    return await this.promotionRedemptionService.validate(user.userId!, dto.code, dto.redemptionContext, {
      subscriptionId: dto.subscriptionId,
      planId: dto.planId,
    });
  }

  @Post('redeem')
  async redeem(@Body() dto: RedeemPromotionBodyDto, @Req() req: RequestWithUser) {
    const user = getUserFromRequest(req);

    return await this.promotionRedemptionService.redeem(
      user.userId!,
      dto.code,
      dto.subscriptionId,
      dto.redemptionContext,
      { benefitStartsAt: dto.benefitStartsAt },
    );
  }

  @Get('redemptions')
  async listRedemptions(
    @Req() req: RequestWithUser,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
  ): Promise<PaginatedPromotionRedemptionsResponseDto> {
    const user = getUserFromRequest(req);

    return await this.promotionRedemptionService.listForUser(user.userId!, limit ?? 10, offset ?? 0);
  }

  @Get('active')
  async listActive(
    @Req() req: RequestWithUser,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
  ): Promise<PaginatedPromotionRedemptionsResponseDto> {
    const user = getUserFromRequest(req);

    return await this.promotionRedemptionService.listActiveForUser(user.userId!, limit ?? 10, offset ?? 0);
  }
}
