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
import { browserPreviewReducer, initialBrowserPreviewState } from './browser-preview.reducer';

describe('browserPreviewReducer', () => {
  it('should open preview and mark starting', () => {
    const state = browserPreviewReducer(
      initialBrowserPreviewState,
      openBrowserPreview({ agentId: 'a1', sessionId: 's1' }),
    );

    expect(state.open).toBe(true);
    expect(state.starting).toBe(true);
    expect(state.agentId).toBe('a1');
    expect(state.sessionId).toBe('s1');
  });

  it('should store frames for the active session', () => {
    const opened = browserPreviewReducer(
      initialBrowserPreviewState,
      openBrowserPreview({ agentId: 'a1', sessionId: 's1' }),
    );
    const framed = browserPreviewReducer(
      opened,
      browserPreviewFrameReceived({
        sessionId: 's1',
        data: 'abc',
        metadata: {
          offsetTop: 0,
          pageScaleFactor: 1,
          deviceWidth: 800,
          deviceHeight: 600,
          scrollOffsetX: 0,
          scrollOffsetY: 0,
          timestamp: 1,
        },
      }),
    );

    expect(framed.latestFrameData).toBe('abc');
    expect(framed.starting).toBe(false);
    expect(framed.latestFrameMetadata?.deviceWidth).toBe(800);
  });

  it('should ignore frames for other sessions', () => {
    const opened = browserPreviewReducer(
      initialBrowserPreviewState,
      openBrowserPreview({ agentId: 'a1', sessionId: 's1' }),
    );
    const framed = browserPreviewReducer(
      opened,
      browserPreviewFrameReceived({
        sessionId: 'other',
        data: 'abc',
        metadata: {
          offsetTop: 0,
          pageScaleFactor: 1,
          deviceWidth: 800,
          deviceHeight: 600,
          scrollOffsetX: 0,
          scrollOffsetY: 0,
          timestamp: 1,
        },
      }),
    );

    expect(framed.latestFrameData).toBeNull();
  });

  it('should store location for the active session', () => {
    const opened = browserPreviewReducer(
      initialBrowserPreviewState,
      openBrowserPreview({ agentId: 'a1', sessionId: 's1' }),
    );
    const located = browserPreviewReducer(
      opened,
      browserPreviewLocationReceived({
        sessionId: 's1',
        url: 'https://example.com/',
        canGoBack: true,
        canGoForward: false,
      }),
    );

    expect(located.currentUrl).toBe('https://example.com/');
    expect(located.canGoBack).toBe(true);
    expect(located.canGoForward).toBe(false);
  });

  it('should reset on stopped and close', () => {
    const opened = browserPreviewReducer(
      initialBrowserPreviewState,
      openBrowserPreview({ agentId: 'a1', sessionId: 's1' }),
    );
    const started = browserPreviewReducer(opened, browserPreviewStarted({ sessionId: 's1' }));
    const stopped = browserPreviewReducer(started, browserPreviewStopped({ sessionId: 's1' }));

    expect(stopped).toEqual(initialBrowserPreviewState);

    const reopened = browserPreviewReducer(
      initialBrowserPreviewState,
      openBrowserPreview({ agentId: 'a1', sessionId: 's2' }),
    );
    const closed = browserPreviewReducer(reopened, closeBrowserPreviewUi({ sessionId: 's2', agentId: 'a1' }));

    expect(closed).toEqual(initialBrowserPreviewState);
  });

  it('should keep session while stopping and record errors', () => {
    const opened = browserPreviewReducer(
      initialBrowserPreviewState,
      openBrowserPreview({ agentId: 'a1', sessionId: 's1' }),
    );
    const stopping = browserPreviewReducer(opened, stopBrowserPreview({ sessionId: 's1', agentId: 'a1' }));
    const errored = browserPreviewReducer(stopping, browserPreviewError({ error: 'fail' }));

    expect(stopping.starting).toBe(false);
    expect(errored.error).toBe('fail');
  });
});
