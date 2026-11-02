import { createAction, props } from '@ngrx/store';

import type {
  ClusterSummary,
  ConsoleNode,
  CreatedJoinToken,
  CreateJoinTokenRequest,
  JoinToken,
  NodeAction,
} from '../../types/nodes.types';

export const loadNodes = createAction('[ConsoleNodes] Load', props<{ silent?: boolean }>());
export const loadNodesSuccess = createAction(
  '[ConsoleNodes] Load Success',
  props<{ nodes: ConsoleNode[]; cluster: ClusterSummary | null }>(),
);
export const loadNodesFailure = createAction('[ConsoleNodes] Load Failure', props<{ error: string }>());

export const loadNode = createAction('[ConsoleNodes] Load Node', props<{ name: string; silent?: boolean }>());
export const loadNodeSuccess = createAction('[ConsoleNodes] Load Node Success', props<{ node: ConsoleNode }>());
export const loadNodeFailure = createAction(
  '[ConsoleNodes] Load Node Failure',
  props<{ name: string; error: string }>(),
);

export const nodeAction = createAction('[ConsoleNodes] Action', props<{ name: string; action: NodeAction }>());
export const nodeActionSuccess = createAction(
  '[ConsoleNodes] Action Success',
  props<{ action: NodeAction; node: ConsoleNode }>(),
);
export const nodeActionFailure = createAction(
  '[ConsoleNodes] Action Failure',
  props<{ name: string; action: NodeAction; error: string }>(),
);
export const clearNodeActionError = createAction('[ConsoleNodes] Clear Action Error');

export const loadJoinTokens = createAction('[ConsoleNodes] Load Join Tokens');
export const loadJoinTokensSuccess = createAction(
  '[ConsoleNodes] Load Join Tokens Success',
  props<{ tokens: JoinToken[] }>(),
);
export const loadJoinTokensFailure = createAction(
  '[ConsoleNodes] Load Join Tokens Failure',
  props<{ error: string }>(),
);

export const createJoinToken = createAction(
  '[ConsoleNodes] Create Join Token',
  props<{ request: CreateJoinTokenRequest }>(),
);
export const createJoinTokenSuccess = createAction(
  '[ConsoleNodes] Create Join Token Success',
  props<{ token: CreatedJoinToken }>(),
);
export const createJoinTokenFailure = createAction(
  '[ConsoleNodes] Create Join Token Failure',
  props<{ error: string }>(),
);
/** Forgets the plaintext token once it was shown. */
export const clearCreatedJoinToken = createAction('[ConsoleNodes] Clear Created Join Token');

export const revokeJoinToken = createAction('[ConsoleNodes] Revoke Join Token', props<{ id: string }>());
export const revokeJoinTokenSuccess = createAction('[ConsoleNodes] Revoke Join Token Success', props<{ id: string }>());
export const revokeJoinTokenFailure = createAction(
  '[ConsoleNodes] Revoke Join Token Failure',
  props<{ id: string; error: string }>(),
);
