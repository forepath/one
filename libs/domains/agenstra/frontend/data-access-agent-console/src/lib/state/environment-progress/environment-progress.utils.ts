import type {
  EnvironmentProgress,
  EnvironmentProgressSegment,
  WorkspaceEnvironmentProgress,
} from './environment-progress.types';

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(100, Math.max(0, value));
}

/** Sort operations oldest first (stable display order for rows and stacked segments). */
export function sortEnvironmentProgress(operations: EnvironmentProgress[]): EnvironmentProgress[] {
  return [...operations].sort((a, b) => {
    const byStart = Date.parse(a.startedAt) - Date.parse(b.startedAt);

    return Number.isNaN(byStart) || byStart === 0 ? a.operationId.localeCompare(b.operationId) : byStart;
  });
}

/**
 * Aggregate all running operations of a workspace: the average progress plus one stacked segment per
 * operation whose width is its share of the whole bar (segments sum up to the average).
 */
export function buildWorkspaceEnvironmentProgress(
  clientId: string,
  operations: EnvironmentProgress[],
): WorkspaceEnvironmentProgress | null {
  if (operations.length === 0) {
    return null;
  }

  const sorted = sortEnvironmentProgress(operations);
  const count = sorted.length;
  const segments: EnvironmentProgressSegment[] = sorted.map((operation) => {
    const progress = clampPercent(operation.progress);

    return {
      operationId: operation.operationId,
      agentName: operation.agentName,
      operation: operation.operation,
      step: operation.step,
      progress,
      value: progress / count,
    };
  });
  const average = Math.round(segments.reduce((sum, segment) => sum + segment.progress, 0) / count);

  return { clientId, operations: sorted, average, segments };
}

/**
 * Index operations by agentId (newest operation wins when an environment has several).
 * Operations without an agentId (environment not persisted yet) are skipped.
 */
export function indexEnvironmentProgressByAgentId(
  operations: EnvironmentProgress[],
): Record<string, EnvironmentProgress> {
  const byAgentId: Record<string, EnvironmentProgress> = {};

  for (const operation of sortEnvironmentProgress(operations)) {
    if (operation.agentId) {
      byAgentId[operation.agentId] = operation;
    }
  }

  return byAgentId;
}

/**
 * Find the running create operation of an environment that has no id yet (matched by its trimmed name).
 * The newest operation wins when several creates share the name.
 */
export function findCreateEnvironmentProgress(
  operations: EnvironmentProgress[],
  agentName: string | null | undefined,
): EnvironmentProgress | null {
  const name = agentName?.trim();

  if (!name) {
    return null;
  }

  const matches = sortEnvironmentProgress(operations).filter(
    (operation) =>
      operation.operation === 'create' && operation.status === 'running' && operation.agentName.trim() === name,
  );

  return matches.length ? matches[matches.length - 1] : null;
}
