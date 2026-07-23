import { createReducer, on } from '@ngrx/store';

import {
  browserPreviewError,
  browserPreviewFrameReceived,
  browserPreviewLocationReceived,
  browserPreviewStarted,
  browserPreviewStopped,
  closeBrowserPreviewUi,
  openBrowserPreview,
  stopBrowserPreview,
} from './browser-preview.actions';

export interface BrowserPreviewFrameMetadata {
  offsetTop: number;
  pageScaleFactor: number;
  deviceWidth: number;
  deviceHeight: number;
  scrollOffsetX: number;
  scrollOffsetY: number;
  timestamp: number;
}

export interface BrowserPreviewState {
  open: boolean;
  starting: boolean;
  agentId: string | null;
  sessionId: string | null;
  workspaceHostname: string | null;
  latestFrameData: string | null;
  latestFrameMetadata: BrowserPreviewFrameMetadata | null;
  currentUrl: string | null;
  canGoBack: boolean;
  canGoForward: boolean;
  error: string | null;
}

export const initialBrowserPreviewState: BrowserPreviewState = {
  open: false,
  starting: false,
  agentId: null,
  sessionId: null,
  workspaceHostname: null,
  latestFrameData: null,
  latestFrameMetadata: null,
  currentUrl: null,
  canGoBack: false,
  canGoForward: false,
  error: null,
};

export const browserPreviewReducer = createReducer(
  initialBrowserPreviewState,
  on(openBrowserPreview, (state, { agentId, sessionId }) => ({
    ...state,
    open: true,
    starting: true,
    agentId,
    sessionId,
    workspaceHostname: null,
    latestFrameData: null,
    latestFrameMetadata: null,
    currentUrl: null,
    canGoBack: false,
    canGoForward: false,
    error: null,
  })),
  on(browserPreviewStarted, (state, { sessionId, workspaceHostname }) => {
    if (state.sessionId && state.sessionId !== sessionId) {
      return state;
    }

    return {
      ...state,
      starting: false,
      sessionId,
      workspaceHostname: workspaceHostname ?? state.workspaceHostname,
      error: null,
    };
  }),
  on(browserPreviewFrameReceived, (state, { sessionId, data, metadata }) => {
    if (state.sessionId && state.sessionId !== sessionId) {
      return state;
    }

    return {
      ...state,
      starting: false,
      sessionId,
      latestFrameData: data,
      latestFrameMetadata: metadata,
    };
  }),
  on(browserPreviewLocationReceived, (state, { sessionId, url, canGoBack, canGoForward }) => {
    if (state.sessionId && state.sessionId !== sessionId) {
      return state;
    }

    return {
      ...state,
      sessionId,
      currentUrl: url,
      canGoBack,
      canGoForward,
    };
  }),
  on(stopBrowserPreview, (state) => ({
    ...state,
    starting: false,
  })),
  on(browserPreviewStopped, (state, { sessionId }) => {
    if (state.sessionId && state.sessionId !== sessionId) {
      return state;
    }

    return {
      ...initialBrowserPreviewState,
    };
  }),
  on(closeBrowserPreviewUi, () => ({
    ...initialBrowserPreviewState,
  })),
  on(browserPreviewError, (state, { error }) => ({
    ...state,
    starting: false,
    error,
  })),
);
