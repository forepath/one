/**
 * Long-running operation progress, the Agenstra provisioning-progress pattern 1:1 (3.19):
 * weighted steps, percentage never decreases and is capped at 99 until completion.
 */
export const OPERATION_STATUSES = ['running', 'completed', 'failed'] as const;
export type OperationStatus = (typeof OPERATION_STATUSES)[number];

export interface OperationProgress {
  operationId: string;
  /** e.g. `apply`, `rollback`, `migration`, `node-join`, `image-pull`. */
  operation: string;
  /** Entity the operation runs on, e.g. `node/n1` or `deployment/shop/api`. */
  entity: string;
  /** Parent entities for stacked bars (deployment → project → cluster, node → site). */
  parents?: string[];
  status: OperationStatus;
  step: string;
  stepIndex: number;
  stepCount: number;
  progress: number;
  error?: string;
  startedAt: string;
  updatedAt: string;
}

export interface ProgressStep {
  step: string;
  weight: number;
}

export function computeProgress(steps: readonly ProgressStep[], stepIndex: number, fraction: number): number {
  const total = steps.reduce((sum, s) => sum + s.weight, 0);

  if (total <= 0) return 0;

  const done = steps.slice(0, stepIndex).reduce((sum, s) => sum + s.weight, 0);
  const current = (steps[stepIndex]?.weight ?? 0) * Math.min(1, Math.max(0, fraction));

  return Math.min(99, Math.floor(((done + current) / total) * 100));
}
