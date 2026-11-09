import {
  isLockedWorkItemStatus,
  workItemStatusFromTicketStatus,
  type WorkItemReadiness,
  type WorkItemStatus,
} from '@forepath/agenstra/shared/util-initiative-method';

import type {
  InitiativeActivityResponseDto,
  InitiativeArtifactResponseDto,
  InitiativeArtifactVersionResponseDto,
  InitiativeDecisionResponseDto,
  InitiativeFindingResponseDto,
  InitiativeProposalResponseDto,
  InitiativeResponseDto,
  InitiativeRunResponseDto,
  InitiativeRunTurnResponseDto,
  InitiativeUnknownResponseDto,
  InitiativeWorkItemResponseDto,
} from '../dto/initiatives/initiative-response.dto';
import type { InitiativeActivityEntity } from '../entities/initiative-activity.entity';
import type { InitiativeArtifactVersionEntity } from '../entities/initiative-artifact-version.entity';
import type { InitiativeArtifactEntity } from '../entities/initiative-artifact.entity';
import type { InitiativeChangeProposalEntity } from '../entities/initiative-change-proposal.entity';
import type { InitiativeDecisionEntity } from '../entities/initiative-decision.entity';
import type { InitiativeFindingEntity } from '../entities/initiative-finding.entity';
import type { InitiativeRunTurnEntity } from '../entities/initiative-run-turn.entity';
import type { InitiativeRunEntity } from '../entities/initiative-run.entity';
import type { InitiativeUnknownEntity } from '../entities/initiative-unknown.entity';
import type { InitiativeWorkItemEntity } from '../entities/initiative-work-item.entity';
import type { InitiativeEntity } from '../entities/initiative.entity';
import type { TicketStatus } from '../entities/ticket.enums';

const iso = (value: Date | null | undefined): string | null => (value ? new Date(value).toISOString() : null);

function shas(longSha: string | null | undefined) {
  const long = longSha ?? '';

  return { short: long.slice(0, 8), long };
}

export function initiativeEntityToDto(row: InitiativeEntity): InitiativeResponseDto {
  return {
    id: row.id,
    clientId: row.clientId,
    title: row.title,
    intent: row.intent ?? '',
    path: row.path,
    phase: row.phase,
    state: row.state,
    iteration: row.iteration,
    defaultAgentId: row.defaultAgentId ?? null,
    defaultModel: row.defaultModel ?? null,
    prerequisiteSatisfiedAt: row.prerequisiteSatisfiedAt,
    autoRelease: row.autoRelease,
    version: row.version,
    shas: shas(row.longSha),
    createdByUserId: row.createdByUserId ?? null,
    createdAt: iso(row.createdAt) as string,
    updatedAt: iso(row.updatedAt) as string,
  };
}

export function initiativeArtifactEntityToDto(
  row: InitiativeArtifactEntity,
  withContent = false,
): InitiativeArtifactResponseDto {
  return {
    id: row.id,
    initiativeId: row.initiativeId,
    type: row.type,
    workItemId: row.workItemId ?? null,
    title: row.title,
    status: initiativeArtifactStatus(row),
    currentVersion: row.currentVersion,
    acceptedVersion: row.acceptedVersion ?? null,
    acceptedAt: iso(row.acceptedAt),
    acceptedByUserId: row.acceptedByUserId ?? null,
    publishedNodeId: row.publishedNodeId ?? null,
    version: row.version,
    size: (row.content ?? '').length,
    shas: shas(row.longSha),
    createdAt: iso(row.createdAt) as string,
    updatedAt: iso(row.updatedAt) as string,
    ...(withContent ? { content: row.content ?? '' } : {}),
  };
}

export function initiativeArtifactVersionToDto(
  row: InitiativeArtifactVersionEntity,
  acceptedVersion: number | null | undefined,
  withContent = false,
): InitiativeArtifactVersionResponseDto {
  return {
    id: row.id,
    version: row.version,
    iteration: row.iteration,
    source: row.source,
    runId: row.runId ?? null,
    proposalId: row.proposalId ?? null,
    createdByUserId: row.createdByUserId ?? null,
    agentId: row.agentId ?? null,
    createdAt: iso(row.createdAt) as string,
    accepted: acceptedVersion === row.version,
    ...(withContent ? { content: row.content } : {}),
  };
}

export function initiativeUnknownToDto(row: InitiativeUnknownEntity): InitiativeUnknownResponseDto {
  return {
    id: row.id,
    workItemId: row.workItemId ?? null,
    question: row.question,
    resolution: row.resolution,
    answer: row.answer ?? null,
    resolvedAt: iso(row.resolvedAt),
    resolvedByUserId: row.resolvedByUserId ?? null,
    createdAt: iso(row.createdAt) as string,
  };
}

/** A document is accepted while its current version is the accepted one; any newer version is a draft again. */
export function initiativeArtifactStatus(
  row: Pick<InitiativeArtifactEntity, 'acceptedVersion' | 'currentVersion'>,
): 'accepted' | 'draft' {
  return row.acceptedVersion !== null && row.acceptedVersion !== undefined && row.acceptedVersion === row.currentVersion
    ? 'accepted'
    : 'draft';
}

/** Effective status: the linked ticket decides once transferred (ticket of another workspace: not linked). */
export function effectiveWorkItemStatus(
  row: Pick<InitiativeWorkItemEntity, 'status' | 'ticketId'>,
  ticketStatus: TicketStatus | null | undefined,
): WorkItemStatus {
  if (row.ticketId && ticketStatus) {
    return workItemStatusFromTicketStatus(ticketStatus);
  }

  return row.status;
}

export function initiativeWorkItemToDto(
  row: InitiativeWorkItemEntity,
  context: {
    ticketStatus: TicketStatus | null;
    prerequisiteIds: string[];
    readiness: WorkItemReadiness | undefined;
    unknowns: InitiativeUnknownEntity[];
  },
): InitiativeWorkItemResponseDto {
  const status = effectiveWorkItemStatus(row, context.ticketStatus);

  return {
    id: row.id,
    initiativeId: row.initiativeId,
    parentId: row.parentId ?? null,
    kind: row.kind,
    key: row.key,
    title: row.title,
    requirements: row.requirements ?? '',
    verify: row.verify ?? '',
    doneWhen: row.doneWhen ?? '',
    refined: row.refined,
    planCheckpoint: row.planCheckpoint,
    doneCheckpoint: row.doneCheckpoint,
    priority: row.priority,
    sortOrder: row.sortOrder,
    status,
    locked: isLockedWorkItemStatus(status),
    ticketId: context.ticketStatus ? (row.ticketId ?? null) : null,
    ticketStatus: context.ticketStatus,
    prerequisiteIds: context.prerequisiteIds,
    ready: context.readiness?.ready ?? true,
    blockedBy: context.readiness?.blockedBy ?? [],
    retrospectiveVerdict: row.retrospectiveVerdict ?? null,
    retrospectiveOverridden: row.retrospectiveOverridden,
    iterationCreated: row.iterationCreated,
    version: row.version,
    unknowns: context.unknowns.map(initiativeUnknownToDto),
    createdAt: iso(row.createdAt) as string,
    updatedAt: iso(row.updatedAt) as string,
  };
}

export function initiativeRunTurnToDto(row: InitiativeRunTurnEntity): InitiativeRunTurnResponseDto {
  return {
    id: row.id,
    runId: row.runId,
    seq: row.seq,
    role: row.role,
    content: row.content,
    actorUserId: row.actorUserId ?? null,
    createdAt: iso(row.createdAt) as string,
  };
}

export function initiativeRunToDto(
  row: InitiativeRunEntity,
  turns?: InitiativeRunTurnEntity[],
): InitiativeRunResponseDto {
  return {
    id: row.id,
    initiativeId: row.initiativeId,
    step: row.step,
    mode: row.mode,
    style: row.style,
    targetWorkItemId: row.targetWorkItemId ?? null,
    targetArtifactId: row.targetArtifactId ?? null,
    agentId: row.agentId,
    model: row.model ?? null,
    status: row.status,
    result: row.result ?? null,
    streamingText: row.streamingText ?? null,
    failureCode: row.failureCode ?? null,
    failureMessage: row.failureMessage ?? null,
    createdByUserId: row.createdByUserId ?? null,
    decidedByUserId: row.decidedByUserId ?? null,
    finishedAt: iso(row.finishedAt),
    version: row.version,
    createdAt: iso(row.createdAt) as string,
    updatedAt: iso(row.updatedAt) as string,
    ...(turns ? { turns: turns.map(initiativeRunTurnToDto) } : {}),
  };
}

export function initiativeProposalToDto(row: InitiativeChangeProposalEntity): InitiativeProposalResponseDto {
  return {
    id: row.id,
    initiativeId: row.initiativeId,
    origin: row.origin,
    title: row.title,
    rationale: row.rationale ?? '',
    changes: row.changes,
    baseVersions: row.baseVersions ?? {},
    status: row.status,
    bumpsIteration: row.bumpsIteration,
    runId: row.runId ?? null,
    agentId: row.agentId ?? null,
    createdByUserId: row.createdByUserId ?? null,
    decidedByUserId: row.decidedByUserId ?? null,
    decidedAt: iso(row.decidedAt),
    decisionNote: row.decisionNote ?? null,
    createdAt: iso(row.createdAt) as string,
    updatedAt: iso(row.updatedAt) as string,
  };
}

export function initiativeFindingToDto(row: InitiativeFindingEntity): InitiativeFindingResponseDto {
  return {
    id: row.id,
    initiativeId: row.initiativeId,
    workItemId: row.workItemId ?? null,
    source: row.source,
    severity: row.severity,
    body: row.body,
    evidence: row.evidence ?? [],
    status: row.status,
    proposalId: row.proposalId ?? null,
    runId: row.runId ?? null,
    agentId: row.agentId ?? null,
    createdByUserId: row.createdByUserId ?? null,
    resolvedByUserId: row.resolvedByUserId ?? null,
    createdAt: iso(row.createdAt) as string,
    updatedAt: iso(row.updatedAt) as string,
  };
}

export function initiativeDecisionToDto(row: InitiativeDecisionEntity): InitiativeDecisionResponseDto {
  return {
    id: row.id,
    initiativeId: row.initiativeId,
    workItemId: row.workItemId ?? null,
    title: row.title,
    body: row.body ?? '',
    status: row.status,
    iteration: row.iteration,
    proposalId: row.proposalId ?? null,
    runId: row.runId ?? null,
    agentId: row.agentId ?? null,
    createdByUserId: row.createdByUserId ?? null,
    decidedByUserId: row.decidedByUserId ?? null,
    decidedAt: iso(row.decidedAt),
    createdAt: iso(row.createdAt) as string,
  };
}

export function initiativeActivityToDto(
  row: InitiativeActivityEntity,
  actorEmail?: string | null,
): InitiativeActivityResponseDto {
  return {
    id: row.id,
    initiativeId: row.initiativeId,
    occurredAt: iso(row.occurredAt) as string,
    actorType: row.actorType,
    actorUserId: row.actorUserId ?? null,
    actorEmail: actorEmail ?? null,
    agentId: row.agentId ?? null,
    actionType: row.actionType,
    payload: row.payload ?? {},
  };
}
