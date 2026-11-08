import {
  deploymentAuditEntityContext,
  deploymentAuditEntityRoute,
  isDeploymentAuditEntityType,
} from './audit-deployment-entity.util';

describe('audit deployment entity helpers', () => {
  it('recognizes deployment entity types', () => {
    expect(isDeploymentAuditEntityType('deployment_workflow')).toBe(true);
    expect(isDeploymentAuditEntityType('deployment_run')).toBe(true);
    expect(isDeploymentAuditEntityType('agent')).toBe(false);
  });

  it('links workflows and runs into the workspace deployments page', () => {
    expect(
      deploymentAuditEntityRoute({
        entityType: 'deployment_workflow',
        eventType: 'updated',
        originalEntityId: 'w1',
        clientId: 'c1',
      }),
    ).toBe('/deployments/c1?workflowId=w1');
    expect(
      deploymentAuditEntityRoute({
        entityType: 'deployment_run',
        eventType: 'created',
        originalEntityId: 'r1',
        clientId: 'c1',
      }),
    ).toBe('/deployments/c1?runId=r1');
  });

  it('does not link deleted workflows or rows without a workspace', () => {
    expect(
      deploymentAuditEntityRoute({
        entityType: 'deployment_workflow',
        eventType: 'deleted',
        originalEntityId: 'w1',
        clientId: 'c1',
      }),
    ).toBeNull();
    expect(deploymentAuditEntityRoute({ entityType: 'deployment_run', originalEntityId: 'r1' })).toBeNull();
    expect(deploymentAuditEntityRoute({ entityType: 'client', originalEntityId: 'c1', clientId: 'c1' })).toBeNull();
  });

  it('describes the workspace / environment context', () => {
    expect(deploymentAuditEntityContext({ clientName: 'Shop', agentName: 'Prod' })).toBe(
      'Shop <i class="bi bi-arrow-right"></i> Prod',
    );
    expect(deploymentAuditEntityContext({ clientName: 'Shop' })).toBe('Shop');
    expect(deploymentAuditEntityContext({})).toBeNull();
  });
});
