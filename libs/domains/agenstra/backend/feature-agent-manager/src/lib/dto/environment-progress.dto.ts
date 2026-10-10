/** Kind of long-running environment (agent) provisioning operation. */
export type EnvironmentProgressOperation = 'create' | 'update';

/** Lifecycle state of a provisioning operation. Terminal states are broadcast once and then dropped. */
export type EnvironmentProgressStatus = 'running' | 'completed' | 'failed';

/**
 * Step identifiers reported while an environment is created or its container is recreated / restarted.
 * Clients map these keys to localized labels.
 */
export type EnvironmentProgressStep =
  | 'queued'
  | 'preparing'
  | 'pullingImage'
  | 'creatingContainer'
  | 'preparingRepository'
  | 'persisting'
  | 'waitingForHealthy'
  | 'summarizingContext'
  | 'recreatingContainer'
  | 'restartingContainer'
  | 'restoringGitCredentials'
  | 'finalizing';

/**
 * Snapshot of one environment provisioning operation (create, or update that restarts / recreates the container).
 * Emitted as `environmentProgress` over the agents websocket and returned by `GET /agents/progress`.
 */
export class EnvironmentProgressDto {
  /** Stable id of the operation (creates have no agent id until the agent row is persisted). */
  operationId!: string;
  /** Agent UUID once known (always set for updates; set during create once persisted). */
  agentId!: string | null;
  agentName!: string;
  operation!: EnvironmentProgressOperation;
  status!: EnvironmentProgressStatus;
  step!: EnvironmentProgressStep;
  /** Zero-based index of the current step within the operation's step plan. */
  stepIndex!: number;
  /** Number of steps in the operation's step plan. */
  stepCount!: number;
  /** Overall progress in percent (0-100, integer). */
  progress!: number;
  /** Failure message (only when status is `failed`). */
  error?: string;
  startedAt!: string;
  updatedAt!: string;
}
