import { createReducer, on } from '@ngrx/store';

import type { ClusterSummary, ConsoleNode, CreatedJoinToken, JoinToken, NodeAction } from '../../types/nodes.types';
import {
  clearCreatedJoinToken,
  clearNodeActionError,
  createJoinToken,
  createJoinTokenFailure,
  createJoinTokenSuccess,
  loadJoinTokens,
  loadJoinTokensFailure,
  loadJoinTokensSuccess,
  loadNode,
  loadNodeFailure,
  loadNodes,
  loadNodesFailure,
  loadNodesSuccess,
  loadNodeSuccess,
  nodeAction,
  nodeActionFailure,
  nodeActionSuccess,
  revokeJoinToken,
  revokeJoinTokenFailure,
  revokeJoinTokenSuccess,
} from './nodes.actions';

export interface ConsoleNodesState {
  nodes: ConsoleNode[];
  cluster: ClusterSummary | null;
  loading: boolean;
  error: string | null;
  selectedName: string | null;
  selected: ConsoleNode | null;
  selectedLoading: boolean;
  selectedError: string | null;
  /** The node action in flight. */
  acting: { name: string; action: NodeAction } | null;
  actionError: string | null;
  tokens: JoinToken[];
  tokensLoading: boolean;
  tokensError: string | null;
  creatingToken: boolean;
  /** The token just created, with its plaintext (shown once). */
  createdToken: CreatedJoinToken | null;
  revokingToken: string | null;
  tokenError: string | null;
}

export const initialConsoleNodesState: ConsoleNodesState = {
  nodes: [],
  cluster: null,
  loading: false,
  error: null,
  selectedName: null,
  selected: null,
  selectedLoading: false,
  selectedError: null,
  acting: null,
  actionError: null,
  tokens: [],
  tokensLoading: false,
  tokensError: null,
  creatingToken: false,
  createdToken: null,
  revokingToken: null,
  tokenError: null,
};

/** The list never carries the plaintext token. */
function withoutPlaintext(token: CreatedJoinToken): JoinToken {
  const listed: Partial<CreatedJoinToken> = { ...token };

  delete listed.token;

  return listed as JoinToken;
}

function withNode(state: ConsoleNodesState, node: ConsoleNode): ConsoleNodesState {
  return {
    ...state,
    nodes: state.nodes.map((n) => (n.name === node.name ? node : n)),
    selected: state.selectedName === node.name ? node : state.selected,
  };
}

export const consoleNodesReducer = createReducer(
  initialConsoleNodesState,
  on(loadNodes, (state, { silent }) => ({ ...state, loading: !silent, error: null })),
  on(loadNodesSuccess, (state, { nodes, cluster }) => ({
    ...state,
    nodes,
    cluster: cluster ?? state.cluster,
    loading: false,
  })),
  on(loadNodesFailure, (state, { error }) => ({ ...state, loading: false, error })),
  on(loadNode, (state, { name, silent }) => ({
    ...state,
    selectedName: name,
    selected: state.selected?.name === name ? state.selected : (state.nodes.find((n) => n.name === name) ?? null),
    selectedLoading: !silent,
    selectedError: null,
    actionError: state.selectedName === name ? state.actionError : null,
  })),
  on(loadNodeSuccess, (state, { node }) =>
    state.selectedName === node.name ? { ...withNode(state, node), selectedLoading: false } : withNode(state, node),
  ),
  on(loadNodeFailure, (state, { name, error }) =>
    state.selectedName === name ? { ...state, selectedLoading: false, selectedError: error } : state,
  ),
  on(nodeAction, (state, { name, action }) => ({ ...state, acting: { name, action }, actionError: null })),
  on(nodeActionSuccess, (state, { node }) => ({ ...withNode(state, node), acting: null })),
  on(nodeActionFailure, (state, { error }) => ({ ...state, acting: null, actionError: error })),
  on(clearNodeActionError, (state) => ({ ...state, actionError: null })),
  on(loadJoinTokens, (state) => ({ ...state, tokensLoading: true, tokensError: null })),
  on(loadJoinTokensSuccess, (state, { tokens }) => ({ ...state, tokens, tokensLoading: false })),
  on(loadJoinTokensFailure, (state, { error }) => ({ ...state, tokensLoading: false, tokensError: error })),
  on(createJoinToken, (state) => ({ ...state, creatingToken: true, createdToken: null, tokenError: null })),
  on(createJoinTokenSuccess, (state, { token }) => ({
    ...state,
    creatingToken: false,
    createdToken: token,
    tokens: [withoutPlaintext(token), ...state.tokens],
  })),
  on(createJoinTokenFailure, (state, { error }) => ({ ...state, creatingToken: false, tokenError: error })),
  on(clearCreatedJoinToken, (state) => ({ ...state, createdToken: null })),
  on(revokeJoinToken, (state, { id }) => ({ ...state, revokingToken: id, tokenError: null })),
  on(revokeJoinTokenSuccess, (state, { id }) => ({
    ...state,
    revokingToken: null,
    tokens: state.tokens.filter((t) => t.id !== id),
  })),
  on(revokeJoinTokenFailure, (state, { error }) => ({ ...state, revokingToken: null, tokenError: error })),
);
