import type { FpcBadgeTone } from '@forepath/shared/frontend/ui-components';
import type {
  FindingSeverity,
  FindingSource,
  FindingStatus,
  InitiativeArtifactStatus,
  InitiativeArtifactType,
  InitiativePath,
  InitiativePhase,
  InitiativeRole,
  InitiativeRunMode,
  InitiativeRunStatus,
  InitiativeRunStyle,
  InitiativeState,
  InitiativeStepKey,
  InitiativeStepNeed,
  ProposalOrigin,
  ProposalStatus,
  RetrospectiveVerdict,
  UnknownResolution,
  WorkItemKind,
  WorkItemStatus,
} from '@forepath/agenstra/shared/util-initiative-method';

/** Badge colors of the shared UI components. */
export type InitiativeTone = 'primary' | 'secondary' | 'success' | 'danger' | 'warning' | 'info' | 'light' | 'dark';

export function initiativePhaseLabel(phase: InitiativePhase): string {
  switch (phase) {
    case 'clarify':
      return $localize`:@@featureInitiatives-phaseClarify:Clarify`;
    case 'plan':
      return $localize`:@@featureInitiatives-phasePlan:Plan`;
    case 'build':
      return $localize`:@@featureInitiatives-phaseBuild:Build & verify`;
    case 'learn':
      return $localize`:@@featureInitiatives-phaseLearn:Learn & adjust`;
  }
}

export function initiativePathLabel(path: InitiativePath): string {
  switch (path) {
    case 'session':
      return $localize`:@@featureInitiatives-pathSession:One session`;
    case 'epic':
      return $localize`:@@featureInitiatives-pathEpic:Epic`;
    case 'project':
      return $localize`:@@featureInitiatives-pathProject:Project`;
  }
}

export function initiativePathHint(path: InitiativePath): string {
  switch (path) {
    case 'session':
      return $localize`:@@featureInitiatives-pathSessionHint:One coherent change: one epic with a few stories.`;
    case 'epic':
      return $localize`:@@featureInitiatives-pathEpicHint:One outcome that needs several build sessions.`;
    case 'project':
      return $localize`:@@featureInitiatives-pathProjectHint:Several epics with shared contracts (PRD, UX, architecture).`;
  }
}

export function initiativeStateLabel(state: InitiativeState): string {
  switch (state) {
    case 'active':
      return $localize`:@@featureInitiatives-stateActive:Active`;
    case 'paused':
      return $localize`:@@featureInitiatives-statePaused:Paused`;
    case 'completed':
      return $localize`:@@featureInitiatives-stateCompleted:Completed`;
    case 'archived':
      return $localize`:@@featureInitiatives-stateArchived:Archived`;
  }
}

export function initiativeStateTone(state: InitiativeState): InitiativeTone {
  return state === 'active' ? 'primary' : state === 'completed' ? 'success' : 'secondary';
}

/** Tone of the state column in data tables. */
export function initiativeStateTableTone(state: InitiativeState): 'primary' | 'success' | 'neutral' {
  return state === 'active' ? 'primary' : state === 'completed' ? 'success' : 'neutral';
}

export function initiativeRoleLabel(role: InitiativeRole): string {
  switch (role) {
    case 'analyst':
      return $localize`:@@featureInitiatives-roleAnalyst:Analyst`;
    case 'product_manager':
      return $localize`:@@featureInitiatives-roleProductManager:Product Manager`;
    case 'ux_designer':
      return $localize`:@@featureInitiatives-roleUxDesigner:UX Designer`;
    case 'architect':
      return $localize`:@@featureInitiatives-roleArchitect:Architect`;
    case 'product_owner':
      return $localize`:@@featureInitiatives-roleProductOwner:Product Owner`;
    case 'developer':
      return $localize`:@@featureInitiatives-roleDeveloper:Developer`;
  }
}

export function initiativeStepLabel(step: InitiativeStepKey): string {
  switch (step) {
    case 'brainstorm':
      return $localize`:@@featureInitiatives-stepBrainstorm:Brainstorm`;
    case 'forge-idea':
      return $localize`:@@featureInitiatives-stepForgeIdea:Forge the idea`;
    case 'research':
      return $localize`:@@featureInitiatives-stepResearch:Research a decision`;
    case 'product-brief':
      return $localize`:@@featureInitiatives-stepProductBrief:Product brief`;
    case 'prfaq':
      return $localize`:@@featureInitiatives-stepPrfaq:PRFAQ`;
    case 'prd':
      return $localize`:@@featureInitiatives-stepPrd:PRD`;
    case 'ux':
      return $localize`:@@featureInitiatives-stepUx:UX design`;
    case 'architecture':
      return $localize`:@@featureInitiatives-stepArchitecture:Architecture`;
    case 'project-context':
      return $localize`:@@featureInitiatives-stepProjectContext:Project context`;
    case 'slice-epics':
      return $localize`:@@featureInitiatives-stepSliceEpics:Slice into epics`;
    case 'refine-epic':
      return $localize`:@@featureInitiatives-stepRefineEpic:Refine epic`;
    case 'incept-stories':
      return $localize`:@@featureInitiatives-stepInceptStories:Incept stories`;
    case 'readiness-review':
      return $localize`:@@featureInitiatives-stepReadinessReview:Readiness review`;
    case 'retrospective':
      return $localize`:@@featureInitiatives-stepRetrospective:Epic retrospective`;
    case 'correct-course':
      return $localize`:@@featureInitiatives-stepCorrectCourse:Correct course`;
  }
}

export function initiativeArtifactTypeLabel(type: InitiativeArtifactType): string {
  switch (type) {
    case 'brainstorm':
      return $localize`:@@featureInitiatives-artifactBrainstorm:Brainstorm`;
    case 'forge-report':
      return $localize`:@@featureInitiatives-artifactForgeReport:Forge report`;
    case 'research':
      return $localize`:@@featureInitiatives-artifactResearch:Research`;
    case 'product-brief':
      return $localize`:@@featureInitiatives-artifactProductBrief:Product brief`;
    case 'prfaq':
      return $localize`:@@featureInitiatives-artifactPrfaq:PRFAQ`;
    case 'prd':
      return $localize`:@@featureInitiatives-artifactPrd:PRD`;
    case 'ux':
      return $localize`:@@featureInitiatives-artifactUx:UX design`;
    case 'architecture':
      return $localize`:@@featureInitiatives-artifactArchitecture:Architecture`;
    case 'project-context':
      return $localize`:@@featureInitiatives-artifactProjectContext:Project context`;
    case 'retrospective':
      return $localize`:@@featureInitiatives-artifactRetrospective:Retrospective`;
    case 'note':
      return $localize`:@@featureInitiatives-artifactNote:Note`;
  }
}

export function workItemKindLabel(kind: WorkItemKind): string {
  switch (kind) {
    case 'epic':
      return $localize`:@@featureInitiatives-kindEpic:Epic`;
    case 'story':
      return $localize`:@@featureInitiatives-kindStory:Story`;
    case 'spike':
      return $localize`:@@featureInitiatives-kindSpike:Spike`;
    case 'bug':
      return $localize`:@@featureInitiatives-kindBug:Bug`;
  }
}

export function workItemStatusLabel(status: WorkItemStatus): string {
  switch (status) {
    case 'draft':
      return $localize`:@@featureInitiatives-itemDraft:Draft`;
    case 'ready-for-dev':
      return $localize`:@@featureInitiatives-itemReady:Ready for dev`;
    case 'in-progress':
      return $localize`:@@featureInitiatives-itemInProgress:In progress`;
    case 'built':
      return $localize`:@@featureInitiatives-itemBuilt:Built`;
    case 'done':
      return $localize`:@@featureInitiatives-itemDone:Done`;
    case 'blocked':
      return $localize`:@@featureInitiatives-itemBlocked:Blocked`;
    case 'dropped':
      return $localize`:@@featureInitiatives-itemDropped:Dropped`;
  }
}

export function workItemStatusTone(status: WorkItemStatus): InitiativeTone {
  switch (status) {
    case 'done':
      return 'success';
    case 'built':
      return 'info';
    case 'in-progress':
    case 'ready-for-dev':
      return 'primary';
    case 'blocked':
      return 'warning';
    case 'dropped':
      return 'secondary';
    default:
      return 'light';
  }
}

export function runStatusLabel(status: InitiativeRunStatus): string {
  switch (status) {
    case 'pending':
      return $localize`:@@featureInitiatives-runPending:Starting`;
    case 'working':
      return $localize`:@@featureInitiatives-runWorking:Agent working`;
    case 'needs_input':
      return $localize`:@@featureInitiatives-runNeedsInput:Needs your input`;
    case 'ready':
      return $localize`:@@featureInitiatives-runReady:Ready to review`;
    case 'accepted':
      return $localize`:@@featureInitiatives-runAccepted:Accepted`;
    case 'discarded':
      return $localize`:@@featureInitiatives-runDiscarded:Discarded`;
    case 'failed':
      return $localize`:@@featureInitiatives-runFailed:Failed`;
    case 'cancelled':
      return $localize`:@@featureInitiatives-runCancelled:Cancelled`;
  }
}

export function runStatusTone(status: InitiativeRunStatus): InitiativeTone {
  switch (status) {
    case 'working':
    case 'pending':
      return 'info';
    case 'needs_input':
      return 'warning';
    case 'ready':
      return 'primary';
    case 'accepted':
      return 'success';
    case 'failed':
      return 'danger';
    default:
      return 'secondary';
  }
}

export function findingSeverityTone(severity: FindingSeverity): InitiativeTone {
  switch (severity) {
    case 'critical':
      return 'danger';
    case 'major':
      return 'warning';
    case 'minor':
      return 'info';
    default:
      return 'secondary';
  }
}

export function findingSeverityLabel(severity: FindingSeverity): string {
  switch (severity) {
    case 'critical':
      return $localize`:@@featureInitiatives-severityCritical:Critical`;
    case 'major':
      return $localize`:@@featureInitiatives-severityMajor:Major`;
    case 'minor':
      return $localize`:@@featureInitiatives-severityMinor:Minor`;
    case 'info':
      return $localize`:@@featureInitiatives-severityInfo:Info`;
  }
}

export function proposalStatusLabel(status: ProposalStatus): string {
  switch (status) {
    case 'open':
      return $localize`:@@featureInitiatives-proposalOpen:Open`;
    case 'accepted':
      return $localize`:@@featureInitiatives-proposalAccepted:Accepted`;
    case 'rejected':
      return $localize`:@@featureInitiatives-proposalRejected:Rejected`;
    case 'stale':
      return $localize`:@@featureInitiatives-proposalStale:Stale`;
  }
}

export function proposalStatusTone(status: ProposalStatus): InitiativeTone {
  return status === 'accepted'
    ? 'success'
    : status === 'open'
      ? 'primary'
      : status === 'stale'
        ? 'warning'
        : 'secondary';
}

export function verdictLabel(verdict: RetrospectiveVerdict): string {
  switch (verdict) {
    case 'accepted':
      return $localize`:@@featureInitiatives-verdictAccepted:Accepted`;
    case 'accepted-with-open-items':
      return $localize`:@@featureInitiatives-verdictOpenItems:Accepted with open items`;
    case 'rejected':
      return $localize`:@@featureInitiatives-verdictRejected:Rejected`;
  }
}

export function verdictTone(verdict: RetrospectiveVerdict): InitiativeTone {
  return verdict === 'accepted' ? 'success' : verdict === 'rejected' ? 'danger' : 'warning';
}

/** Human-readable activity line (action + the most useful payload field). */
export function initiativeActivityLabel(actionType: string): string {
  const labels: Record<string, string> = {
    CREATED: $localize`:@@featureInitiatives-actCreated:Created`,
    UPDATED: $localize`:@@featureInitiatives-actUpdated:Settings changed`,
    ITERATION_STARTED: $localize`:@@featureInitiatives-actIteration:Iteration started`,
    ARTIFACT_CREATED: $localize`:@@featureInitiatives-actArtifactCreated:Document created`,
    ARTIFACT_UPDATED: $localize`:@@featureInitiatives-actArtifactUpdated:Document edited`,
    ARTIFACT_ACCEPTED: $localize`:@@featureInitiatives-actArtifactAccepted:Document accepted`,
    ARTIFACT_DELETED: $localize`:@@featureInitiatives-actArtifactDeleted:Document deleted`,
    ARTIFACT_PUBLISHED: $localize`:@@featureInitiatives-actArtifactPublished:Published to Knowledge`,
    WORK_ITEM_CREATED: $localize`:@@featureInitiatives-actItemCreated:Work item created`,
    WORK_ITEM_UPDATED: $localize`:@@featureInitiatives-actItemUpdated:Work item changed`,
    WORK_ITEM_DELETED: $localize`:@@featureInitiatives-actItemDeleted:Work item deleted`,
    WORK_ITEMS_REORDERED: $localize`:@@featureInitiatives-actReordered:Build order changed`,
    DEPENDENCIES_CHANGED: $localize`:@@featureInitiatives-actDependencies:Dependencies changed`,
    UNKNOWN_RESOLVED: $localize`:@@featureInitiatives-actUnknown:Question settled`,
    TRANSFERRED: $localize`:@@featureInitiatives-actTransferred:Transferred to tickets`,
    RELEASED: $localize`:@@featureInitiatives-actReleased:Stories released`,
    STORY_PLANNED: $localize`:@@featureInitiatives-actPlanned:Story planned`,
    RUN_STARTED: $localize`:@@featureInitiatives-actRunStarted:Step started`,
    RUN_ACCEPTED: $localize`:@@featureInitiatives-actRunAccepted:Step result accepted`,
    RUN_DISCARDED: $localize`:@@featureInitiatives-actRunDiscarded:Step result discarded`,
    RUN_FAILED: $localize`:@@featureInitiatives-actRunFailed:Step failed`,
    RUN_CANCELLED: $localize`:@@featureInitiatives-actRunCancelled:Step cancelled`,
    PROPOSAL_CREATED: $localize`:@@featureInitiatives-actProposalCreated:Change proposed`,
    PROPOSAL_ACCEPTED: $localize`:@@featureInitiatives-actProposalAccepted:Change accepted`,
    PROPOSAL_REJECTED: $localize`:@@featureInitiatives-actProposalRejected:Change rejected`,
    FINDING_CREATED: $localize`:@@featureInitiatives-actFindingCreated:Finding recorded`,
    FINDING_UPDATED: $localize`:@@featureInitiatives-actFindingUpdated:Finding updated`,
    DECISION_CREATED: $localize`:@@featureInitiatives-actDecisionCreated:Decision recorded`,
    DECISION_DECIDED: $localize`:@@featureInitiatives-actDecisionDecided:Decision decided`,
    RETROSPECTIVE_VERDICT: $localize`:@@featureInitiatives-actVerdict:Retrospective verdict`,
  };

  return labels[actionType] ?? actionType;
}

/** Tone of the data tables' State column (badge colors map onto the table tones). */
export function initiativeTableTone(tone: InitiativeTone): FpcBadgeTone {
  switch (tone) {
    case 'secondary':
    case 'light':
      return 'neutral';
    default:
      return tone;
  }
}

export function runModeLabel(mode: InitiativeRunMode): string {
  switch (mode) {
    case 'create':
      return $localize`:@@featureInitiatives-modeCreate:Write a new version`;
    case 'update':
      return $localize`:@@featureInitiatives-modeUpdate:Update the current version`;
    case 'validate':
      return $localize`:@@featureInitiatives-modeValidate:Check against the method`;
  }
}

export function runStyleLabel(style: InitiativeRunStyle): string {
  return style === 'fast'
    ? $localize`:@@featureInitiatives-styleFastShort:Fast path`
    : $localize`:@@featureInitiatives-styleCoachingShort:Coaching`;
}

export function artifactStatusLabel(status: InitiativeArtifactStatus): string {
  return status === 'accepted'
    ? $localize`:@@featureInitiatives-docAccepted:Accepted`
    : $localize`:@@featureInitiatives-docDraft:Draft`;
}

export function artifactStatusTone(status: InitiativeArtifactStatus): InitiativeTone {
  return status === 'accepted' ? 'success' : 'warning';
}

export function artifactVersionSourceLabel(source: 'human' | 'run' | 'proposal'): string {
  switch (source) {
    case 'human':
      return $localize`:@@featureInitiatives-versionSourceHuman:Edited by a person`;
    case 'run':
      return $localize`:@@featureInitiatives-versionSourceRun:Guided step`;
    case 'proposal':
      return $localize`:@@featureInitiatives-versionSourceProposal:Change proposal`;
  }
}

export function findingSourceLabel(source: FindingSource): string {
  switch (source) {
    case 'run':
      return $localize`:@@featureInitiatives-sourceRun:Guided step`;
    case 'retrospective':
      return $localize`:@@featureInitiatives-sourceRetrospective:Retrospective`;
    case 'automation':
      return $localize`:@@featureInitiatives-sourceAutomation:Ticket automation`;
    case 'chat':
      return $localize`:@@featureInitiatives-sourceChat:Chat`;
    case 'task':
      return $localize`:@@featureInitiatives-sourceTask:Scheduled task`;
    case 'human':
      return $localize`:@@featureInitiatives-sourceHuman:Workspace member`;
  }
}

export function findingStatusLabel(status: FindingStatus): string {
  switch (status) {
    case 'open':
      return $localize`:@@featureInitiatives-findingOpen:Open`;
    case 'converted':
      return $localize`:@@featureInitiatives-findingConverted:Turned into work`;
    case 'dismissed':
      return $localize`:@@featureInitiatives-findingDismissed:Dismissed`;
  }
}

export function proposalOriginLabel(origin: ProposalOrigin): string {
  switch (origin) {
    case 'human':
      return $localize`:@@featureInitiatives-sourceHuman:Workspace member`;
    case 'run':
      return $localize`:@@featureInitiatives-sourceRun:Guided step`;
    case 'chat':
      return $localize`:@@featureInitiatives-sourceChat:Chat`;
    case 'task':
      return $localize`:@@featureInitiatives-sourceTask:Scheduled task`;
    case 'automation':
      return $localize`:@@featureInitiatives-sourceAutomation:Ticket automation`;
  }
}

export function unknownResolutionLabel(resolution: UnknownResolution): string {
  switch (resolution) {
    case 'settle_now':
      return $localize`:@@featureInitiatives-resolutionSettleNow:Settle before building`;
    case 'spike':
      return $localize`:@@featureInitiatives-resolutionSpike:Explore in a spike`;
    case 'leave_to_stories':
      return $localize`:@@featureInitiatives-resolutionStories:Leave to the stories`;
  }
}

export function decisionStatusLabel(status: 'proposed' | 'accepted' | 'rejected'): string {
  switch (status) {
    case 'proposed':
      return $localize`:@@featureInitiatives-decisionProposed:Waiting for a decision`;
    case 'accepted':
      return $localize`:@@featureInitiatives-decisionAccepted:Accepted`;
    case 'rejected':
      return $localize`:@@featureInitiatives-decisionRejected:Rejected`;
  }
}

export function decisionStatusTone(status: 'proposed' | 'accepted' | 'rejected'): InitiativeTone {
  return status === 'accepted' ? 'success' : status === 'proposed' ? 'warning' : 'secondary';
}

export function workItemPriorityLabel(priority: 'low' | 'medium' | 'high' | 'critical'): string {
  switch (priority) {
    case 'low':
      return $localize`:@@featureInitiatives-priorityLow:Low`;
    case 'medium':
      return $localize`:@@featureInitiatives-priorityMedium:Medium`;
    case 'high':
      return $localize`:@@featureInitiatives-priorityHigh:High`;
    case 'critical':
      return $localize`:@@featureInitiatives-priorityCritical:Critical`;
  }
}

/**
 * The most useful facts of an activity entry, human readable (raw payload values such as status or step keys are
 * mapped to their labels; ids are left out).
 */
export function initiativeActivityDetail(payload: Record<string, unknown> | null | undefined): string {
  const data = payload ?? {};
  const text = (key: string) => (typeof data[key] === 'string' ? (data[key] as string) : '');
  const parts: string[] = [];
  const title = text('title');
  const key = text('key');
  const keys = Array.isArray(data['keys']) ? (data['keys'] as unknown[]).filter((k) => typeof k === 'string') : [];

  if (key) parts.push(key);
  if (keys.length) parts.push(keys.join(', '));
  if (title) parts.push(title);
  if (text('step')) parts.push(initiativeStepLabel(text('step') as InitiativeStepKey));
  if (text('type')) parts.push(initiativeArtifactTypeLabel(text('type') as InitiativeArtifactType));
  if (text('verdict')) parts.push(verdictLabel(text('verdict') as RetrospectiveVerdict));
  if (typeof data['iteration'] === 'number') {
    parts.push($localize`:@@featureInitiatives-activityIteration:Iteration ${data['iteration']}:iteration:`);
  }
  if (typeof data['count'] === 'number') {
    parts.push($localize`:@@featureInitiatives-activityCount:${data['count']}:count: entries`);
  }

  return parts.join(', ');
}

/**
 * A step's unmet need as a sentence (documents by their names, never by their keys). `required`: a hard need (the step
 * cannot start yet), otherwise a recommendation.
 */
export function initiativeStepNeedLabel(need: InitiativeStepNeed, required: boolean): string {
  switch (need.kind) {
    case 'intent':
      return $localize`:@@featureInitiatives-needIntent:The initiative needs an intent.`;
    case 'artifact': {
      const documents = need.artifactTypes
        .map(initiativeArtifactTypeLabel)
        .join($localize`:@@featureInitiatives-needOr: or `);

      return required
        ? $localize`:@@featureInitiatives-needDocument:Accept one of these documents first: ${documents}:documents:.`
        : $localize`:@@featureInitiatives-recommendDocument:Recommended before this step: an accepted ${documents}:documents:.`;
    }
    case 'target-epic':
      return $localize`:@@featureInitiatives-needEpic:Choose an epic.`;
    case 'refined-epic':
      return $localize`:@@featureInitiatives-needRefinedEpic:Refine the epic first.`;
    case 'epic-with-stories':
      return $localize`:@@featureInitiatives-needStories:The epic needs at least one story.`;
    case 'epics':
      return $localize`:@@featureInitiatives-needEpics:Slice the initiative into epics first.`;
  }
}
