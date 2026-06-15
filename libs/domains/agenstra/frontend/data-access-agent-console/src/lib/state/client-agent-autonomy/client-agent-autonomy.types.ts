export interface UpsertClientAgentAutonomyDto {
  enabled: boolean;
  preImproveTicket: boolean;
  maxRuntimeMs: number;
  maxIterations: number;
  tokenBudgetLimit?: number | null;
}

export interface ClientAgentAutonomyResponseDto {
  clientId: string;
  agentId: string;
  enabled: boolean;
  preImproveTicket: boolean;
  maxRuntimeMs: number;
  maxIterations: number;
  tokenBudgetLimit: number | null;
  createdAt: string;
  updatedAt: string;
}
