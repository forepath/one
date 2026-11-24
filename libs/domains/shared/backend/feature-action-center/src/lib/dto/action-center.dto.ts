import { IsIn, IsISO8601, IsOptional, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';

import { ACTION_CENTER_ITEM_ID_PATTERN, ACTION_CENTER_ITEM_TYPE_PATTERN } from '../constants/action-center.constants';
import type { ActionCenterSilenceAudience } from '../interfaces/action-center.types';

/** `POST <path>/silences`: silence a whole type (`itemId` omitted / null) or one item, for oneself or everyone. */
export class CreateActionCenterSilenceDto {
  @IsString()
  @MaxLength(128)
  @Matches(ACTION_CENTER_ITEM_TYPE_PATTERN)
  itemType!: string;

  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsString()
  @MaxLength(128)
  @Matches(ACTION_CENTER_ITEM_ID_PATTERN)
  itemId?: string | null;

  @IsIn(['self', 'everyone'])
  audience!: ActionCenterSilenceAudience;

  /** End of the silence (ISO 8601, in the future); omitted / null = until removed. */
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsISO8601({ strict: true })
  until?: string | null;
}
