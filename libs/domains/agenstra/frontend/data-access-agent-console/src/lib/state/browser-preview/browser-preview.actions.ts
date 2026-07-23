import { createAction, props } from '@ngrx/store';

export const openBrowserPreview = createAction(
  '[Browser Preview] Open',
  props<{ agentId: string; sessionId: string }>(),
);

export const browserPreviewStarted = createAction(
  '[Browser Preview] Started',
  props<{ sessionId: string; workspaceHostname?: string }>(),
);

export const browserPreviewFrameReceived = createAction(
  '[Browser Preview] Frame Received',
  props<{
    sessionId: string;
    data: string;
    metadata: {
      offsetTop: number;
      pageScaleFactor: number;
      deviceWidth: number;
      deviceHeight: number;
      scrollOffsetX: number;
      scrollOffsetY: number;
      timestamp: number;
    };
  }>(),
);

export const browserPreviewLocationReceived = createAction(
  '[Browser Preview] Location Received',
  props<{ sessionId: string; url: string; canGoBack: boolean; canGoForward: boolean }>(),
);

export const stopBrowserPreview = createAction(
  '[Browser Preview] Stop',
  props<{ sessionId: string; agentId: string }>(),
);

export const browserPreviewStopped = createAction('[Browser Preview] Stopped', props<{ sessionId: string }>());

export const browserPreviewError = createAction('[Browser Preview] Error', props<{ error: string }>());

export const closeBrowserPreviewUi = createAction(
  '[Browser Preview] Close UI',
  props<{ sessionId: string | null; agentId: string | null }>(),
);
