import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';

import {
  EnvironmentProgressDto,
  EnvironmentProgressOperation,
  EnvironmentProgressStatus,
  EnvironmentProgressStep,
} from '../dto/environment-progress.dto';

/** One step of an operation plan; weights are relative and determine the overall percentage. */
export interface EnvironmentProgressStepPlan {
  step: EnvironmentProgressStep;
  weight: number;
}

/** Step plan for creating a new environment (agent container + repository). */
export const CREATE_ENVIRONMENT_PROGRESS_STEPS: readonly EnvironmentProgressStepPlan[] = [
  { step: 'preparing', weight: 5 },
  { step: 'pullingImage', weight: 30 },
  { step: 'creatingContainer', weight: 10 },
  { step: 'preparingRepository', weight: 25 },
  { step: 'persisting', weight: 5 },
  { step: 'waitingForHealthy', weight: 20 },
  { step: 'finalizing', weight: 5 },
];

/** Step plan for recreating a (legacy) container after environment variable / workspace override changes. */
export const RECONCILE_ENVIRONMENT_PROGRESS_STEPS: readonly EnvironmentProgressStepPlan[] = [
  { step: 'queued', weight: 0 },
  { step: 'summarizingContext', weight: 35 },
  { step: 'recreatingContainer', weight: 50 },
  { step: 'restoringGitCredentials', weight: 5 },
  { step: 'finalizing', weight: 10 },
];

/** Step plan for recreating a container while syncing OpenCode secrets/config. */
export const CONFIG_SYNC_ENVIRONMENT_PROGRESS_STEPS: readonly EnvironmentProgressStepPlan[] = [
  { step: 'recreatingContainer', weight: 55 },
  { step: 'waitingForHealthy', weight: 30 },
  { step: 'restoringGitCredentials', weight: 5 },
  { step: 'finalizing', weight: 10 },
];

/**
 * Step plan for applying environment variable / workspace override changes to a container that reads
 * its environment from the managed volume: the container is restarted in place (never deleted), so
 * no conversation summary is needed. `restoringGitCredentials` is skipped unless Git credentials changed.
 */
export const RESTART_ENVIRONMENT_PROGRESS_STEPS: readonly EnvironmentProgressStepPlan[] = [
  { step: 'queued', weight: 0 },
  { step: 'restartingContainer', weight: 50 },
  { step: 'waitingForHealthy', weight: 35 },
  { step: 'restoringGitCredentials', weight: 5 },
  { step: 'finalizing', weight: 10 },
];

/** Step plan for restarting a container in place while syncing OpenCode secrets/config. */
export const CONFIG_SYNC_RESTART_ENVIRONMENT_PROGRESS_STEPS: readonly EnvironmentProgressStepPlan[] = [
  { step: 'restartingContainer', weight: 60 },
  { step: 'waitingForHealthy', weight: 30 },
  { step: 'finalizing', weight: 10 },
];

export interface StartEnvironmentProgressOptions {
  agentId?: string | null;
  agentName: string;
  operation: EnvironmentProgressOperation;
  steps: readonly EnvironmentProgressStepPlan[];
}

export type EnvironmentProgressBroadcaster = (progress: EnvironmentProgressDto) => void;

interface OperationState {
  operationId: string;
  agentId: string | null;
  agentName: string;
  operation: EnvironmentProgressOperation;
  steps: readonly EnvironmentProgressStepPlan[];
  stepIndex: number;
  stepFraction: number;
  progress: number;
  status: EnvironmentProgressStatus;
  error?: string;
  startedAt: Date;
  updatedAt: Date;
}

/**
 * Handle returned by {@link EnvironmentProgressService.start} to report progress of a single operation.
 * All methods are no-ops once the operation reached a terminal state.
 */
export class EnvironmentProgressTracker {
  constructor(
    private readonly service: EnvironmentProgressService,
    readonly operationId: string,
  ) {}

  setAgentId(agentId: string): void {
    this.service.setAgentId(this.operationId, agentId);
  }

  /** Move to the given step of the plan (optionally with an initial in-step fraction 0..1). */
  advance(step: EnvironmentProgressStep, fraction = 0): void {
    this.service.advance(this.operationId, step, fraction);
  }

  /** Report in-step progress (0..1) for the current step, e.g. image pull bytes. */
  reportStepProgress(fraction: number): void {
    this.service.reportStepProgress(this.operationId, fraction);
  }

  complete(): void {
    this.service.complete(this.operationId);
  }

  fail(error: unknown): void {
    this.service.fail(this.operationId, error);
  }
}

/**
 * In-memory tracker for environment provisioning (create / container-recreating updates).
 * Progress snapshots are broadcast to every connected agents-websocket client via a registered
 * broadcaster (see AgentsGateway) and can be listed for an initial REST snapshot.
 */
@Injectable()
export class EnvironmentProgressService {
  private readonly logger = new Logger(EnvironmentProgressService.name);
  private readonly operations = new Map<string, OperationState>();
  private broadcaster?: EnvironmentProgressBroadcaster;

  registerBroadcaster(broadcaster: EnvironmentProgressBroadcaster): void {
    this.broadcaster = broadcaster;
  }

  start(options: StartEnvironmentProgressOptions): EnvironmentProgressTracker {
    if (options.steps.length === 0) {
      throw new Error('Environment progress step plan must not be empty');
    }

    const now = new Date();
    const state: OperationState = {
      operationId: uuidv4(),
      agentId: options.agentId ?? null,
      agentName: options.agentName,
      operation: options.operation,
      steps: options.steps,
      stepIndex: 0,
      stepFraction: 0,
      progress: 0,
      status: 'running',
      startedAt: now,
      updatedAt: now,
    };

    this.operations.set(state.operationId, state);
    this.emit(state);

    return new EnvironmentProgressTracker(this, state.operationId);
  }

  /** Active (running) operations, oldest first. */
  list(): EnvironmentProgressDto[] {
    return [...this.operations.values()]
      .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
      .map((state) => this.toDto(state));
  }

  setAgentId(operationId: string, agentId: string): void {
    const state = this.operations.get(operationId);

    if (!state || state.agentId === agentId) {
      return;
    }

    state.agentId = agentId;
    state.updatedAt = new Date();
    this.emit(state);
  }

  advance(operationId: string, step: EnvironmentProgressStep, fraction = 0): void {
    const state = this.operations.get(operationId);

    if (!state) {
      return;
    }

    const stepIndex = state.steps.findIndex((plan) => plan.step === step);

    if (stepIndex < 0) {
      this.logger.warn(`Unknown progress step '${step}' for operation ${operationId}`);

      return;
    }

    if (stepIndex < state.stepIndex) {
      return;
    }

    state.stepIndex = stepIndex;
    state.stepFraction = clampFraction(fraction);
    this.recompute(state, true);
  }

  reportStepProgress(operationId: string, fraction: number): void {
    const state = this.operations.get(operationId);

    if (!state) {
      return;
    }

    const next = clampFraction(fraction);

    if (next <= state.stepFraction) {
      return;
    }

    state.stepFraction = next;
    this.recompute(state, false);
  }

  complete(operationId: string): void {
    const state = this.operations.get(operationId);

    if (!state) {
      return;
    }

    state.stepIndex = state.steps.length - 1;
    state.stepFraction = 1;
    state.progress = 100;
    state.status = 'completed';
    state.updatedAt = new Date();
    this.operations.delete(operationId);
    this.emit(state);
  }

  fail(operationId: string, error: unknown): void {
    const state = this.operations.get(operationId);

    if (!state) {
      return;
    }

    state.status = 'failed';
    state.error = error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error';
    state.updatedAt = new Date();
    this.operations.delete(operationId);
    this.emit(state);
  }

  private recompute(state: OperationState, stepChanged: boolean): void {
    const totalWeight = state.steps.reduce((sum, plan) => sum + plan.weight, 0);
    const completedWeight = state.steps.slice(0, state.stepIndex).reduce((sum, plan) => sum + plan.weight, 0);
    const currentWeight = state.steps[state.stepIndex]?.weight ?? 0;
    const raw = totalWeight > 0 ? ((completedWeight + currentWeight * state.stepFraction) / totalWeight) * 100 : 0;
    // Never report 100 while running; completion is signalled explicitly.
    const progress = Math.min(99, Math.max(state.progress, Math.floor(raw)));

    if (!stepChanged && progress === state.progress) {
      return;
    }

    state.progress = progress;
    state.updatedAt = new Date();
    this.emit(state);
  }

  private toDto(state: OperationState): EnvironmentProgressDto {
    return {
      operationId: state.operationId,
      agentId: state.agentId,
      agentName: state.agentName,
      operation: state.operation,
      status: state.status,
      step: state.steps[state.stepIndex].step,
      stepIndex: state.stepIndex,
      stepCount: state.steps.length,
      progress: state.progress,
      ...(state.error ? { error: state.error } : {}),
      startedAt: state.startedAt.toISOString(),
      updatedAt: state.updatedAt.toISOString(),
    };
  }

  private emit(state: OperationState): void {
    if (!this.broadcaster) {
      return;
    }

    try {
      this.broadcaster(this.toDto(state));
    } catch (error: unknown) {
      this.logger.warn(
        `Failed to broadcast environment progress for operation ${state.operationId}: ${(error as Error).message}`,
      );
    }
  }
}

function clampFraction(fraction: number): number {
  if (!Number.isFinite(fraction)) {
    return 0;
  }

  return Math.min(1, Math.max(0, fraction));
}
