import {
  INITIATIVE_LIMITS,
  INITIATIVE_STEP_KEYS,
  RUN_MODES,
  RUN_STYLES,
  type InitiativeRunMode,
  type InitiativeRunStyle,
  type InitiativeStepKey,
} from '@forepath/agenstra/shared/util-initiative-method';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

import { PREFERRED_MODEL_PATTERN } from '../../utils/preferred-model.utils';

export class StartInitiativeRunDto {
  @IsIn([...INITIATIVE_STEP_KEYS])
  step!: InitiativeStepKey;

  @IsOptional()
  @IsIn([...RUN_MODES])
  mode?: InitiativeRunMode;

  @IsOptional()
  @IsIn([...RUN_STYLES])
  style?: InitiativeRunStyle;

  /** Environment that runs the step (must belong to the workspace). Defaults to the initiative's facilitator. */
  @IsOptional()
  @IsUUID('4')
  agentId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  @Matches(PREFERRED_MODEL_PATTERN)
  model?: string;

  /** Target epic of epic steps. */
  @IsOptional()
  @IsUUID('4')
  workItemId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(INITIATIVE_LIMITS.messageMaxLength)
  message?: string;

  /** Findings a correct-course run starts from. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(INITIATIVE_LIMITS.itemsPerTurnMax)
  @IsUUID('4', { each: true })
  findingIds?: string[];
}

export class InitiativeRunMessageDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(INITIATIVE_LIMITS.messageMaxLength)
  message!: string;
}

/** Accept / discard / cancel are conditional on the run version the user saw. */
export class DecideInitiativeRunDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}
