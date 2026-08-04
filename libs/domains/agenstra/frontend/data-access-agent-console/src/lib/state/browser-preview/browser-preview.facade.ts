import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { take } from 'rxjs/operators';

import { SocketsFacade } from '../sockets/sockets.facade';
import { closeBrowserPreviewUi, openBrowserPreview, stopBrowserPreview } from './browser-preview.actions';
import {
  selectBrowserPreviewAgentId,
  selectBrowserPreviewCanGoBack,
  selectBrowserPreviewCanGoForward,
  selectBrowserPreviewCurrentUrl,
  selectBrowserPreviewError,
  selectBrowserPreviewFrameData,
  selectBrowserPreviewFrameMetadata,
  selectBrowserPreviewOpen,
  selectBrowserPreviewSessionId,
  selectBrowserPreviewStarting,
  selectBrowserPreviewWorkspaceHostname,
} from './browser-preview.selectors';

@Injectable()
export class BrowserPreviewFacade {
  private readonly store = inject(Store);
  private readonly socketsFacade = inject(SocketsFacade);

  readonly open$ = this.store.select(selectBrowserPreviewOpen);
  readonly starting$ = this.store.select(selectBrowserPreviewStarting);
  readonly sessionId$ = this.store.select(selectBrowserPreviewSessionId);
  readonly agentId$ = this.store.select(selectBrowserPreviewAgentId);
  readonly frameData$ = this.store.select(selectBrowserPreviewFrameData);
  readonly frameMetadata$ = this.store.select(selectBrowserPreviewFrameMetadata);
  readonly currentUrl$ = this.store.select(selectBrowserPreviewCurrentUrl);
  readonly workspaceHostname$ = this.store.select(selectBrowserPreviewWorkspaceHostname);
  readonly canGoBack$ = this.store.select(selectBrowserPreviewCanGoBack);
  readonly canGoForward$ = this.store.select(selectBrowserPreviewCanGoForward);
  readonly error$ = this.store.select(selectBrowserPreviewError);

  openPreview(agentId: string): void {
    const sessionId = `preview-${agentId}-${Date.now()}`;

    this.store.dispatch(openBrowserPreview({ agentId, sessionId }));
  }

  stopPreview(sessionId: string, agentId: string): void {
    this.store.dispatch(stopBrowserPreview({ sessionId, agentId }));
  }

  closePreview(): void {
    let sessionId: string | null = null;
    let agentId: string | null = null;

    this.store
      .select(selectBrowserPreviewSessionId)
      .pipe(take(1))
      .subscribe((value) => {
        sessionId = value;
      });
    this.store
      .select(selectBrowserPreviewAgentId)
      .pipe(take(1))
      .subscribe((value) => {
        agentId = value;
      });

    this.store.dispatch(closeBrowserPreviewUi({ sessionId, agentId }));
  }

  sendMouseInput(sessionId: string, agentId: string, event: Record<string, unknown>): void {
    this.socketsFacade.forwardBrowserPreviewInput(sessionId, 'mouse', event, agentId);
  }

  sendKeyInput(sessionId: string, agentId: string, event: Record<string, unknown>): void {
    this.socketsFacade.forwardBrowserPreviewInput(sessionId, 'key', event, agentId);
  }

  navigate(sessionId: string, agentId: string, url: string): void {
    this.socketsFacade.forwardBrowserPreviewCommand(sessionId, 'navigate', agentId, url);
  }

  reload(sessionId: string, agentId: string): void {
    this.socketsFacade.forwardBrowserPreviewCommand(sessionId, 'reload', agentId);
  }

  goBack(sessionId: string, agentId: string): void {
    this.socketsFacade.forwardBrowserPreviewCommand(sessionId, 'back', agentId);
  }

  goForward(sessionId: string, agentId: string): void {
    this.socketsFacade.forwardBrowserPreviewCommand(sessionId, 'forward', agentId);
  }
}
