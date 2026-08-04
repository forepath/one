import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { filter, map, tap } from 'rxjs/operators';

import { forwardedEventReceived } from '../sockets/sockets.actions';
import { SocketsFacade } from '../sockets/sockets.facade';
import type {
  BrowserPreviewFrameData,
  BrowserPreviewLocationData,
  BrowserPreviewStartedData,
  BrowserPreviewStoppedData,
  SuccessResponse,
} from '../sockets/sockets.types';
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

export const startBrowserPreview$ = createEffect(
  (actions$ = inject(Actions), socketsFacade = inject(SocketsFacade)) =>
    actions$.pipe(
      ofType(openBrowserPreview),
      tap(({ agentId, sessionId }) => {
        socketsFacade.forwardStartBrowserPreview(sessionId, agentId);
      }),
    ),
  { functional: true, dispatch: false },
);

export const stopBrowserPreview$ = createEffect(
  (actions$ = inject(Actions), socketsFacade = inject(SocketsFacade)) =>
    actions$.pipe(
      ofType(stopBrowserPreview),
      tap(({ sessionId, agentId }) => {
        socketsFacade.forwardStopBrowserPreview(sessionId, agentId);
      }),
    ),
  { functional: true, dispatch: false },
);

export const closeBrowserPreviewUiStopsSession$ = createEffect(
  (actions$ = inject(Actions), socketsFacade = inject(SocketsFacade)) =>
    actions$.pipe(
      ofType(closeBrowserPreviewUi),
      filter(({ sessionId, agentId }) => !!sessionId && !!agentId),
      tap(({ sessionId, agentId }) => {
        socketsFacade.forwardStopBrowserPreview(sessionId as string, agentId as string);
      }),
    ),
  { functional: true, dispatch: false },
);

export const onBrowserPreviewStarted$ = createEffect(
  (actions$ = inject(Actions)) =>
    actions$.pipe(
      ofType(forwardedEventReceived),
      filter(({ event }) => event === 'browserPreviewStarted'),
      map(({ payload }) => {
        const data = (payload as SuccessResponse<BrowserPreviewStartedData>).data;

        return browserPreviewStarted({
          sessionId: data.sessionId,
          workspaceHostname: data.workspaceHostname,
        });
      }),
    ),
  { functional: true },
);

export const onBrowserPreviewFrame$ = createEffect(
  (actions$ = inject(Actions)) =>
    actions$.pipe(
      ofType(forwardedEventReceived),
      filter(({ event }) => event === 'browserPreviewFrame'),
      map(({ payload }) => {
        const data = (payload as SuccessResponse<BrowserPreviewFrameData>).data;

        return browserPreviewFrameReceived({
          sessionId: data.sessionId,
          data: data.data,
          metadata: data.metadata,
        });
      }),
    ),
  { functional: true },
);

export const onBrowserPreviewStopped$ = createEffect(
  (actions$ = inject(Actions)) =>
    actions$.pipe(
      ofType(forwardedEventReceived),
      filter(({ event }) => event === 'browserPreviewStopped'),
      map(({ payload }) => {
        const data = (payload as SuccessResponse<BrowserPreviewStoppedData>).data;

        return browserPreviewStopped({ sessionId: data.sessionId });
      }),
    ),
  { functional: true },
);

export const onBrowserPreviewLocation$ = createEffect(
  (actions$ = inject(Actions)) =>
    actions$.pipe(
      ofType(forwardedEventReceived),
      filter(({ event }) => event === 'browserPreviewLocation'),
      map(({ payload }) => {
        const data = (payload as SuccessResponse<BrowserPreviewLocationData>).data;

        return browserPreviewLocationReceived({
          sessionId: data.sessionId,
          url: data.url,
          canGoBack: data.canGoBack,
          canGoForward: data.canGoForward,
        });
      }),
    ),
  { functional: true },
);

export const onBrowserPreviewSocketError$ = createEffect(
  (actions$ = inject(Actions)) =>
    actions$.pipe(
      ofType(forwardedEventReceived),
      filter(({ event, payload }) => {
        if (event !== 'error') {
          return false;
        }

        const errorPayload = payload as { error?: { code?: string; message?: string } };

        return (
          errorPayload.error?.code === 'PREVIEW_DISABLED' ||
          errorPayload.error?.code === 'PREVIEW_ERROR' ||
          errorPayload.error?.code === 'UNAUTHORIZED'
        );
      }),
      map(({ payload }) => {
        const errorPayload = payload as { error?: { message?: string } };

        return browserPreviewError({ error: errorPayload.error?.message || 'Browser preview error' });
      }),
    ),
  { functional: true },
);
