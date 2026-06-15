import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

export class UpsertClientAgentAutonomyDto {
  @IsBoolean()
  enabled!: boolean;

  @IsBoolean()
  preImproveTicket!: boolean;

  @IsInt()
  @Min(60_000)
  @Max(86_400_000)
  maxRuntimeMs!: number;

  @IsInt()
  @Min(1)
  @Max(500)
  maxIterations!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  tokenBudgetLimit?: number | null;
}

/** Response for listing which agents may run autonomous ticket work for a client. */
export class EnabledAutonomyAgentIdsResponseDto {
  agentIds!: string[];
}

export class ClientAgentAutonomyResponseDto {
  clientId!: string;
  agentId!: string;
  enabled!: boolean;
  preImproveTicket!: boolean;
  maxRuntimeMs!: number;
  maxIterations!: number;
  tokenBudgetLimit!: number | null;
  createdAt!: Date;
  updatedAt!: Date;
}
