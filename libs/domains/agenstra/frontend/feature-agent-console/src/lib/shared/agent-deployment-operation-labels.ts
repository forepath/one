import type { AgentDeploymentOperation } from '@forepath/agenstra/shared/util-opencode-config';

/** Operator-facing label of a deployment run action (task / ticket automation opt-ins). */
export function agentDeploymentOperationLabel(operation: AgentDeploymentOperation): string {
  switch (operation) {
    case 'deployment.trigger':
      return $localize`:@@featureDeploymentOperations-trigger:Start pipeline runs`;
    case 'deployment.cancel':
      return $localize`:@@featureDeploymentOperations-cancel:Cancel pipeline runs`;
  }
}

/**
 * Help text of the "Allowed CI actions" opt-in: only pipelines that allow environment triggers, default
 * branch and defined inputs only.
 */
export function agentDeploymentOperationsHint(): string {
  return $localize`:@@featureDeploymentOperations-hint:Runs may start or cancel pipeline runs without asking. Only pipelines that allow environment runs, with their default branch and defined inputs only. Leave empty to keep runs from acting on pipelines.`;
}

/** Heading of the "Allowed CI actions" opt-in (tasks, ticket automation). */
export function agentDeploymentOperationsHeading(): string {
  return $localize`:@@featureDeploymentOperations-heading:Allowed CI actions`;
}
