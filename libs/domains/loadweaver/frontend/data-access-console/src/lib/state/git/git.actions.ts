import { createAction, props } from '@ngrx/store';

import type {
  CreatedGitConnection,
  CreateGitConnectionRequest,
  GitCommit,
  GitConnection,
  GitConnectionActionKind,
  GitConnectionActionResult,
  UpdateGitConnectionRequest,
} from '../../types/git.types';

/** `silent`: refresh without the loading state (other views read the connections in the background). */
export const loadGitConnections = createAction('[ConsoleGit] Load', props<{ silent?: boolean }>());
export const loadGitConnectionsSuccess = createAction(
  '[ConsoleGit] Load Success',
  props<{ connections: GitConnection[] }>(),
);
export const loadGitConnectionsFailure = createAction('[ConsoleGit] Load Failure', props<{ error: string }>());

export const loadGitCommits = createAction('[ConsoleGit] Load Commits', props<{ id: string; silent?: boolean }>());
export const loadGitCommitsSuccess = createAction(
  '[ConsoleGit] Load Commits Success',
  props<{ id: string; commits: GitCommit[] }>(),
);
export const loadGitCommitsFailure = createAction(
  '[ConsoleGit] Load Commits Failure',
  props<{ id: string; error: string }>(),
);

export const createGitConnection = createAction(
  '[ConsoleGit] Create',
  props<{ request: CreateGitConnectionRequest }>(),
);
export const createGitConnectionSuccess = createAction(
  '[ConsoleGit] Create Success',
  props<{ connection: CreatedGitConnection }>(),
);
export const createGitConnectionFailure = createAction('[ConsoleGit] Create Failure', props<{ error: string }>());

export const updateGitConnection = createAction(
  '[ConsoleGit] Update',
  props<{ id: string; request: UpdateGitConnectionRequest }>(),
);
export const updateGitConnectionSuccess = createAction(
  '[ConsoleGit] Update Success',
  props<{ connection: GitConnection }>(),
);
export const updateGitConnectionFailure = createAction('[ConsoleGit] Update Failure', props<{ error: string }>());
/** Forgets the save state (and the webhook secret shown after a create). */
export const clearGitSave = createAction('[ConsoleGit] Clear Save');

export const deleteGitConnection = createAction('[ConsoleGit] Delete', props<{ id: string }>());
export const deleteGitConnectionSuccess = createAction('[ConsoleGit] Delete Success', props<{ id: string }>());
export const deleteGitConnectionFailure = createAction(
  '[ConsoleGit] Delete Failure',
  props<{ id: string; error: string }>(),
);

/** Test, sync, export (`force` replaces the files in the path) or reset the pinned SSH host key. */
export const runGitConnectionAction = createAction(
  '[ConsoleGit] Run Action',
  props<{ id: string; action: GitConnectionActionKind; force?: boolean }>(),
);
export const runGitConnectionActionSuccess = createAction(
  '[ConsoleGit] Run Action Success',
  props<{ id: string; outcome: GitConnectionActionResult }>(),
);
export const runGitConnectionActionFailure = createAction(
  '[ConsoleGit] Run Action Failure',
  props<{ id: string; action: GitConnectionActionKind; error: string }>(),
);
export const clearGitActionResult = createAction('[ConsoleGit] Clear Action Result');

/** Reads the webhook secret on demand (audited). */
export const revealGitWebhookSecret = createAction('[ConsoleGit] Reveal Webhook Secret', props<{ id: string }>());
export const revealGitWebhookSecretSuccess = createAction(
  '[ConsoleGit] Reveal Webhook Secret Success',
  props<{ id: string; secret: string }>(),
);
export const revealGitWebhookSecretFailure = createAction(
  '[ConsoleGit] Reveal Webhook Secret Failure',
  props<{ id: string; error: string }>(),
);
/** Replaces the webhook secret (audited); the current one stops working at once. The new one is shown once. */
export const rotateGitWebhookSecret = createAction('[ConsoleGit] Rotate Webhook Secret', props<{ id: string }>());
export const rotateGitWebhookSecretSuccess = createAction(
  '[ConsoleGit] Rotate Webhook Secret Success',
  props<{ id: string; secret: string; generation: number }>(),
);
export const rotateGitWebhookSecretFailure = createAction(
  '[ConsoleGit] Rotate Webhook Secret Failure',
  props<{ id: string; error: string }>(),
);
/** Drops the shown secret from the store. */
export const hideGitWebhookSecret = createAction('[ConsoleGit] Hide Webhook Secret');

export const loadGitSopsRecipient = createAction('[ConsoleGit] Load SOPS Recipient');
export const loadGitSopsRecipientSuccess = createAction(
  '[ConsoleGit] Load SOPS Recipient Success',
  props<{ recipient: string | null }>(),
);
/** `unavailable`: the endpoint doesn't exist (yet) on this control plane. */
export const loadGitSopsRecipientFailure = createAction(
  '[ConsoleGit] Load SOPS Recipient Failure',
  props<{ error: string; unavailable: boolean }>(),
);
