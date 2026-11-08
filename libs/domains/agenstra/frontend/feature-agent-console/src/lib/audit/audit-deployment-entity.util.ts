/**
 * Audit entity events of workspace deployments (`deployment_workflow`, `deployment_run`). The rows carry the original
 * entity id and the workspace (statistics shadow); a run row does not name its workflow, so its link opens the run and
 * the deployments page resolves the workflow from it.
 */

export const DEPLOYMENT_AUDIT_ENTITY_TYPES = ['deployment_workflow', 'deployment_run'] as const;

export function isDeploymentAuditEntityType(entityType: string): boolean {
  return (DEPLOYMENT_AUDIT_ENTITY_TYPES as readonly string[]).includes(entityType);
}

/** `/deployments/:clientId?workflowId=…` / `?runId=…`; deleted workflows (and rows without a workspace) get no link. */
export function deploymentAuditEntityRoute(row: {
  entityType: string;
  eventType?: string;
  originalEntityId: string;
  clientId?: string;
}): string | null {
  if (!row.clientId || !row.originalEntityId) {
    return null;
  }

  const base = `/deployments/${encodeURIComponent(row.clientId)}`;

  if (row.entityType === 'deployment_workflow') {
    return row.eventType === 'deleted' ? null : `${base}?workflowId=${encodeURIComponent(row.originalEntityId)}`;
  }

  if (row.entityType === 'deployment_run') {
    return `${base}?runId=${encodeURIComponent(row.originalEntityId)}`;
  }

  return null;
}

/** Workspace (→ environment for runs of an environment) the deployment entity belongs to; null when unknown. */
export function deploymentAuditEntityContext(row: { clientName?: string; agentName?: string }): string | null {
  if (row.clientName && row.agentName) {
    return `${row.clientName} <i class="bi bi-arrow-right"></i> ${row.agentName}`;
  }

  return row.clientName ?? row.agentName ?? null;
}
