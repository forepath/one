import { AGENT_DEPLOYMENT_OPERATIONS } from '@forepath/agenstra/shared/util-opencode-config';

import {
  agentDeploymentOperationLabel,
  agentDeploymentOperationsHeading,
  agentDeploymentOperationsHint,
} from './agent-deployment-operation-labels';

describe('agent deployment operation labels', () => {
  it('labels every deployment operation', () => {
    expect(AGENT_DEPLOYMENT_OPERATIONS.map((operation) => agentDeploymentOperationLabel(operation))).toEqual([
      'Start pipeline runs',
      'Cancel pipeline runs',
    ]);
  });

  it('names the opt-in and explains its limits', () => {
    expect(agentDeploymentOperationsHeading()).toBe('Allowed CI actions');
    expect(agentDeploymentOperationsHint()).toContain('Only pipelines that allow environment runs');
    expect(agentDeploymentOperationsHint()).toContain('default branch and defined inputs only');
  });
});
