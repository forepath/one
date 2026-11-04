import type { ChatPlanActivityDto, ChatPlanResponse } from '@forepath/agenstra/frontend/data-access-agent-console';
import type { FpcBadgeTone, FpcTableState } from '@forepath/shared/frontend/ui-components';

import { chatPlanStateLabel } from '../chat/chat-plan-labels';

/** Plan title: the agent's summary, else the original request (same as the chat card). */
export function chatPlanTitle(plan: Pick<ChatPlanResponse, 'summary' | 'sourcePrompt'>): string {
  return plan.summary?.trim() || plan.sourcePrompt;
}

/** Plans still being drafted by the agent: content is locked until the draft is ready. */
export function isChatPlanDrafting(status: string): boolean {
  return status === 'pending' || status === 'exploring' || status === 'refining';
}

/** Executed (or executing) plans are read-only for good. */
export function isChatPlanExecutionLocked(plan: Pick<ChatPlanResponse, 'status' | 'executionStartedAt'>): boolean {
  return !!plan.executionStartedAt || plan.status === 'executing' || plan.status === 'executed';
}

/** Refine (AI) is offered on ready plans, like the chat's plan modal. */
export function isChatPlanRefinable(plan: Pick<ChatPlanResponse, 'status' | 'executionStartedAt'>): boolean {
  return plan.status === 'ready' && !plan.executionStartedAt;
}

function stateTone(status: string, phase: string): FpcBadgeTone {
  if (status === 'ready' && phase === 'draft') {
    return 'info';
  }

  switch (status) {
    case 'ready':
    case 'executed':
      return 'success';
    case 'failed':
    case 'cancelled':
      return 'danger';
    case 'executing':
      return 'warning';
    case 'pending':
    case 'exploring':
    case 'refining':
      return 'primary';
    default:
      return 'neutral';
  }
}

/** State column of the plans table (one consolidated status like the chat card). */
export function chatPlanTableState(plan: Pick<ChatPlanResponse, 'status' | 'phase'>): FpcTableState {
  const tone = stateTone(plan.status, plan.phase);

  return {
    label: chatPlanStateLabel(plan.status, plan.phase),
    tone,
    ...(plan.status === 'executed' ? { icon: 'lock-fill' } : {}),
    ...(tone === 'primary' ? { icon: 'hourglass-split' } : {}),
  };
}

/** Every backend `ChatPlanActionType` has a label; the fallback only covers types added later. */
export function chatPlanActivityLabel(actionType: string): string {
  switch (actionType) {
    case 'CREATED':
      return $localize`:@@featureChatPlans-activityCreated:Created`;
    case 'DRAFT_UPDATED':
      return $localize`:@@featureChatPlans-activityDraftUpdated:Draft by agent`;
    case 'REFINE_REQUESTED':
      return $localize`:@@featureChatPlans-activityRefineRequested:Refinement requested`;
    case 'CONTENT_UPDATED':
      return $localize`:@@featureChatPlans-activityContentUpdated:Edited`;
    case 'EXECUTION_STARTED':
      return $localize`:@@featureChatPlans-activityExecutionStarted:Execution started`;
    case 'EXECUTED':
      return $localize`:@@featureChatPlans-activityExecuted:Executed`;
    case 'FAILED':
      return $localize`:@@featureChatPlans-activityFailed:Failed`;
    case 'CANCELLED':
      return $localize`:@@featureChatPlans-activityCancelled:Cancelled`;
    case 'RETRY_REQUESTED':
      return $localize`:@@featureChatPlans-activityRetryRequested:Retry requested`;
    default:
      return $localize`:@@featureChatPlans-activityUnknown:Unknown activity`;
  }
}

export function chatPlanActivityTone(actionType: string): FpcBadgeTone {
  switch (actionType) {
    case 'CREATED':
    case 'EXECUTED':
      return 'success';
    case 'DRAFT_UPDATED':
    case 'REFINE_REQUESTED':
    case 'RETRY_REQUESTED':
      return 'info';
    case 'CONTENT_UPDATED':
      return 'neutral';
    case 'EXECUTION_STARTED':
      return 'warning';
    case 'FAILED':
    case 'CANCELLED':
      return 'danger';
    default:
      return 'neutral';
  }
}

/** Actor column: the user's e-mail, else who acted (agent / platform). */
export function chatPlanActivityActor(event: Pick<ChatPlanActivityDto, 'actorEmail' | 'actorType'>): string {
  if (event.actorEmail) {
    return event.actorEmail;
  }

  switch (event.actorType) {
    case 'ai':
      return $localize`:@@featureChatPlans-actorAgent:Agent`;
    case 'human':
      return $localize`:@@featureChatPlans-actorUser:User`;
    default:
      return $localize`:@@featureChatPlans-actorSystem:System`;
  }
}

/** Extra detail of an activity row (refine instructions, edited fields, failure message). */
export function chatPlanActivityDetail(event: Pick<ChatPlanActivityDto, 'actionType' | 'payload'>): string {
  const payload = event.payload ?? {};

  if (event.actionType === 'REFINE_REQUESTED' && typeof payload['instructions'] === 'string') {
    return payload['instructions'];
  }

  if (event.actionType === 'CONTENT_UPDATED' && Array.isArray(payload['fields'])) {
    return (payload['fields'] as unknown[])
      .map((field) =>
        field === 'summary'
          ? $localize`:@@featureChatPlans-fieldTitle:Title`
          : field === 'planMarkdown'
            ? $localize`:@@featureChatPlans-fieldPlan:Plan`
            : String(field),
      )
      .join(', ');
  }

  if (event.actionType === 'FAILED' && typeof payload['message'] === 'string') {
    return payload['message'];
  }

  if (event.actionType === 'EXECUTION_STARTED' && payload['editedByUser'] === true) {
    return $localize`:@@featureChatPlans-executedEditedVersion:Edited version`;
  }

  return '';
}
