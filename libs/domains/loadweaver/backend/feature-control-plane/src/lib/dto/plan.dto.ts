import { IsArray, IsBoolean, IsIn, IsOptional, IsString, Matches, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

import type { PlanEntity, PlanProgress, PlanResourceChange, PlanSource, PlanStatus } from '../entities/plan.entity';

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
  /** The author's role per touched project when planned, and why a project's part is risky (3.17). */
  creatorRoles: Record<string, string>;
  risk: Record<string, string[]>;
  approvals: { project: string; userId: string; createdAt: string }[];
  /** Live progress of an apply / rollback (step + %, per node and layer). */
  progress: PlanProgress | null;
  /** The failed plan this fix-forward resolves. */
  resolves: string | null;
  /** Where the plan came from: Git (commit, ref, author), UI, API, drift, system; PRs of authoritative scopes. */
  source: PlanSource | null;
  error: string | null;
  createdAt: string;
  appliedAt: string | null;
}

export function toPlanResponse(
  plan: PlanEntity,
  approvals: readonly { project: string; userId: string; createdAt: Date }[] = [],
): PlanResponseDto {
  return {
    id: plan.id,
    status: plan.status,
    changes: plan.changes,
    networkChanges: plan.networkChanges,
    diagnostics: plan.diagnostics,
    workloadChanges: plan.workloadChanges ?? [],
    failureAnalysis: plan.failureAnalysis ?? null,
    // Pins only: the inspected microVM / VM images (layers, process config) stay internal (3.35).
    deploymentStates: Object.fromEntries(
      Object.entries(plan.deploymentStates ?? {}).map(([id, state]) => [
        id,
        { images: state.images, secretVersions: state.secretVersions },
      ]),
    ),
    warnings: plan.warnings ?? [],
    createdBy: plan.createdBy,
    creatorRoles: plan.creatorRoles ?? {},
    risk: plan.risk ?? {},
    progress: plan.progress ?? null,
    resolves: plan.resolves ?? null,
    source: plan.source ?? null,
    approvals: approvals.map((a) => ({ project: a.project, userId: a.userId, createdAt: a.createdAt.toISOString() })),
    error: plan.error,
    createdAt: plan.createdAt.toISOString(),
    appliedAt: plan.appliedAt?.toISOString() ?? null,
  };
}

export const PLAN_STATUSES: readonly PlanStatus[] = [
  'pending',
  'applying',
  'applied',
  'failed',
  'discarded',
  'rolling-back',
  'rolled-back',
  'rollback-failed',
];

/** `GET /plans` filters (`limit` is read separately). */
export class ListPlansQueryDto {
  @IsOptional()
  @IsIn(PLAN_STATUSES)
  status?: PlanStatus;

  @IsOptional()
  @Matches(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/)
  project?: string;

  @IsOptional()
  @IsString()
  limit?: string;
}
