import { ContainerType } from '../entities/agent.entity';

export interface EnvironmentContextReference {
  id: string;
  containerType: ContainerType;
}

export interface ContextInjectionPayload {
  includeWorkspace?: boolean;
  environmentIds?: string[];
  ticketShas?: string[];
  ticketContexts?: string[];
  knowledgeShas?: string[];
  knowledgeContexts?: string[];
  autoEnrichmentEnabled?: boolean;
  /** Server-enriched; omitted when generic or workspace not included */
  workspaceContainerType?: ContainerType;
  /** Server-enriched; only non-generic environments */
  environmentContainerTypes?: EnvironmentContextReference[];
}
