import type { ActionCenterGroup, ActionCenterItem } from '@forepath/shared/frontend/data-access-action-center';
import {
  paramText,
  type ActionCenterLink,
  type ActionCenterPresenter,
  type ActionCenterPresenterSet,
} from '@forepath/shared/frontend/feature-action-center';

/** Comma-joined non-empty parts (meta lines). */
function joinParts(...parts: Array<string | null | undefined>): string | null {
  const present = parts.filter((part): part is string => !!part && part.trim().length > 0);

  return present.length > 0 ? present.join(', ') : null;
}

const link = (commands: readonly unknown[], queryParams?: ActionCenterLink['queryParams']): ActionCenterLink => ({
  commands,
  queryParams,
});
/** A workspace page (`/<page>/<clientId>`), or the page itself when the item has no workspace. */
const workspacePage =
  (page: string) =>
  (item: ActionCenterItem): ActionCenterLink =>
    paramText(item.params, 'clientId') ? link([`/${page}`, paramText(item.params, 'clientId')]) : link([`/${page}`]);
/** The workspace an item belongs to (secondary line). */
const workspaceMeta = (item: ActionCenterItem, ...extra: Array<string | null>) =>
  joinParts(paramText(item.params, 'clientName'), ...extra);
/** Group links of workspace types: the workspace of the first record when all records share it. */
const groupWorkspacePage = (page: string) => (group: ActionCenterGroup) => {
  const clientIds = new Set(group.items.map((item) => paramText(item.params, 'clientId')).filter(Boolean));

  return clientIds.size === 1 ? link([`/${page}`, [...clientIds][0]]) : link([`/${page}`]);
};
const ticketItem: Pick<ActionCenterPresenter, 'itemTitle' | 'itemLink'> = {
  itemTitle: (item) => paramText(item.params, 'title'),
  itemLink: (item) =>
    paramText(item.params, 'clientId')
      ? link(['/tickets', paramText(item.params, 'clientId')], { openTicketId: item.id })
      : link(['/tickets']),
};

/** Presenters of the Agenstra item types (see `AGENSTRA_ACTION_TYPES` in the agent controller). */
export function agenstraActionCenterPresenters(): ActionCenterPresenterSet {
  return {
    categories: {
      workspaces: $localize`:@@featureAgentActionCenter-categoryWorkspaces:Workspaces`,
      tickets: $localize`:@@featureAgentActionCenter-categoryTickets:Tickets`,
      automation: $localize`:@@featureAgentActionCenter-categoryAutomation:Agent automation`,
      deployments: $localize`:@@featureAgentActionCenter-categoryDeployments:Deployments`,
      integrations: $localize`:@@featureAgentActionCenter-categoryIntegrations:Integrations`,
    },
    types: {
      'agenstra.setup.first_workspace': {
        icon: 'plus-square-dotted',
        title: $localize`:@@featureAgentActionCenter-setupWorkspaceTitle:Connect your first workspace`,
        description: $localize`:@@featureAgentActionCenter-setupWorkspaceDescription:Register an agent manager as a workspace to create agents, tickets and automation.`,
        link: () => link(['/clients']),
        actionLabel: $localize`:@@featureAgentActionCenter-setupWorkspaceAction:Add workspace`,
      },
      'agenstra.workspaces.isolation_failed': {
        icon: 'shield-exclamation',
        title: $localize`:@@featureAgentActionCenter-isolationFailedTitle:Workspace isolation unavailable`,
        description: $localize`:@@featureAgentActionCenter-isolationFailedDescription:The standard container isolation is not ready on these hosts; new environments cannot start safely.`,
        link: () => link(['/clients']),
        itemTitle: (item) => paramText(item.params, 'clientName'),
        itemMeta: (item) => paramText(item.params, 'state') || null,
        itemLink: (item) => link(['/clients', item.id]),
      },
      'agenstra.agents.config_sync_failed': {
        icon: 'arrow-repeat',
        title: $localize`:@@featureAgentActionCenter-configSyncFailedTitle:Configuration not applied`,
        description: $localize`:@@featureAgentActionCenter-configSyncFailedDescription:Agent configuration or layer files could not be synced to environments.`,
        link: () => link(['/agent-config']),
        itemTitle: (item) => workspaceMeta(item) ?? paramText(item.params, 'agentId'),
        itemMeta: (item) => paramText(item.params, 'error') || null,
        itemLink: (item) =>
          paramText(item.params, 'clientId') && paramText(item.params, 'agentId')
            ? link(['/clients', paramText(item.params, 'clientId'), 'agents', paramText(item.params, 'agentId')])
            : link(['/agent-config']),
      },
      'agenstra.workspaces.graph_failed': {
        icon: 'diagram-3',
        title: $localize`:@@featureAgentActionCenter-graphFailedTitle:Workspace graph build failed`,
        description: $localize`:@@featureAgentActionCenter-graphFailedDescription:Rebuild the graph after fixing the cause.`,
        link: groupWorkspacePage('graphs'),
        itemTitle: (item) => paramText(item.params, 'clientName'),
        itemMeta: (item) => paramText(item.params, 'error') || null,
        itemLink: workspacePage('graphs'),
      },
      'agenstra.tickets.automation_approval': {
        icon: 'person-check',
        title: $localize`:@@featureAgentActionCenter-automationApprovalTitle:Automation waiting for approval`,
        description: $localize`:@@featureAgentActionCenter-automationApprovalDescription:Tickets prepared for autonomous work need your approval before agents start.`,
        link: groupWorkspacePage('tickets'),
        ...ticketItem,
        itemMeta: (item) => workspaceMeta(item, paramText(item.params, 'priority')),
      },
      'agenstra.tickets.automation_attention': {
        icon: 'robot',
        title: $localize`:@@featureAgentActionCenter-automationAttentionTitle:Automation needs attention`,
        description: $localize`:@@featureAgentActionCenter-automationAttentionDescription:The latest autonomous run failed, timed out or escalated to a human.`,
        link: groupWorkspacePage('tickets'),
        ...ticketItem,
        itemMeta: (item) =>
          workspaceMeta(item, paramText(item.params, 'failureCode') || paramText(item.params, 'status')),
      },
      'agenstra.tasks.approval_pending': {
        icon: 'calendar2-check',
        title: $localize`:@@featureAgentActionCenter-tasksApprovalTitle:Scheduled tasks to approve`,
        description: $localize`:@@featureAgentActionCenter-tasksApprovalDescription:Agents created or changed these tasks; they only run after approval.`,
        link: groupWorkspacePage('tasks'),
        itemTitle: (item) => paramText(item.params, 'title'),
        itemMeta: (item) => workspaceMeta(item),
        itemLink: workspacePage('tasks'),
      },
      'agenstra.tasks.run_failed': {
        icon: 'calendar2-x',
        title: $localize`:@@featureAgentActionCenter-tasksFailedTitle:Scheduled tasks failing`,
        description: $localize`:@@featureAgentActionCenter-tasksFailedDescription:The last run of these tasks failed.`,
        link: groupWorkspacePage('tasks'),
        itemTitle: (item) => paramText(item.params, 'title'),
        itemMeta: (item) => workspaceMeta(item),
        itemLink: workspacePage('tasks'),
      },
      'agenstra.handoffs.failed': {
        icon: 'arrow-left-right',
        title: $localize`:@@featureAgentActionCenter-handoffsFailedTitle:Agent handoffs failed`,
        description: $localize`:@@featureAgentActionCenter-handoffsFailedDescription:Work passed between agents failed or the answer could not be delivered.`,
        link: groupWorkspacePage('clients'),
        itemTitle: (item) =>
          paramText(item.params, 'title') ||
          joinParts(paramText(item.params, 'source'), paramText(item.params, 'target')) ||
          '',
        itemMeta: (item) => workspaceMeta(item, paramText(item.params, 'error')),
        itemLink: workspacePage('clients'),
      },
      'agenstra.deployments.approval_pending': {
        icon: 'rocket',
        title: $localize`:@@featureAgentActionCenter-deploymentsApprovalTitle:Pipelines to approve`,
        description: $localize`:@@featureAgentActionCenter-deploymentsApprovalDescription:Deployment workflows proposed or changed by agents wait for approval.`,
        link: groupWorkspacePage('pipelines'),
        itemTitle: (item) => paramText(item.params, 'name'),
        itemMeta: (item) => workspaceMeta(item, paramText(item.params, 'repository')),
        itemLink: workspacePage('pipelines'),
      },
      'agenstra.deployments.run_failed': {
        icon: 'rocket-takeoff',
        title: $localize`:@@featureAgentActionCenter-deploymentsFailedTitle:Deployments failing`,
        description: $localize`:@@featureAgentActionCenter-deploymentsFailedDescription:The last run of these pipelines failed or timed out.`,
        link: groupWorkspacePage('pipelines'),
        itemTitle: (item) => paramText(item.params, 'name'),
        itemMeta: (item) => workspaceMeta(item, paramText(item.params, 'conclusion')),
        itemLink: workspacePage('pipelines'),
      },
      'agenstra.connections.test_failed': {
        icon: 'plug',
        title: $localize`:@@featureAgentActionCenter-connectionsFailedTitle:Connections failing`,
        description: $localize`:@@featureAgentActionCenter-connectionsFailedDescription:The last connection test failed. Check the credentials.`,
        link: () => link(['/connections/deployments']),
        itemTitle: (item) => paramText(item.params, 'label'),
        itemMeta: (item) => paramText(item.params, 'error') || null,
        itemLink: (item) =>
          link([item.params['kind'] === 'atlassian' ? '/connections/atlassian' : '/connections/deployments']),
      },
      'agenstra.imports.failed': {
        icon: 'cloud-download',
        title: $localize`:@@featureAgentActionCenter-importsFailedTitle:Imports failing`,
        description: $localize`:@@featureAgentActionCenter-importsFailedDescription:Scheduled imports from Jira or Confluence report errors.`,
        link: () => link(['/connections/atlassian']),
        itemTitle: (item) => joinParts(paramText(item.params, 'provider'), paramText(item.params, 'importKind')) ?? '',
        itemMeta: (item) => workspaceMeta(item, paramText(item.params, 'error')),
      },
    },
  };
}

/** Where the shared platform items lead in the agent console. */
export const AGENSTRA_PLATFORM_ACTION_LINKS = {
  updates: link(['/updates']),
  webhooks: link(['/webhooks']),
  emailSettings: link(['/system-settings']),
};
