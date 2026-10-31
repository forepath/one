import { Component, DestroyRef, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { VmConsoleSocketClient } from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcVncChannelAdapter,
  FpcVncViewerComponent,
} from '@forepath/shared/frontend/ui-components';

/**
 * A VM's graphical console (3.35): noVNC (`fpc-vnc-viewer`) over a `socket/consoles` session — the channel adapter
 * carries the raw RFB bytes as `consoleInput` / `consoleOutput`. Opened the first time its tab is shown.
 */
@Component({
  selector: 'loadweaver-vm-vnc-console',
  imports: [FpcAlertComponent, FpcBadgeComponent, FpcButtonComponent, FpcVncViewerComponent],
  template: `
    <div class="d-flex flex-column h-100 min-h-0">
      <div class="d-flex flex-wrap align-items-center gap-2 px-3 py-2 border-bottom small">
        @if (viewerConnected()) {
          <fpc-badge tone="success" i18n="@@lwConsoleVms-consoleConnected">Connected</fpc-badge>
        } @else if (channel()) {
          <fpc-badge tone="info" i18n="@@lwConsoleVms-consoleConnecting">Connecting…</fpc-badge>
        } @else {
          <fpc-badge tone="neutral" i18n="@@lwConsoleVms-consoleClosed">Closed</fpc-badge>
        }
        <span class="text-body-secondary" i18n="@@lwConsoleVms-vncHint"
          >Graphical console of the guest. The session isn't recorded; its start and end are audited.</span
        >
        <div class="ms-auto d-flex gap-2">
          <fpc-button
            variant="secondary"
            size="sm"
            [disabled]="!viewerConnected()"
            (clicked)="ctrlAltDel()"
            data-testid="vm-vnc-cad"
            iconOnly
            ariaLabel="Ctrl+Alt+Del"
            i18n-ariaLabel="@@lwConsoleVms-ctrlAltDel"
            title="Ctrl+Alt+Del"
            i18n-title="@@lwConsoleVms-ctrlAltDel"
          >
            <i class="bi bi-keyboard" aria-hidden="true"></i>
          </fpc-button>
          @if (!channel()) {
            <fpc-button
              variant="secondary"
              size="sm"
              (clicked)="reconnect()"
              data-testid="vm-vnc-reconnect"
              iconOnly
              ariaLabel="Reconnect"
              i18n-ariaLabel="@@lwConsoleVms-reconnect"
              title="Reconnect"
              i18n-title="@@lwConsoleVms-reconnect"
            >
              <i class="bi bi-arrow-clockwise" aria-hidden="true"></i>
            </fpc-button>
          }
        </div>
      </div>
      @if (error(); as message) {
        <fpc-alert [flush]="true" variant="danger" [message]="message" />
      }
      <div class="flex-grow-1 min-h-0 p-2">
        <fpc-vnc-viewer
          class="h-100"
          [channel]="channel()"
          [ariaLabel]="ariaLabel"
          [placeholder]="placeholder"
          (connected)="viewerConnected.set(true)"
          (disconnected)="onViewerDisconnected()"
        />
      </div>
    </div>
  `,
  standalone: true,
})
export class LoadweaverVmVncConsoleComponent {
  private readonly client = inject(VmConsoleSocketClient);
  private readonly viewer = viewChild(FpcVncViewerComponent);

  readonly replica = input.required<string>();
  readonly active = input(false);

  readonly channel = signal<FpcVncChannelAdapter | null>(null);
  readonly viewerConnected = signal(false);
  readonly error = signal<string | null>(null);
  private sessionId: string | null = null;
  private started = false;

  readonly ariaLabel = $localize`:@@lwConsoleVms-vncAria:Graphical console`;
  readonly placeholder = $localize`:@@lwConsoleVms-vncPlaceholder:Waiting for the graphical console…`;

  constructor() {
    this.client.events$.pipe(takeUntilDestroyed()).subscribe((event) => {
      const channel = this.channel();

      if (event.type === 'connection') {
        if (!event.connected && channel) channel.failed(event.error ?? 'connection lost');

        return;
      }

      if (!this.sessionId || ('sessionId' in event && event.sessionId && event.sessionId !== this.sessionId)) return;

      switch (event.type) {
        case 'opened':
          channel?.opened();
          break;
        case 'output':
          if (typeof event.data !== 'string') channel?.deliver(event.data);
          break;
        case 'closed':
          this.sessionId = null;

          if (event.error) this.error.set(event.error);

          channel?.closed(1000, event.error ?? '');
          this.channel.set(null);
          break;
        case 'error':
          this.error.set(event.message);
          channel?.failed(event.message);
          this.sessionId = null;
          this.channel.set(null);
          break;
      }
    });
    effect(() => {
      if (this.active() && !this.started) untracked(() => void this.openSession());
    });
    inject(DestroyRef).onDestroy(() => {
      if (this.sessionId) this.client.close(this.sessionId);
    });
  }

  ctrlAltDel(): void {
    this.viewer()?.sendCtrlAltDel();
  }

  reconnect(): void {
    void this.openSession();
  }

  onViewerDisconnected(): void {
    this.viewerConnected.set(false);

    if (this.sessionId) this.client.close(this.sessionId);

    this.sessionId = null;
    this.channel.set(null);
  }

  private async openSession(): Promise<void> {
    this.started = true;
    this.error.set(null);
    this.viewerConnected.set(false);

    if (!(await this.client.connect())) {
      this.error.set($localize`:@@lwConsoleVms-noConnection:No console connection (not signed in?)`);

      return;
    }

    const sessionId = this.client.open(this.replica(), 'vnc');

    this.sessionId = sessionId;
    this.channel.set(
      new FpcVncChannelAdapter({
        send: (data) => this.client.input(sessionId, data),
        close: () => {
          if (this.sessionId === sessionId) {
            this.client.close(sessionId);
            this.sessionId = null;
          }
        },
      }),
    );
  }
}
