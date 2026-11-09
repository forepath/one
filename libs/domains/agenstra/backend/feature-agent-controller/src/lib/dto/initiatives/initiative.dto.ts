import {
  INITIATIVE_LIMITS,
  INITIATIVE_PATHS,
  INITIATIVE_PHASES,
  INITIATIVE_PREREQUISITE_SATISFIED_AT,
  INITIATIVE_STATES,
  type InitiativePath,
  type InitiativePhase,
  type InitiativePrerequisiteSatisfiedAt,
  type InitiativeState,
} from '@forepath/agenstra/shared/util-initiative-method';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

import { PREFERRED_MODEL_PATTERN } from '../../utils/preferred-model.utils';

export class CreateInitiativeDto {
  @IsUUID('4')
  clientId!: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(INITIATIVE_LIMITS.titleMaxLength)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(INITIATIVE_LIMITS.intentMaxLength)
  intent?: string;

  @IsIn([...INITIATIVE_PATHS])
  path!: InitiativePath;
}

/** Conditional update: `expectedVersion` is the version the user edited (409 when it changed meanwhile). */
export class UpdateInitiativeDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsOptional()
  @IsNotEmpty()
  @IsString()
  @MaxLength(INITIATIVE_LIMITS.titleMaxLength)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(INITIATIVE_LIMITS.intentMaxLength)
  intent?: string;

  @IsOptional()
  @IsIn([...INITIATIVE_PATHS])
  path?: InitiativePath;

  @IsOptional()
  @IsIn([...INITIATIVE_PHASES])
  phase?: InitiativePhase;

  @IsOptional()
  @IsIn([...INITIATIVE_STATES])
  state?: InitiativeState;

  @IsOptional()
  @IsUUID('4')
  defaultAgentId?: string | null;

  /** OpenCode `provider/model`; null or an empty string clears it. */
  @ValidateIf((_, value) => value !== null && value !== undefined && value !== '')
  @IsString()
  @MaxLength(256)
  @Matches(PREFERRED_MODEL_PATTERN)
  defaultModel?: string | null;

  @IsOptional()
  @IsIn([...INITIATIVE_PREREQUISITE_SATISFIED_AT])
  prerequisiteSatisfiedAt?: InitiativePrerequisiteSatisfiedAt;

  @IsOptional()
  @IsBoolean()
  autoRelease?: boolean;
}

export class StartIterationDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}
