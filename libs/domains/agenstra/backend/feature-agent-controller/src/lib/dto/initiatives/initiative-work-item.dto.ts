import {
  INITIATIVE_LIMITS,
  UNKNOWN_RESOLUTIONS,
  WORK_ITEM_KINDS,
  type UnknownResolution,
  type WorkItemKind,
} from '@forepath/agenstra/shared/util-initiative-method';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { TicketPriority } from '../../entities/ticket.enums';
import { PREFERRED_MODEL_PATTERN } from '../../utils/preferred-model.utils';

export class CreateInitiativeWorkItemDto {
  @IsIn([...WORK_ITEM_KINDS])
  kind!: WorkItemKind;

  /** Epic of a story / spike / bug. */
  @IsOptional()
  @IsUUID('4')
  parentId?: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(INITIATIVE_LIMITS.titleMaxLength)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(INITIATIVE_LIMITS.requirementsMaxLength)
  requirements?: string;

  @IsOptional()
  @IsString()
  @MaxLength(INITIATIVE_LIMITS.shortTextMaxLength)
  verify?: string;

  @IsOptional()
  @IsString()
  @MaxLength(INITIATIVE_LIMITS.shortTextMaxLength)
  doneWhen?: string;

  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority;
}

/** Edits of items that are not built or done (locked items are never rewritten). */
export class UpdateInitiativeWorkItemDto {
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
  @MaxLength(INITIATIVE_LIMITS.requirementsMaxLength)
  requirements?: string;

  @IsOptional()
  @IsString()
  @MaxLength(INITIATIVE_LIMITS.shortTextMaxLength)
  verify?: string;

  @IsOptional()
  @IsString()
  @MaxLength(INITIATIVE_LIMITS.shortTextMaxLength)
  doneWhen?: string;

  @IsOptional()
  @IsBoolean()
  refined?: boolean;

  @IsOptional()
  @IsBoolean()
  planCheckpoint?: boolean;

  @IsOptional()
  @IsBoolean()
  doneCheckpoint?: boolean;

  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority;
}

/** Move one item before another (same level), conditional on the initiative's version. */
export class ReorderInitiativeWorkItemDto {
  @IsInt()
  @Min(1)
  expectedInitiativeVersion!: number;

  /** Item to move before; omitted: move to the end. */
  @IsOptional()
  @IsUUID('4')
  beforeId?: string;
}

export class SetInitiativeWorkItemDependenciesDto {
  @IsInt()
  @Min(1)
  expectedInitiativeVersion!: number;

  @IsArray()
  @ArrayMaxSize(INITIATIVE_LIMITS.dependenciesPerItemMax)
  @IsUUID('4', { each: true })
  prerequisiteIds!: string[];
}

/** Status a human sets on the page: done (BMad: only people mark done), dropped, blocked or back to draft. */
export class SetInitiativeWorkItemStatusDto {
  @IsIn(['done', 'dropped', 'blocked', 'draft'])
  status!: 'done' | 'dropped' | 'blocked' | 'draft';
}

export class CreateInitiativeUnknownDto {
  @IsOptional()
  @IsUUID('4')
  workItemId?: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(INITIATIVE_LIMITS.shortTextMaxLength)
  question!: string;

  @IsIn([...UNKNOWN_RESOLUTIONS])
  resolution!: UnknownResolution;
}

export class ResolveInitiativeUnknownDto {
  @IsString()
  @MaxLength(INITIATIVE_LIMITS.shortTextMaxLength)
  answer!: string;
}

export class TransferAutomationSettingsDto {
  @IsBoolean()
  eligible!: boolean;

  /** OpenCode `provider/model` of the autonomous runs (required when eligible; defaults to the initiative's model). */
  @IsOptional()
  @IsString()
  @MaxLength(256)
  @Matches(PREFERRED_MODEL_PATTERN)
  preferredModel?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  allowedAgentIds?: string[];
}

export class TransferInitiativeDto {
  /** Epics to transfer (all accepted epics when omitted). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(INITIATIVE_LIMITS.itemsPerTurnMax)
  @IsUUID('4', { each: true })
  epicIds?: string[];

  /** Ticket automation for the created story tickets (workspace managers only, like on the ticket board). */
  @IsOptional()
  @ValidateNested()
  @Type(() => TransferAutomationSettingsDto)
  automation?: TransferAutomationSettingsDto;
}

export class ReleaseInitiativeDto {
  /** Items to release (all ready items when omitted). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(INITIATIVE_LIMITS.itemsPerTurnMax)
  @IsUUID('4', { each: true })
  workItemIds?: string[];
}

export class PlanInitiativeStoryDto {
  @IsUUID('4')
  agentId!: string;

  /** Visible chat the plan card belongs to (and executes in). */
  @IsUUID('4')
  chatId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  @Matches(PREFERRED_MODEL_PATTERN)
  model?: string;

  @IsOptional()
  @IsString()
  @MaxLength(INITIATIVE_LIMITS.messageMaxLength)
  instructions?: string;
}
