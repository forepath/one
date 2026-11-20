import { Type } from 'class-transformer';
import { IsNumber, IsUUID, Max, Min } from 'class-validator';

import { INVENTORY_QUANTITY_MAX } from '../inventory/constants/inventory.constants';

/** An article withdrawn per billing period of a subscription (raised as request when the period is invoiced). */
export class ServicePlanInventoryArticleDto {
  @IsUUID('4', { message: 'articleId must be a valid UUID' })
  articleId!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 }, { message: 'quantity must be a number with at most 3 decimals' })
  @Min(0.001, { message: 'quantity must be greater than zero' })
  @Max(INVENTORY_QUANTITY_MAX)
  quantity!: number;
}
