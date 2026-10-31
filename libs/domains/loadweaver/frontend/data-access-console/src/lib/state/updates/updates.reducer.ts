import { createReducer, on } from '@ngrx/store';

import type {
  BundleUploadProgress,
  MaintenanceWindowResource,
  Rollout,
  RolloutAction,
  UpdateRelease,
  UpdatesStatus,
} from '../../types/updates.types';
import {
  cancelBundleUpload,
  clearBundleUpload,
  clearCreateRolloutError,
  clearRolloutActionError,
  createRollout,
  createRolloutFailure,
  createRolloutSuccess,
  downloadRelease,
  downloadReleaseFailure,
  downloadReleaseSuccess,
  loadRollout,
  loadRolloutFailure,
  loadRolloutSuccess,
  loadUpdates,
  loadUpdatesFailure,
  loadUpdatesSuccess,
  rolloutAction,
  rolloutActionFailure,
  rolloutActionSuccess,
  uploadBundle,
  uploadBundleFailure,
  uploadBundleProgress,
  uploadBundleSuccess,
} from './updates.actions';

export interface ConsoleUpdatesState {
  status: UpdatesStatus | null;
  releases: UpdateRelease[];
  rollouts: Rollout[];
  /** `null` until loaded (or when the caller can't read them). */
  windows: MaintenanceWindowResource[] | null;
  /** The `Cluster` resource's name (for the policy's edit link). */
  clusterResource: string | null;
  loaded: boolean;
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  selected: Rollout | null;
  selectedLoading: boolean;
  selectedError: string | null;
  /** Versions whose download was just requested. */
  downloading: string[];
  downloadError: string | null;
  upload: BundleUploadProgress | null;
  uploadError: string | null;
  /** The release the last upload imported. */
  uploaded: UpdateRelease | null;
  creating: boolean;
  createError: string | null;
  acting: { id: string; action: RolloutAction } | null;
  actionError: string | null;
}

export const initialConsoleUpdatesState: ConsoleUpdatesState = {
  status: null,
  releases: [],
  rollouts: [],
  windows: null,
  clusterResource: null,
  loaded: false,
  loading: false,
  error: null,
  selectedId: null,
  selected: null,
  selectedLoading: false,
  selectedError: null,
  downloading: [],
  downloadError: null,
  upload: null,
  uploadError: null,
  uploaded: null,
  creating: false,
  createError: null,
  acting: null,
  actionError: null,
};

function withRollout(state: ConsoleUpdatesState, rollout: Rollout): ConsoleUpdatesState {
  const listed = state.rollouts.some((r) => r.id === rollout.id);

  return {
    ...state,
    rollouts: listed ? state.rollouts.map((r) => (r.id === rollout.id ? rollout : r)) : [rollout, ...state.rollouts],
    selected: state.selectedId === rollout.id ? rollout : state.selected,
  };
}

function withRelease(releases: UpdateRelease[], release: UpdateRelease): UpdateRelease[] {
  return releases.some((r) => r.version === release.version)
    ? releases.map((r) => (r.version === release.version ? release : r))
    : [release, ...releases];
}

export const consoleUpdatesReducer = createReducer(
  initialConsoleUpdatesState,
  on(loadUpdates, (state, { silent }) => ({ ...state, loading: !silent, error: silent ? state.error : null })),
  on(loadUpdatesSuccess, (state, { status, releases, rollouts, windows, clusterResource }) => ({
    ...state,
    status,
    releases,
    rollouts,
    windows: windows ?? state.windows,
    clusterResource: clusterResource ?? state.clusterResource,
    loaded: true,
    loading: false,
    error: null,
    // A download shows `importing` (or its result) once the list has it.
    downloading: state.downloading.filter((v) => releases.find((r) => r.version === v)?.status === 'announced'),
  })),
  on(loadUpdatesFailure, (state, { error }) => ({ ...state, loading: false, error })),
  on(loadRollout, (state, { id, silent }) => ({
    ...state,
    selectedId: id,
    selected: state.selected?.id === id ? state.selected : (state.rollouts.find((r) => r.id === id) ?? null),
    selectedLoading: !silent,
    selectedError: null,
    actionError: state.selectedId === id ? state.actionError : null,
  })),
  on(loadRolloutSuccess, (state, { rollout }) =>
    state.selectedId === rollout.id
      ? { ...withRollout(state, rollout), selectedLoading: false }
      : withRollout(state, rollout),
  ),
  on(loadRolloutFailure, (state, { id, error }) =>
    state.selectedId === id ? { ...state, selectedLoading: false, selectedError: error } : state,
  ),
  on(downloadRelease, (state, { version }) => ({
    ...state,
    downloading: [...state.downloading.filter((v) => v !== version), version],
    downloadError: null,
  })),
  on(downloadReleaseSuccess, (state, { version }) => ({
    ...state,
    releases: state.releases.map((r) => (r.version === version ? { ...r, status: 'importing' as const } : r)),
  })),
  on(downloadReleaseFailure, (state, { version, error }) => ({
    ...state,
    downloading: state.downloading.filter((v) => v !== version),
    downloadError: error,
  })),
  on(uploadBundle, (state, { file }) => ({
    ...state,
    upload: { fileName: file.name, loaded: 0, total: file.size },
    uploadError: null,
    uploaded: null,
  })),
  on(uploadBundleProgress, (state, { loaded, total }) =>
    state.upload ? { ...state, upload: { ...state.upload, loaded, total: total || state.upload.total } } : state,
  ),
  on(uploadBundleSuccess, (state, { release }) => ({
    ...state,
    upload: null,
    uploaded: release,
    releases: withRelease(state.releases, release),
  })),
  on(uploadBundleFailure, (state, { error }) => ({ ...state, upload: null, uploadError: error })),
  on(cancelBundleUpload, (state) => ({ ...state, upload: null })),
  on(clearBundleUpload, (state) => ({ ...state, uploadError: null, uploaded: null })),
  on(createRollout, (state) => ({ ...state, creating: true, createError: null })),
  on(createRolloutSuccess, (state, { rollout }) => ({ ...withRollout(state, rollout), creating: false })),
  on(createRolloutFailure, (state, { error }) => ({ ...state, creating: false, createError: error })),
  on(clearCreateRolloutError, (state) => ({ ...state, createError: null })),
  on(rolloutAction, (state, { id, action }) => ({ ...state, acting: { id, action }, actionError: null })),
  on(rolloutActionSuccess, (state, { rollout }) => ({ ...withRollout(state, rollout), acting: null })),
  on(rolloutActionFailure, (state, { error }) => ({ ...state, acting: null, actionError: error })),
  on(clearRolloutActionError, (state) => ({ ...state, actionError: null })),
);
