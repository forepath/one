import type { ClientEntity } from '@forepath/identity/backend';

import type { AtlassianSiteConnectionEntity } from '../entities/atlassian-site-connection.entity';
import type { DeploymentConnectionEntity } from '../entities/deployment-connection.entity';
import type { DeploymentRunEntity } from '../entities/deployment-run.entity';
import type { DeploymentWorkflowEntity } from '../entities/deployment-workflow.entity';
import type { ExternalImportConfigEntity } from '../entities/external-import-config.entity';
import type { KnowledgeNodeEntity } from '../entities/knowledge-node.entity';
import type { StatisticsAgentEntity } from '../entities/statistics-agent.entity';
import type { StatisticsChatFilterDropEntity } from '../entities/statistics-chat-filter-drop.entity';
import type { StatisticsChatFilterFlagEntity } from '../entities/statistics-chat-filter-flag.entity';
import type { StatisticsChatIoEntity } from '../entities/statistics-chat-io.entity';
import type { StatisticsEgressEventEntity } from '../entities/statistics-egress-event.entity';
import type { StatisticsEntityEventEntity } from '../entities/statistics-entity-event.entity';
import type { StatisticsUserEntity } from '../entities/statistics-user.entity';
import type { TicketEntity } from '../entities/ticket.entity';

import type { AgenstraSearchDocument, AgenstraSearchEntityType } from './agenstra-search.types';

function joinSearchable(parts: Array<string | number | null | undefined>): string {
  return parts
    .map((part) => (part === null || part === undefined ? '' : String(part).trim()))
    .filter((part) => part.length > 0)
    .join(' ');
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return String(value);
}

export function mapClientToSearchDocument(client: ClientEntity): AgenstraSearchDocument {
  return {
    id: client.id,
    entityType: 'clients',
    clientId: client.id,
    name: client.name,
    description: client.description ?? null,
    createdAt: toIso(client.createdAt),
    updatedAt: toIso(client.updatedAt),
    searchableText: joinSearchable([client.id, client.name, client.description, client.endpoint]),
  };
}

export function mapAgentToSearchDocument(
  agent: StatisticsAgentEntity,
  originalClientId: string,
): AgenstraSearchDocument {
  return {
    id: agent.originalAgentId,
    entityType: 'agents',
    clientId: originalClientId,
    statisticsClientId: agent.statisticsClientId,
    name: agent.name ?? null,
    description: agent.description ?? null,
    agentType: agent.agentType,
    createdAt: toIso(agent.createdAt),
    updatedAt: toIso(agent.updatedAt),
    searchableText: joinSearchable([agent.originalAgentId, agent.name, agent.description, agent.agentType]),
  };
}

export function mapTicketToSearchDocument(ticket: TicketEntity): AgenstraSearchDocument {
  return {
    id: ticket.id,
    entityType: 'tickets',
    clientId: ticket.clientId,
    title: ticket.title,
    content: ticket.content ?? null,
    status: ticket.status,
    priority: ticket.priority,
    createdAt: toIso(ticket.createdAt),
    updatedAt: toIso(ticket.updatedAt),
    searchableText: joinSearchable([
      ticket.id,
      ticket.title,
      ticket.content,
      ticket.status,
      ticket.priority,
      ticket.longSha,
    ]),
  };
}

export function mapKnowledgeNodeToSearchDocument(node: KnowledgeNodeEntity): AgenstraSearchDocument {
  return {
    id: node.id,
    entityType: 'knowledge-nodes',
    clientId: node.clientId,
    title: node.title,
    content: node.content ?? null,
    status: node.nodeType,
    createdAt: toIso(node.createdAt),
    updatedAt: toIso(node.updatedAt),
    searchableText: joinSearchable([node.id, node.title, node.content, node.nodeType, node.longSha]),
  };
}

export function mapChatIoToSearchDocument(
  row: StatisticsChatIoEntity,
  originalClientId: string,
): AgenstraSearchDocument {
  return {
    id: row.id,
    entityType: 'chat-io',
    clientId: originalClientId,
    statisticsClientId: row.statisticsClientId,
    direction: row.direction,
    interactionKind: row.interactionKind,
    wordCount: row.wordCount,
    charCount: row.charCount,
    createdAt: toIso(row.occurredAt),
    searchableText: joinSearchable([row.id, row.direction, row.interactionKind, row.wordCount, row.charCount]),
  };
}

export function mapFilterDropToSearchDocument(
  row: StatisticsChatFilterDropEntity,
  originalClientId: string,
): AgenstraSearchDocument {
  return {
    id: row.id,
    entityType: 'filter-drops',
    clientId: originalClientId,
    statisticsClientId: row.statisticsClientId,
    filterType: row.filterType,
    filterDisplayName: row.filterDisplayName,
    filterReason: row.filterReason ?? null,
    direction: row.direction,
    wordCount: row.wordCount,
    charCount: row.charCount,
    createdAt: toIso(row.occurredAt),
    searchableText: joinSearchable([row.id, row.filterType, row.filterDisplayName, row.filterReason, row.direction]),
  };
}

export function mapFilterFlagToSearchDocument(
  row: StatisticsChatFilterFlagEntity,
  originalClientId: string,
): AgenstraSearchDocument {
  return {
    id: row.id,
    entityType: 'filter-flags',
    clientId: originalClientId,
    statisticsClientId: row.statisticsClientId,
    filterType: row.filterType,
    filterDisplayName: row.filterDisplayName,
    filterReason: row.filterReason ?? null,
    direction: row.direction,
    wordCount: row.wordCount,
    charCount: row.charCount,
    createdAt: toIso(row.occurredAt),
    searchableText: joinSearchable([row.id, row.filterType, row.filterDisplayName, row.filterReason, row.direction]),
  };
}

export function mapEgressEventToSearchDocument(
  row: StatisticsEgressEventEntity,
  originalClientId: string,
  originalAgentId?: string | null,
): AgenstraSearchDocument {
  return {
    id: row.id,
    entityType: 'egress-events',
    clientId: originalClientId,
    statisticsClientId: row.statisticsClientId,
    agentId: originalAgentId ?? null,
    host: row.host ?? null,
    decision: row.decision,
    kind: row.kind,
    rule: row.rule ?? null,
    label: row.matchedEntry ?? null,
    createdAt: toIso(row.occurredAt),
    searchableText: joinSearchable([
      row.id,
      row.host,
      row.kind,
      row.decision,
      row.rule,
      row.matchedEntry,
      row.matchedSource,
      row.method,
      row.message,
    ]),
  };
}

export function mapEntityEventToSearchDocument(
  row: StatisticsEntityEventEntity,
  originalClientId: string | null,
): AgenstraSearchDocument {
  return {
    id: row.id,
    entityType: 'entity-events',
    clientId: originalClientId,
    statisticsClientId: row.statisticsClientsId ?? null,
    instanceScoped: !originalClientId,
    entityEventType: row.eventType,
    status: row.entityType,
    originalEntityId: row.originalEntityId,
    createdAt: toIso(row.occurredAt),
    searchableText: joinSearchable([row.id, row.eventType, row.entityType, row.originalEntityId]),
  };
}

export function mapAtlassianConnectionToSearchDocument(
  connection: AtlassianSiteConnectionEntity,
): AgenstraSearchDocument {
  return {
    id: connection.id,
    entityType: 'atlassian-connections',
    instanceScoped: true,
    label: connection.label ?? null,
    baseUrl: connection.baseUrl,
    // Non-secret identifiers only: never `apiToken` / `oauthClientSecret`.
    accountEmail: connection.accountEmail ?? null,
    createdAt: toIso(connection.createdAt),
    updatedAt: toIso(connection.updatedAt),
    searchableText: joinSearchable([
      connection.id,
      connection.label,
      connection.baseUrl,
      connection.accountEmail,
      connection.oauthClientId,
    ]),
  };
}

/** Never indexes `credentials` (token / private key); only non-secret identifiers. */
export function mapDeploymentConnectionToSearchDocument(
  connection: DeploymentConnectionEntity,
): AgenstraSearchDocument {
  return {
    id: connection.id,
    entityType: 'deployment-connections',
    instanceScoped: true,
    label: connection.label,
    baseUrl: connection.baseUrl ?? null,
    provider: connection.provider,
    status: connection.lastTestStatus,
    createdAt: toIso(connection.createdAt),
    updatedAt: toIso(connection.updatedAt),
    searchableText: joinSearchable([
      connection.id,
      connection.label,
      connection.provider,
      connection.baseUrl,
      connection.authType,
      connection.appId,
      connection.installationId,
      connection.username,
    ]),
  };
}

export function mapImportConfigToSearchDocument(config: ExternalImportConfigEntity): AgenstraSearchDocument {
  return {
    id: config.id,
    entityType: 'import-configs',
    clientId: config.clientId,
    provider: config.provider,
    importKind: config.importKind,
    status: config.enabled ? 'enabled' : 'disabled',
    createdAt: toIso(config.createdAt),
    updatedAt: toIso(config.updatedAt),
    searchableText: joinSearchable([
      config.id,
      config.provider,
      config.importKind,
      config.jql,
      config.cql,
      config.confluenceSpaceKey,
    ]),
  };
}

export function mapEnvironmentToSearchDocument(input: {
  id: string;
  clientId: string;
  agentId?: string | null;
  variable?: string | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
}): AgenstraSearchDocument {
  return {
    id: input.id,
    entityType: 'environments',
    clientId: input.clientId,
    agentId: input.agentId ?? null,
    variable: input.variable ?? null,
    createdAt: toIso(input.createdAt),
    updatedAt: toIso(input.updatedAt),
    searchableText: joinSearchable([input.id, input.agentId, input.variable]),
  };
}

export function mapUserToSearchDocument(user: StatisticsUserEntity): AgenstraSearchDocument {
  return {
    id: user.originalUserId ?? user.id,
    entityType: 'users',
    instanceScoped: true,
    role: user.role,
    createdAt: toIso(user.createdAt),
    updatedAt: toIso(user.updatedAt),
    searchableText: joinSearchable([user.id, user.originalUserId, user.role]),
  };
}

export function mapOpencodeProviderToSearchDocument(provider: {
  id: string;
  name: string;
  npm?: string | null;
  api?: string | null;
  env?: string[] | null;
  models?: Array<{ id?: string; name?: string }> | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
}): AgenstraSearchDocument {
  const modelIds = Array.isArray(provider.models)
    ? provider.models.map((model) => model?.id).filter((id): id is string => typeof id === 'string' && id.length > 0)
    : [];
  const modelNames = Array.isArray(provider.models)
    ? provider.models
        .map((model) => model?.name)
        .filter((name): name is string => typeof name === 'string' && name.length > 0)
    : [];

  return {
    id: provider.id,
    entityType: 'opencode-providers',
    instanceScoped: true,
    name: provider.name,
    provider: provider.npm ?? null,
    label: provider.api ?? null,
    createdAt: toIso(provider.createdAt),
    updatedAt: toIso(provider.updatedAt),
    searchableText: joinSearchable([
      provider.id,
      provider.name,
      provider.npm,
      provider.api,
      ...(provider.env ?? []),
      ...modelIds,
      ...modelNames,
    ]),
  };
}

export function mapOpencodeMcpServerToSearchDocument(server: {
  name: string;
  title: string;
  description: string;
  version?: string | null;
  status?: string | null;
  websiteUrl?: string | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
}): AgenstraSearchDocument {
  return {
    id: server.name,
    entityType: 'opencode-mcp-servers',
    instanceScoped: true,
    name: server.name,
    title: server.title,
    description: server.description,
    status: server.status ?? null,
    createdAt: toIso(server.createdAt),
    updatedAt: toIso(server.updatedAt),
    searchableText: joinSearchable([
      server.name,
      server.title,
      server.description,
      server.version,
      server.status,
      server.websiteUrl,
    ]),
  };
}

/** Workflow metadata only; `defaultInputs` are never indexed. `connection` (relation) supplies the provider. */
export function mapDeploymentWorkflowToSearchDocument(workflow: DeploymentWorkflowEntity): AgenstraSearchDocument {
  return {
    id: workflow.id,
    entityType: 'deployment-workflows',
    clientId: workflow.clientId,
    name: workflow.name,
    description: workflow.description ?? null,
    provider: workflow.connection?.provider ?? null,
    label: workflow.repository,
    status: workflow.enabled ? 'enabled' : 'disabled',
    kind: workflow.scope,
    createdAt: toIso(workflow.createdAt),
    updatedAt: toIso(workflow.updatedAt),
    searchableText: joinSearchable([
      workflow.id,
      workflow.name,
      workflow.description,
      workflow.repository,
      workflow.workflow,
      workflow.defaultRef,
      workflow.connection?.label,
      workflow.connection?.provider,
    ]),
  };
}

/** Run metadata only; run `inputs` and logs are never indexed. `workflowEntity` (relation) supplies the name. */
export function mapDeploymentRunToSearchDocument(run: DeploymentRunEntity): AgenstraSearchDocument {
  return {
    id: run.id,
    entityType: 'deployment-runs',
    clientId: run.clientId,
    agentId: run.agentId ?? null,
    title: run.name ?? null,
    name: run.workflowEntity?.name ?? null,
    status: run.status,
    decision: run.conclusion ?? null,
    kind: run.triggeredByType,
    label: run.ref ?? null,
    createdAt: toIso(run.createdAt),
    updatedAt: toIso(run.updatedAt),
    searchableText: joinSearchable([
      run.id,
      run.providerRunId,
      run.name,
      run.workflowEntity?.name,
      run.workflowEntity?.repository,
      run.status,
      run.conclusion,
      run.ref,
      run.sha,
      run.triggeredByType,
    ]),
  };
}

export function isAgenstraSearchEntityType(value: string): value is AgenstraSearchEntityType {
  return (
    value === 'clients' ||
    value === 'agents' ||
    value === 'tickets' ||
    value === 'knowledge-nodes' ||
    value === 'egress-events' ||
    value === 'chat-io' ||
    value === 'filter-drops' ||
    value === 'filter-flags' ||
    value === 'entity-events' ||
    value === 'atlassian-connections' ||
    value === 'import-configs' ||
    value === 'environments' ||
    value === 'users' ||
    value === 'opencode-providers' ||
    value === 'opencode-mcp-servers' ||
    value === 'deployment-connections' ||
    value === 'deployment-workflows' ||
    value === 'deployment-runs'
  );
}
