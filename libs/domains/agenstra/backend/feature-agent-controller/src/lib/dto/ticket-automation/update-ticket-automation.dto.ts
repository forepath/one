import {
  AGENT_DEPLOYMENT_OPERATIONS,
  TICKET_AUTOMATION_CONTENT_WRITE_OPERATIONS,
  type AgentContentWriteOperation,
  type AgentDeploymentOperation,
} from '@forepath/agenstra/shared/util-opencode-config';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import { PREFERRED_MODEL_PATTERN } from '../../utils/preferred-model.utils';
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

  /** OpenCode `provider/model` for autonomous turns; set `null` to clear. Required when eligible. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsString()
  @MaxLength(256)
  @Matches(PREFERRED_MODEL_PATTERN)
  preferredModel?: string | null;

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

  /** Ticket changes autonomous runs may make (tickets of this ticket's tree only; empty: none). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(TICKET_AUTOMATION_CONTENT_WRITE_OPERATIONS.length)
  @IsIn(TICKET_AUTOMATION_CONTENT_WRITE_OPERATIONS, { each: true })
  allowedContentWrites?: AgentContentWriteOperation[];

  /** Deployment run actions autonomous runs may request (`deployment.trigger`, `deployment.cancel`; empty: none). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(AGENT_DEPLOYMENT_OPERATIONS.length)
  @IsIn(AGENT_DEPLOYMENT_OPERATIONS, { each: true })
  allowedDeploymentOperations?: AgentDeploymentOperation[];

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
