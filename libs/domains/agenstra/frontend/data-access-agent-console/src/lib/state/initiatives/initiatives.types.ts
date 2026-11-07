import type {
  FindingSeverity,
  FindingSource,
  FindingStatus,
  InitiativeArtifactStatus,
  InitiativeArtifactType,
  InitiativePath,
  InitiativePhase,
  InitiativePrerequisiteSatisfiedAt,
  InitiativeRunMode,
  InitiativeRunStatus,
  InitiativeRunStyle,
  InitiativeState,
  InitiativeStepKey,
  InitiativeTurnProposal,
  InitiativeTurnStatus,
  NextAction,
  ProposalOrigin,
  ProposalStatus,
  RetrospectiveVerdict,
  StepAvailability,
  UnknownResolution,
  WorkItemKind,
  WorkItemStatus,
} from '@forepath/agenstra/shared/util-initiative-method';

/** Mirrors the agent-controller initiative DTOs (`/initiatives`, `/initiative-*`). */
export interface InitiativeShas {
  short: string;
  long: string;
}

export interface InitiativeDto {
  id: string;
  clientId: string;
  title: string;
  intent: string;
  path: InitiativePath;
  phase: InitiativePhase;
  state: InitiativeState;
  iteration: number;
  defaultAgentId: string | null;
  defaultModel: string | null;
  prerequisiteSatisfiedAt: InitiativePrerequisiteSatisfiedAt;
  autoRelease: boolean;
  version: number;
  shas: InitiativeShas;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InitiativeListResponseDto {
  items: InitiativeDto[];
  total: number;
}

export interface InitiativeArtifactDto {
  id: string;
  initiativeId: string;
  type: InitiativeArtifactType;
  workItemId: string | null;
  title: string;
  status: InitiativeArtifactStatus;
  currentVersion: number;
  acceptedVersion: number | null;
  acceptedAt: string | null;
  acceptedByUserId: string | null;
  publishedNodeId: string | null;
  version: number;
  size: number;
  shas: InitiativeShas;
  createdAt: string;
  updatedAt: string;
  content?: string;
}

export interface InitiativeArtifactVersionDto {
  id: string;
  version: number;
  iteration: number;
  source: 'human' | 'run' | 'proposal';
  runId: string | null;
  proposalId: string | null;
  createdByUserId: string | null;
  agentId: string | null;
  createdAt: string;
  accepted: boolean;
  content?: string;
}

export interface InitiativeUnknownDto {
  id: string;
  workItemId: string | null;
  question: string;
  resolution: UnknownResolution;
  answer: string | null;
  resolvedAt: string | null;
  resolvedByUserId: string | null;
  createdAt: string;
}

export interface InitiativeWorkItemDto {
  id: string;
  initiativeId: string;
  parentId: string | null;
  kind: WorkItemKind;
  key: string;
  title: string;
  requirements: string;
  verify: string;
  doneWhen: string;
  refined: boolean;
  planCheckpoint: boolean;
  doneCheckpoint: boolean;
  priority: 'low' | 'medium' | 'high' | 'critical';
  sortOrder: number;
  status: WorkItemStatus;
  locked: boolean;
  ticketId: string | null;
  ticketStatus: string | null;
  prerequisiteIds: string[];
  ready: boolean;
  blockedBy: string[];
  retrospectiveVerdict: RetrospectiveVerdict | null;
  retrospectiveOverridden: boolean;
  iterationCreated: number;
  version: number;
  unknowns: InitiativeUnknownDto[];
  createdAt: string;
  updatedAt: string;
}

export interface InitiativeWorkItemsDto {
  initiativeId: string;
  items: InitiativeWorkItemDto[];
  initiativeVersion: number;
  unknowns: InitiativeUnknownDto[];
}

export interface InitiativeRunTurnDto {
  id: string;
  runId: string;
  seq: number;
  role: 'user' | 'agent' | 'system';
  content: string;
  actorUserId: string | null;
  createdAt: string;
}

export interface InitiativeRunDto {
  id: string;
  initiativeId: string;
  step: InitiativeStepKey;
  mode: InitiativeRunMode;
  style: InitiativeRunStyle;
  targetWorkItemId: string | null;
  targetArtifactId: string | null;
  agentId: string;
  model: string | null;
  status: InitiativeRunStatus;
  result: InitiativeTurnStatus | null;
  streamingText: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  createdByUserId: string | null;
  decidedByUserId: string | null;
  finishedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  turns?: InitiativeRunTurnDto[];
}

export interface InitiativeProposalDto {
  id: string;
  initiativeId: string;
  origin: ProposalOrigin;
  title: string;
  rationale: string;
  changes: InitiativeTurnProposal;
  baseVersions: Record<string, number>;
  status: ProposalStatus;
  bumpsIteration: boolean;
  runId: string | null;
  agentId: string | null;
  createdByUserId: string | null;
  decidedByUserId: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InitiativeFindingDto {
  id: string;
  initiativeId: string;
  workItemId: string | null;
  source: FindingSource;
  severity: FindingSeverity;
  body: string;
  evidence: string[];
  status: FindingStatus;
  proposalId: string | null;
  runId: string | null;
  agentId: string | null;
  createdByUserId: string | null;
  resolvedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InitiativeDecisionDto {
  id: string;
  initiativeId: string;
  workItemId: string | null;
  title: string;
  body: string;
  status: 'proposed' | 'accepted' | 'rejected';
  iteration: number;
  proposalId: string | null;
  runId: string | null;
  agentId: string | null;
  createdByUserId: string | null;
  decidedByUserId: string | null;
  decidedAt: string | null;
  createdAt: string;
}

export interface InitiativeActivityDto {
  id: string;
  initiativeId: string;
  occurredAt: string;
  actorType: 'human' | 'ai' | 'system';
  actorUserId: string | null;
  actorEmail: string | null;
  agentId: string | null;
  actionType: string;
  payload: Record<string, unknown>;
}

export interface InitiativeOverviewDto {
  initiative: InitiativeDto;
  nextActions: NextAction[];
  steps: Array<StepAvailability & { step: InitiativeStepKey }>;
  counts: {
    artifacts: number;
    acceptedArtifacts: number;
    epics: number;
    items: number;
    itemsByStatus: Partial<Record<WorkItemStatus, number>>;
    openFindings: number;
    openProposals: number;
    proposedDecisions: number;
    openUnknowns: number;
    activeRuns: number;
  };
}

export interface TicketInitiativeLinkDto {
  link: {
    initiativeId: string;
    initiativeTitle: string;
    workItemId: string;
    key: string;
    status: WorkItemStatus;
    ready: boolean;
    blockedBy: string[];
    automationBlocked: boolean;
  } | null;
}

export interface InitiativeBuildActionDto {
  workItems: InitiativeWorkItemDto[];
  ticketIds: string[];
  skipped: Array<{ workItemId: string; reason: string }>;
  planId?: string;
}

/**
 * Every command of the page (serializable; one effect maps it to the REST call). Results update the state; refusals
 * of conditional writes (409) set `conflict`.
 */
export type InitiativeCommand =
  | { type: 'createInitiative'; dto: { clientId: string; title: string; intent?: string; path: InitiativePath } }
  | { type: 'updateInitiative'; id: string; dto: Record<string, unknown> & { expectedVersion: number } }
  | { type: 'deleteInitiative'; id: string }
  | { type: 'startIteration'; id: string; expectedVersion: number }
  | {
      type: 'createArtifact';
      initiativeId: string;
      dto: { type: InitiativeArtifactType; title?: string; workItemId?: string; content?: string };
    }
  | { type: 'updateArtifact'; artifactId: string; dto: { expectedVersion: number; title?: string; content?: string } }
  | { type: 'acceptArtifact'; artifactId: string; expectedVersion: number }
  | { type: 'deleteArtifact'; artifactId: string; initiativeId: string }
  | { type: 'publishArtifact'; artifactId: string; parentNodeId?: string }
  | {
      type: 'createWorkItem';
      initiativeId: string;
      dto: {
        kind: WorkItemKind;
        parentId?: string;
        title: string;
        requirements?: string;
        verify?: string;
        doneWhen?: string;
      };
    }
  | { type: 'updateWorkItem'; itemId: string; dto: Record<string, unknown> & { expectedVersion: number } }
  | { type: 'deleteWorkItem'; itemId: string }
  | { type: 'reorderWorkItem'; itemId: string; expectedInitiativeVersion: number; beforeId?: string }
  | { type: 'setDependencies'; itemId: string; expectedInitiativeVersion: number; prerequisiteIds: string[] }
  | { type: 'setWorkItemStatus'; itemId: string; status: 'done' | 'dropped' | 'blocked' | 'draft' }
  | { type: 'overrideRetrospective'; itemId: string; verdict: RetrospectiveVerdict }
  | {
      type: 'createUnknown';
      initiativeId: string;
      dto: { workItemId?: string; question: string; resolution: UnknownResolution };
    }
  | { type: 'resolveUnknown'; unknownId: string; initiativeId: string; answer: string }
  | { type: 'deleteUnknown'; unknownId: string; initiativeId: string }
  | {
      type: 'transfer';
      initiativeId: string;
      dto: {
        epicIds?: string[];
        automation?: { eligible: boolean; preferredModel?: string; allowedAgentIds?: string[] };
      };
    }
  | { type: 'release'; initiativeId: string; workItemIds?: string[] }
  | {
      type: 'planStory';
      itemId: string;
      dto: { agentId: string; chatId: string; model?: string; instructions?: string };
    }
  | {
      type: 'startRun';
      initiativeId: string;
      dto: {
        step: InitiativeStepKey;
        mode?: InitiativeRunMode;
        style?: InitiativeRunStyle;
        agentId?: string;
        model?: string;
        workItemId?: string;
        message?: string;
        findingIds?: string[];
      };
    }
  | { type: 'messageRun'; runId: string; message: string }
  | { type: 'acceptRun'; runId: string; expectedVersion: number }
  | { type: 'discardRun'; runId: string; expectedVersion: number }
  | { type: 'cancelRun'; runId: string; expectedVersion: number }
  | { type: 'retryRun'; runId: string }
  | {
      type: 'createFinding';
      initiativeId: string;
      dto: { workItemId?: string; severity: FindingSeverity; body: string; evidence?: string[] };
    }
  | { type: 'updateFinding'; findingId: string; status: 'open' | 'dismissed' }
  | { type: 'convertFinding'; findingId: string; epicId: string; title?: string }
  | {
      type: 'createProposal';
      initiativeId: string;
      dto: { title: string; rationale?: string; changes: Record<string, unknown>; bumpsIteration?: boolean };
    }
  | { type: 'acceptProposal'; proposalId: string; note?: string; closeDroppedTickets?: boolean }
  | { type: 'rejectProposal'; proposalId: string; note?: string }
  | { type: 'createDecision'; initiativeId: string; dto: { workItemId?: string; title: string; body?: string } }
  | { type: 'decideDecision'; decisionId: string; status: 'accepted' | 'rejected' };

export type InitiativeCommandResult =
  | { kind: 'initiative'; initiative: InitiativeDto }
  | { kind: 'initiativeRemoved'; id: string }
  | { kind: 'artifact'; artifact: InitiativeArtifactDto }
  | { kind: 'artifactRemoved'; id: string; initiativeId: string }
  | { kind: 'workItems'; initiativeId: string; workItems: InitiativeWorkItemsDto }
  | { kind: 'build'; initiativeId: string; result: InitiativeBuildActionDto }
  | { kind: 'run'; run: InitiativeRunDto }
  | { kind: 'proposal'; proposal: InitiativeProposalDto }
  | { kind: 'finding'; finding: InitiativeFindingDto }
  | { kind: 'decision'; decision: InitiativeDecisionDto }
  | { kind: 'unknown'; initiativeId: string }
  | { kind: 'none' };
