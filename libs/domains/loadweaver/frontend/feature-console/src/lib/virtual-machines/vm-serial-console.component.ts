import { Component, DestroyRef, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { VmConsoleSocketClient } from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcTerminalComponent,
  type FpcTerminalSize,
} from '@forepath/shared/frontend/ui-components';

/**
 * A VM's serial console (3.35) in the terminal panel: opened through `socket/consoles` the first time its tab is
 * shown, kept while the page lives (the node replays the boot log first). The page provides the socket client.
 */
@Component({
  selector: 'loadweaver-vm-serial-console',
  imports: [FpcAlertComponent, FpcBadgeComponent, FpcButtonComponent, FpcTerminalComponent],
  template: `
    <div class="d-flex flex-column h-100 min-h-0">
      <div class="d-flex flex-wrap align-items-center gap-2 px-3 py-2 border-bottom small">
        @switch (state()) {
          @case ('open') {
            <fpc-badge color="success" size="sm" i18n="@@lwConsoleVms-consoleConnected">Connected</fpc-badge>
          }
          @case ('opening') {
            <fpc-badge color="info" size="sm" i18n="@@lwConsoleVms-consoleConnecting">Connecting…</fpc-badge>
          }
          @case ('closed') {
            <fpc-badge color="secondary" size="sm" i18n="@@lwConsoleVms-consoleClosed">Closed</fpc-badge>
          }
        }
        @if (recorded()) {
          <fpc-badge color="warning" size="sm" i18n="@@lwConsoleVms-consoleRecorded">Recorded</fpc-badge>
        }
        <span class="text-body-secondary" i18n="@@lwConsoleVms-serialHint"
          >Serial console of the guest (boot log first). Press Enter if the prompt doesn't show.</span
        >
        @if (state() === 'closed') {
          <fpc-button
            class="ms-auto"
            variant="secondary"
            size="sm"
            (clicked)="reconnect()"
            data-testid="vm-serial-reconnect"
          >
            <i class="bi bi-arrow-clockwise me-1" aria-hidden="true"></i
            ><span i18n="@@lwConsoleVms-reconnect">Reconnect</span>
          </fpc-button>
        }
      </div>
      @if (error(); as message) {
        <fpc-alert class="m-3" variant="danger" [message]="message" />
      }
      <div class="flex-grow-1 position-relative min-h-0 p-2" style="min-height: 24rem">
        <fpc-terminal
          class="position-absolute top-0 start-0 w-100 h-100"
          [visible]="active()"
          [ariaLabel]="ariaLabel"
          (data)="onInput($event)"
          (sizeChange)="onResize($event)"
        />
      </div>
    </div>
  `,
  standalone: true,
})
export class LoadweaverVmSerialConsoleComponent {
  private readonly client = inject(VmConsoleSocketClient);
  private readonly terminal = viewChild(FpcTerminalComponent);

  /** `<project>/lw-vm/<name>/0`. */
  readonly replica = input.required<string>();
  /** The tab is shown: the session opens the first time. */
  readonly active = input(false);

  readonly state = signal<'idle' | 'opening' | 'open' | 'closed'>('idle');
  readonly recorded = signal(false);
  readonly error = signal<string | null>(null);
  private sessionId: string | null = null;
  private size: FpcTerminalSize | null = null;

  readonly ariaLabel = $localize`:@@lwConsoleVms-serialAria:Serial console`;

  constructor() {
    this.client.events$.pipe(takeUntilDestroyed()).subscribe((event) => {
      if (event.type === 'connection') {
        if (!event.connected && event.error && this.state() === 'opening') this.error.set(event.error);

        return;
      }

      if (!this.sessionId || ('sessionId' in event && event.sessionId && event.sessionId !== this.sessionId)) return;

      switch (event.type) {
        case 'opened':
          this.state.set('open');
          this.recorded.set(event.recorded);
          break;
        case 'output':
          if (typeof event.data === 'string') this.terminal()?.write(event.data);
          break;
        case 'closed':
          this.state.set('closed');
          this.sessionId = null;

          if (event.error) this.error.set(event.error);
          break;
        case 'error':
          this.error.set(event.message);

          if (this.state() === 'opening') this.state.set('closed');
          break;
      }
    });
    effect(() => {
      if (this.active() && this.state() === 'idle') untracked(() => void this.openSession());
    });
    inject(DestroyRef).onDestroy(() => {
      if (this.sessionId) this.client.close(this.sessionId);
    });
  }

  reconnect(): void {
    this.terminal()?.clear();
    void this.openSession();
  }

  private async openSession(): Promise<void> {
    this.error.set(null);
    this.state.set('opening');

    if (!(await this.client.connect())) {
      this.state.set('closed');

      return;
    }

    this.sessionId = this.client.open(this.replica(), 'serial', this.size ?? undefined);
  }

  onInput(data: string): void {
    if (this.sessionId && this.state() === 'open') this.client.input(this.sessionId, data);
  }

  onResize(size: FpcTerminalSize): void {
    this.size = size;

    if (this.sessionId) this.client.resize(this.sessionId, size.cols, size.rows);
  }
}
