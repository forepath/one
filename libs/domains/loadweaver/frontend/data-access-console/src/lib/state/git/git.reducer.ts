import { createReducer, on } from '@ngrx/store';

import type {
  CreatedGitConnection,
  GitCommit,
  GitConnection,
  GitConnectionActionKind,
  GitConnectionActionResult,
} from '../../types/git.types';
import {
  clearGitActionResult,
  clearGitSave,
  createGitConnection,
  createGitConnectionFailure,
  createGitConnectionSuccess,
  deleteGitConnection,
  deleteGitConnectionFailure,
  deleteGitConnectionSuccess,
  hideGitWebhookSecret,
  loadGitCommits,
  loadGitCommitsFailure,
  loadGitCommitsSuccess,
  loadGitConnections,
  loadGitConnectionsFailure,
  loadGitConnectionsSuccess,
  loadGitSopsRecipient,
  loadGitSopsRecipientFailure,
  loadGitSopsRecipientSuccess,
  revealGitWebhookSecret,
  revealGitWebhookSecretFailure,
  revealGitWebhookSecretSuccess,
  rotateGitWebhookSecret,
  rotateGitWebhookSecretFailure,
  rotateGitWebhookSecretSuccess,
  runGitConnectionAction,
  runGitConnectionActionFailure,
  runGitConnectionActionSuccess,
  updateGitConnection,
  updateGitConnectionFailure,
  updateGitConnectionSuccess,
} from './git.actions';

export interface ConsoleGitState {
  connections: GitConnection[];
  loaded: boolean;
  loading: boolean;
  error: string | null;
  /** Per connection id. */
  commits: Record<string, GitCommit[]>;
  commitsLoading: string | null;
  commitsError: string | null;
  saving: boolean;
  saveError: string | null;
  /** The id saved last (create or update), until the dialog is cleared. */
  saved: string | null;
  /** The connection just created, with its webhook secret (shown once). */
  created: CreatedGitConnection | null;
  deleting: string | null;
  deleteError: string | null;
  /** The action running on a connection. */
  acting: { id: string; action: GitConnectionActionKind } | null;
  actionError: { id: string; action: GitConnectionActionKind; error: string } | null;
  /** What the last action answered. */
  actionResult: { id: string; outcome: GitConnectionActionResult } | null;
  /** The webhook secret read on demand or just rotated (`rotated`); dropped when hidden. */
  webhookSecret: { id: string; secret: string; rotated?: boolean } | null;
  webhookSecretLoading: string | null;
  /** The connection whose secret is being rotated. */
  webhookSecretRotating: string | null;
  webhookSecretError: string | null;
  sopsRecipient: string | null;
  sopsLoaded: boolean;
  sopsError: string | null;
  sopsUnavailable: boolean;
}

export const initialConsoleGitState: ConsoleGitState = {
  connections: [],
  loaded: false,
  loading: false,
  error: null,
  commits: {},
  commitsLoading: null,
  commitsError: null,
  saving: false,
  saveError: null,
  saved: null,
  created: null,
  deleting: null,
  deleteError: null,
  acting: null,
  actionError: null,
  actionResult: null,
  webhookSecret: null,
  webhookSecretLoading: null,
  webhookSecretRotating: null,
  webhookSecretError: null,
  sopsRecipient: null,
  sopsLoaded: false,
  sopsError: null,
  sopsUnavailable: false,
};

/** Cluster scope first, then projects by name (as the API orders them). */
function sorted(connections: GitConnection[]): GitConnection[] {
  return [...connections].sort((a, b) => (a.project ?? '').localeCompare(b.project ?? ''));
}

function upsert(connections: GitConnection[], connection: GitConnection): GitConnection[] {
  return sorted([...connections.filter((c) => c.id !== connection.id), connection]);
}

/** The list never carries the webhook secret. */
function withoutSecret(connection: CreatedGitConnection): GitConnection {
  const listed: Partial<CreatedGitConnection> = { ...connection };

  delete listed.webhookSecret;

  return listed as GitConnection;
}

export const consoleGitReducer = createReducer(
  initialConsoleGitState,
  on(loadGitConnections, (state, { silent }) => ({ ...state, loading: !silent, error: silent ? state.error : null })),
  on(loadGitConnectionsSuccess, (state, { connections }) => ({
    ...state,
    connections: sorted(connections),
    loaded: true,
    loading: false,
    error: null,
  })),
  on(loadGitConnectionsFailure, (state, { error }) => ({ ...state, loading: false, loaded: true, error })),
  on(loadGitCommits, (state, { id, silent }) => ({
    ...state,
    commitsLoading: silent ? state.commitsLoading : id,
    commitsError: null,
  })),
  on(loadGitCommitsSuccess, (state, { id, commits }) => ({
    ...state,
    commits: { ...state.commits, [id]: commits },
    commitsLoading: state.commitsLoading === id ? null : state.commitsLoading,
  })),
  on(loadGitCommitsFailure, (state, { id, error }) => ({
    ...state,
    commitsLoading: state.commitsLoading === id ? null : state.commitsLoading,
    commitsError: error,
  })),
  on(createGitConnection, updateGitConnection, (state) => ({
    ...state,
    saving: true,
    saveError: null,
    saved: null,
    created: null,
  })),
  on(createGitConnectionSuccess, (state, { connection }) => ({
    ...state,
    saving: false,
    saved: connection.id,
    created: connection,
    connections: upsert(state.connections, withoutSecret(connection)),
  })),
  on(updateGitConnectionSuccess, (state, { connection }) => ({
    ...state,
    saving: false,
    saved: connection.id,
    connections: upsert(state.connections, connection),
  })),
  on(createGitConnectionFailure, updateGitConnectionFailure, (state, { error }) => ({
    ...state,
    saving: false,
    saveError: error,
  })),
  on(clearGitSave, (state) => ({ ...state, saving: false, saveError: null, saved: null, created: null })),
  on(deleteGitConnection, (state, { id }) => ({ ...state, deleting: id, deleteError: null })),
  on(deleteGitConnectionSuccess, (state, { id }) => {
    const commits = { ...state.commits };

    delete commits[id];

    return {
      ...state,
      deleting: null,
      connections: state.connections.filter((c) => c.id !== id),
      commits,
      webhookSecret: state.webhookSecret?.id === id ? null : state.webhookSecret,
      actionResult: state.actionResult?.id === id ? null : state.actionResult,
    };
  }),
  on(deleteGitConnectionFailure, (state, { error }) => ({ ...state, deleting: null, deleteError: error })),
  on(runGitConnectionAction, (state, { id, action }) => ({
    ...state,
    acting: { id, action },
    actionError: null,
    actionResult: null,
  })),
  on(runGitConnectionActionSuccess, (state, { id, outcome }) => ({
    ...state,
    acting: null,
    actionResult: { id, outcome },
    connections: outcome.action === 'reset-host-key' ? upsert(state.connections, outcome.result) : state.connections,
  })),
  on(runGitConnectionActionFailure, (state, { id, action, error }) => ({
    ...state,
    acting: null,
    actionError: { id, action, error },
  })),
  on(clearGitActionResult, (state) => ({ ...state, actionResult: null, actionError: null, deleteError: null })),
  on(revealGitWebhookSecret, (state, { id }) => ({
    ...state,
    webhookSecret: null,
    webhookSecretLoading: id,
    webhookSecretError: null,
  })),
  on(revealGitWebhookSecretSuccess, (state, { id, secret }) => ({
    ...state,
    webhookSecret: { id, secret },
    webhookSecretLoading: null,
  })),
  on(revealGitWebhookSecretFailure, (state, { error }) => ({
    ...state,
    webhookSecretLoading: null,
    webhookSecretError: error,
  })),
  on(rotateGitWebhookSecret, (state, { id }) => ({
    ...state,
    webhookSecret: null,
    webhookSecretRotating: id,
    webhookSecretError: null,
  })),
  on(rotateGitWebhookSecretSuccess, (state, { id, secret, generation }) => ({
    ...state,
    webhookSecret: { id, secret, rotated: true },
    webhookSecretRotating: null,
    connections: state.connections.map((c) => (c.id === id ? { ...c, webhookGeneration: generation } : c)),
  })),
  on(rotateGitWebhookSecretFailure, (state, { error }) => ({
    ...state,
    webhookSecretRotating: null,
    webhookSecretError: error,
  })),
  on(hideGitWebhookSecret, (state) => ({ ...state, webhookSecret: null, webhookSecretError: null })),
  on(loadGitSopsRecipient, (state) => ({ ...state, sopsError: null })),
  on(loadGitSopsRecipientSuccess, (state, { recipient }) => ({
    ...state,
    sopsRecipient: recipient,
    sopsLoaded: true,
    sopsUnavailable: false,
  })),
  on(loadGitSopsRecipientFailure, (state, { error, unavailable }) => ({
    ...state,
    sopsRecipient: null,
    sopsLoaded: true,
    sopsError: unavailable ? null : error,
    sopsUnavailable: unavailable,
  })),
);
