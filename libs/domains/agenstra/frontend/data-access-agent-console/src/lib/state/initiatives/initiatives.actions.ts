import { createAction, props } from '@ngrx/store';

import type {
  InitiativeActivityDto,
  InitiativeArtifactDto,
  InitiativeArtifactVersionDto,
  InitiativeCommand,
  InitiativeCommandResult,
  InitiativeDecisionDto,
  InitiativeDto,
  InitiativeFindingDto,
  InitiativeOverviewDto,
  InitiativeProposalDto,
  InitiativeRunDto,
  InitiativeRunTurnDto,
  InitiativeWorkItemsDto,
} from './initiatives.types';

export const loadInitiatives = createAction(
  '[Initiatives] Load',
  props<{ clientId: string; search?: string; state?: string | null }>(),
);
export const loadInitiativesSuccess = createAction(
  '[Initiatives] Load Success',
  props<{ clientId: string; items: InitiativeDto[]; total: number }>(),
);
export const loadInitiativesFailure = createAction('[Initiatives] Load Failure', props<{ error: string }>());

export const selectInitiative = createAction('[Initiatives] Select', props<{ id: string | null }>());
export const loadInitiativeDetailSuccess = createAction(
  '[Initiatives] Load Detail Success',
  props<{
    id: string;
    overview: InitiativeOverviewDto;
    artifacts: InitiativeArtifactDto[];
    workItems: InitiativeWorkItemsDto;
    runs: InitiativeRunDto[];
    proposals: InitiativeProposalDto[];
    findings: InitiativeFindingDto[];
    decisions: InitiativeDecisionDto[];
    activity: InitiativeActivityDto[];
  }>(),
);
export const loadInitiativeDetailFailure = createAction(
  '[Initiatives] Load Detail Failure',
  props<{ error: string }>(),
);
/** Refetch the selected initiative in place (load latest after a conflict, socket reconnect): keeps the open document
 * and run (and so an edit draft) and refetches them too. */
export const reloadInitiative = createAction('[Initiatives] Reload', props<{ id: string }>());
export const reloadInitiativeOverview = createAction('[Initiatives] Reload Overview', props<{ id: string }>());
export const reloadInitiativeOverviewSuccess = createAction(
  '[Initiatives] Reload Overview Success',
  props<{ overview: InitiativeOverviewDto }>(),
);

export const openInitiativeArtifact = createAction(
  '[Initiatives] Open Artifact',
  props<{ artifactId: string | null }>(),
);
export const openInitiativeArtifactSuccess = createAction(
  '[Initiatives] Open Artifact Success',
  props<{ artifact: InitiativeArtifactDto; versions: InitiativeArtifactVersionDto[] }>(),
);
export const loadInitiativeArtifactVersion = createAction(
  '[Initiatives] Load Artifact Version',
  props<{ artifactId: string; version: number | null }>(),
);
export const loadInitiativeArtifactVersionSuccess = createAction(
  '[Initiatives] Load Artifact Version Success',
  props<{ version: InitiativeArtifactVersionDto | null }>(),
);

export const openInitiativeRun = createAction('[Initiatives] Open Run', props<{ runId: string | null }>());
export const openInitiativeRunSuccess = createAction(
  '[Initiatives] Open Run Success',
  props<{ run: InitiativeRunDto }>(),
);

export const runInitiativeCommand = createAction('[Initiatives] Command', props<{ command: InitiativeCommand }>());
export const runInitiativeCommandSuccess = createAction(
  '[Initiatives] Command Success',
  props<{ command: InitiativeCommand; result: InitiativeCommandResult }>(),
);
export const runInitiativeCommandFailure = createAction(
  '[Initiatives] Command Failure',
  props<{ command: InitiativeCommand; error: string; conflict: boolean }>(),
);
export const clearInitiativeError = createAction('[Initiatives] Clear Error');

// Live updates (`initiatives` socket)
export const initiativeLiveUpsert = createAction('[Initiatives Live] Upsert', props<{ initiative: InitiativeDto }>());
export const initiativeLiveRemoved = createAction('[Initiatives Live] Removed', props<{ id: string }>());
export const initiativeArtifactLiveUpsert = createAction(
  '[Initiatives Live] Artifact Upsert',
  props<{ artifact: InitiativeArtifactDto }>(),
);
export const initiativeArtifactLiveRemoved = createAction(
  '[Initiatives Live] Artifact Removed',
  props<{ id: string; initiativeId: string }>(),
);
export const initiativeWorkItemsLiveChanged = createAction(
  '[Initiatives Live] Work Items Changed',
  props<{ initiativeId: string; workItems: InitiativeWorkItemsDto }>(),
);
export const initiativeRunLiveUpsert = createAction(
  '[Initiatives Live] Run Upsert',
  props<{ run: InitiativeRunDto }>(),
);
export const initiativeRunTurnLiveAppended = createAction(
  '[Initiatives Live] Run Turn Appended',
  props<{ initiativeId: string; turn: InitiativeRunTurnDto }>(),
);
export const initiativeProposalLiveUpsert = createAction(
  '[Initiatives Live] Proposal Upsert',
  props<{ proposal: InitiativeProposalDto }>(),
);
export const initiativeFindingLiveUpsert = createAction(
  '[Initiatives Live] Finding Upsert',
  props<{ finding: InitiativeFindingDto }>(),
);
export const initiativeDecisionLiveUpsert = createAction(
  '[Initiatives Live] Decision Upsert',
  props<{ decision: InitiativeDecisionDto }>(),
);
export const initiativeActivityLiveCreated = createAction(
  '[Initiatives Live] Activity Created',
  props<{ activity: InitiativeActivityDto }>(),
);
