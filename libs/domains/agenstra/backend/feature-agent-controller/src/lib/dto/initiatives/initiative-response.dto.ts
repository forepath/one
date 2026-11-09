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

import type { InitiativeArtifactVersionSource } from '../../entities/initiative-artifact-version.entity';
import type { InitiativeRunTurnRole } from '../../entities/initiative-run-turn.entity';
import type {
  InitiativeActionType,
  InitiativeActorType,
  InitiativeDecisionStatus,
} from '../../entities/initiative.enums';
import type { TicketPriority, TicketStatus } from '../../entities/ticket.enums';

export interface InitiativeShasDto {
  short: string;
  long: string;
}

export interface InitiativeResponseDto {
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
  shas: InitiativeShasDto;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InitiativeListResponseDto {
  items: InitiativeResponseDto[];
  total: number;
}

export interface InitiativeArtifactResponseDto {
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
  shas: InitiativeShasDto;
  createdAt: string;
  updatedAt: string;
  /** Only on single-document reads. */
  content?: string;
}

export interface InitiativeArtifactVersionResponseDto {
  id: string;
  version: number;
  iteration: number;
  source: InitiativeArtifactVersionSource;
  runId: string | null;
  proposalId: string | null;
  createdByUserId: string | null;
  agentId: string | null;
  createdAt: string;
  accepted: boolean;
  /** Only on single-version reads. */
  content?: string;
}

export interface InitiativeUnknownResponseDto {
  id: string;
  workItemId: string | null;
  question: string;
  resolution: UnknownResolution;
  answer: string | null;
  resolvedAt: string | null;
  resolvedByUserId: string | null;
  createdAt: string;
}

export interface InitiativeWorkItemResponseDto {
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
  priority: TicketPriority;
  sortOrder: number;
  /** Effective status (from the linked ticket once transferred). */
  status: WorkItemStatus;
  locked: boolean;
  ticketId: string | null;
  ticketStatus: TicketStatus | null;
  prerequisiteIds: string[];
  ready: boolean;
  blockedBy: string[];
  retrospectiveVerdict: RetrospectiveVerdict | null;
  retrospectiveOverridden: boolean;
  iterationCreated: number;
  version: number;
  unknowns: InitiativeUnknownResponseDto[];
  createdAt: string;
  updatedAt: string;
}

export interface InitiativeWorkItemsResponseDto {
  /** Initiative the tree belongs to (also set when the tree is empty). */
  initiativeId: string;
  items: InitiativeWorkItemResponseDto[];
  /** Initiative version (reorder / dependency edits are conditional on it). */
  initiativeVersion: number;
  /** Open initiative-level unknowns. */
  unknowns: InitiativeUnknownResponseDto[];
}

export interface InitiativeRunTurnResponseDto {
  id: string;
  runId: string;
  seq: number;
  role: InitiativeRunTurnRole;
  content: string;
  actorUserId: string | null;
  createdAt: string;
}

export interface InitiativeRunResponseDto {
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
  turns?: InitiativeRunTurnResponseDto[];
}

export interface InitiativeProposalResponseDto {
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

export interface InitiativeFindingResponseDto {
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

export interface InitiativeDecisionResponseDto {
  id: string;
  initiativeId: string;
  workItemId: string | null;
  title: string;
  body: string;
  status: InitiativeDecisionStatus;
  iteration: number;
  proposalId: string | null;
  runId: string | null;
  agentId: string | null;
  createdByUserId: string | null;
  decidedByUserId: string | null;
  decidedAt: string | null;
  createdAt: string;
}

export interface InitiativeActivityResponseDto {
  id: string;
  initiativeId: string;
  occurredAt: string;
  actorType: InitiativeActorType;
  actorUserId: string | null;
  actorEmail: string | null;
  agentId: string | null;
  actionType: InitiativeActionType;
  payload: Record<string, unknown>;
}

export interface InitiativeStepAvailabilityDto extends StepAvailability {
  step: InitiativeStepKey;
}

export interface InitiativeOverviewResponseDto {
  initiative: InitiativeResponseDto;
  nextActions: NextAction[];
  /** Availability of the initiative-wide steps (epic steps depend on the chosen epic). */
  steps: InitiativeStepAvailabilityDto[];
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

/** Initiative story a ticket was transferred from (ticket board chip; `null` when not linked). */
export interface TicketInitiativeLinkDto {
  link: {
    initiativeId: string;
    initiativeTitle: string;
    workItemId: string;
    key: string;
    status: string;
    ready: boolean;
    blockedBy: string[];
    /** Ticket automation skips the ticket until its prerequisites are satisfied. */
    automationBlocked: boolean;
  } | null;
}

/** Result of a transfer / release / plan action. */
export interface InitiativeBuildActionResponseDto {
  workItems: InitiativeWorkItemResponseDto[];
  /** Tickets created or changed by the action. */
  ticketIds: string[];
  skipped: Array<{ workItemId: string; reason: string }>;
  planId?: string;
}
