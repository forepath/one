import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

import { TICKET_AUTOMATION_BRANCH_STRATEGIES } from '../../utils/ticket-automation-branch.constants';

/** Single verifier command; mirrors {@link parseAndValidateVerifierProfile} bounds. */
export class VerifierCommandEntryDto {
  @IsString()
  @MaxLength(2048)
  cmd!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  cwd?: string;
}

export class TicketVerifierProfileDto {
  @IsArray()
  @ArrayMaxSize(32)
  @ValidateNested({ each: true })
  @Type(() => VerifierCommandEntryDto)
  commands!: VerifierCommandEntryDto[];
}

export class UpdateTicketAutomationDto {
  @IsOptional()
  @IsBoolean()
  eligible?: boolean;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  allowedAgentIds?: string[];

  @IsOptional()
  @IsBoolean()
  includeWorkspaceContext?: boolean;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  contextEnvironmentIds?: string[];

  @IsOptional()
  @IsBoolean()
  autoEnrichmentEnabled?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => TicketVerifierProfileDto)
  verifierProfile?: TicketVerifierProfileDto;

  @IsOptional()
  @IsBoolean()
  requiresApproval?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  defaultBranchOverride?: string | null;

  @IsOptional()
  @IsIn(TICKET_AUTOMATION_BRANCH_STRATEGIES)
  automationBranchStrategy?: (typeof TICKET_AUTOMATION_BRANCH_STRATEGIES)[number];

  @IsOptional()
  @IsBoolean()
  forceNewAutomationBranchNextRun?: boolean;
}
