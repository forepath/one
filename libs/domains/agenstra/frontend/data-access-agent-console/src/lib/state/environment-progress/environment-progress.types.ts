/** Kind of provisioning operation reported by the agent-manager. */
export type EnvironmentProgressOperation = 'create' | 'update';

/** Lifecycle status of a provisioning operation; terminal statuses are emitted once and then dropped. */
export type EnvironmentProgressStatus = 'running' | 'completed' | 'failed';

/** Current step of a provisioning operation. */
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
  | 'finalizing';

/** Environment (agent) create / update progress (agent-manager `EnvironmentProgressDto`). */
export interface EnvironmentProgress {
  operationId: string;
  /** Null while a newly created environment is not persisted yet. */
  agentId: string | null;
  agentName: string;
  operation: EnvironmentProgressOperation;
  status: EnvironmentProgressStatus;
  step: EnvironmentProgressStep;
  stepIndex: number;
  stepCount: number;
  /** Overall percentage 0..100. */
  progress: number;
  error?: string;
  startedAt: string;
  updatedAt: string;
}

/** Running operations of one workspace as delivered by the status socket. */
export interface ClientEnvironmentProgress {
  clientId: string;
  operations: EnvironmentProgress[];
}

/** One segment of a stacked workspace progress bar. */
export interface EnvironmentProgressSegment {
  operationId: string;
  agentName: string;
  operation: EnvironmentProgressOperation;
  step: EnvironmentProgressStep;
  /** Width of the segment in percent of the whole bar (0..100 / number of operations). */
  value: number;
  /** Progress of the single operation (0..100). */
  progress: number;
}

/** Aggregated progress of all running operations of a workspace. */
export interface WorkspaceEnvironmentProgress {
  clientId: string;
  operations: EnvironmentProgress[];
  /** Average progress of all operations (0..100, rounded). */
  average: number;
  segments: EnvironmentProgressSegment[];
}
