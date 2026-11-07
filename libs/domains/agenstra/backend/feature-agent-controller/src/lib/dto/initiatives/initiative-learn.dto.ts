import {
  FINDING_SEVERITIES,
  INITIATIVE_LIMITS,
  RETROSPECTIVE_VERDICTS,
  type FindingSeverity,
  type RetrospectiveVerdict,
} from '@forepath/agenstra/shared/util-initiative-method';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateInitiativeFindingDto {
  @IsOptional()
  @IsUUID('4')
  workItemId?: string;

  @IsIn([...FINDING_SEVERITIES])
  severity!: FindingSeverity;

  @IsNotEmpty()
  @IsString()
  @MaxLength(INITIATIVE_LIMITS.findingMaxLength)
  body!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(INITIATIVE_LIMITS.evidenceRefsMax)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  evidence?: string[];
}

export class UpdateInitiativeFindingDto {
  @IsIn(['open', 'dismissed'])
  status!: 'open' | 'dismissed';
}

/** Turn a finding into a new work item (fix now / new story) below an epic. */
export class ConvertInitiativeFindingDto {
  @IsUUID('4')
  epicId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(INITIATIVE_LIMITS.titleMaxLength)
  title?: string;
}

/** Human-written change proposal (the same structure agents propose; validated by the shared parser). */
export class CreateInitiativeProposalDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(INITIATIVE_LIMITS.titleMaxLength)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(INITIATIVE_LIMITS.shortTextMaxLength)
  rationale?: string;

  @IsObject()
  changes!: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  bumpsIteration?: boolean;
}

export class DecideInitiativeProposalDto {
  @IsOptional()
  @IsString()
  @MaxLength(INITIATIVE_LIMITS.shortTextMaxLength)
  note?: string;

  /** Also close tickets of dropped stories (explicit confirmation). */
  @IsOptional()
  @IsBoolean()
  closeDroppedTickets?: boolean;
}

export class CreateInitiativeDecisionDto {
  @IsOptional()
  @IsUUID('4')
  workItemId?: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(INITIATIVE_LIMITS.titleMaxLength)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(INITIATIVE_LIMITS.shortTextMaxLength)
  body?: string;
}

export class DecideInitiativeDecisionDto {
  @IsIn(['accepted', 'rejected'])
  status!: 'accepted' | 'rejected';
}

export class OverrideRetrospectiveDto {
  @IsIn([...RETROSPECTIVE_VERDICTS])
  verdict!: RetrospectiveVerdict;
}
