import { createFeatureSelector, createSelector } from '@ngrx/store';

import { BrowserPreviewState } from './browser-preview.reducer';

export const selectBrowserPreviewState = createFeatureSelector<BrowserPreviewState>('browserPreview');

export const selectBrowserPreviewOpen = createSelector(selectBrowserPreviewState, (state) => state.open);

export const selectBrowserPreviewStarting = createSelector(selectBrowserPreviewState, (state) => state.starting);

export const selectBrowserPreviewSessionId = createSelector(selectBrowserPreviewState, (state) => state.sessionId);

export const selectBrowserPreviewAgentId = createSelector(selectBrowserPreviewState, (state) => state.agentId);

export const selectBrowserPreviewFrameData = createSelector(
  selectBrowserPreviewState,
  (state) => state.latestFrameData,
);

export const selectBrowserPreviewFrameMetadata = createSelector(
  selectBrowserPreviewState,
  (state) => state.latestFrameMetadata,
);

export const selectBrowserPreviewCurrentUrl = createSelector(selectBrowserPreviewState, (state) => state.currentUrl);

export const selectBrowserPreviewWorkspaceHostname = createSelector(
  selectBrowserPreviewState,
  (state) => state.workspaceHostname,
);

export const selectBrowserPreviewCanGoBack = createSelector(selectBrowserPreviewState, (state) => state.canGoBack);

export const selectBrowserPreviewCanGoForward = createSelector(
  selectBrowserPreviewState,
  (state) => state.canGoForward,
);

export const selectBrowserPreviewError = createSelector(selectBrowserPreviewState, (state) => state.error);
