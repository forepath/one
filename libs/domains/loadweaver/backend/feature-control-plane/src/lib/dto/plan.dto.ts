import { IsArray, IsBoolean, IsOptional, IsString, Matches, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

import type { PlanEntity, PlanResourceChange, PlanStatus } from '../entities/plan.entity';

export class ResourceRefDto {
  @IsString()
  @Matches(/^[A-Za-z]{1,64}$/)
  kind!: string;

  @IsString()
  @Matches(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/)
  name!: string;

  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/)
  project?: string;
}

export class CreatePlanDto {
  /** Multi-document YAML bundle of resources to create or update. */
  @IsOptional()
  @IsString()
  @MaxLength(2 * 1024 * 1024)
  documents?: string;

  /** Resources to delete. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ResourceRefDto)
  delete?: ResourceRefDto[];

  /** Deployments whose images and secret versions are re-resolved (new digests, rotated secrets, 3.22). */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ResourceRefDto)
  refresh?: ResourceRefDto[];
}

export class ApplyPlanDto {
  /** Confirms unacknowledged pins listed in the plan's warnings (3.12). */
  @IsOptional()
  @IsBoolean()
  confirm?: boolean;
}

export interface PlanResponseDto {
  id: string;
  status: PlanStatus;
  changes: PlanResourceChange[];
  networkChanges: Record<string, unknown>[];
  diagnostics: Record<string, unknown>[];
  workloadChanges: Record<string, unknown>[];
  failureAnalysis: Record<string, unknown> | null;
  deploymentStates: Record<string, { images: Record<string, string>; secretVersions: Record<string, number> }>;
  warnings: Record<string, unknown>[];
  createdBy: string | null;
  error: string | null;
  createdAt: string;
  appliedAt: string | null;
}

export function toPlanResponse(plan: PlanEntity): PlanResponseDto {
  return {
    id: plan.id,
    status: plan.status,
    changes: plan.changes,
    networkChanges: plan.networkChanges,
    diagnostics: plan.diagnostics,
    workloadChanges: plan.workloadChanges ?? [],
    failureAnalysis: plan.failureAnalysis ?? null,
    deploymentStates: plan.deploymentStates ?? {},
    warnings: plan.warnings ?? [],
    createdBy: plan.createdBy,
    error: plan.error,
    createdAt: plan.createdAt.toISOString(),
    appliedAt: plan.appliedAt?.toISOString() ?? null,
  };
}
