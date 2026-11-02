import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  InjectionToken,
  input,
  NgZone,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';

import type { FpcVncChannel } from './vnc-channel';

/** The part of noVNC's `RFB` the viewer uses (the package ships no typings). */
export interface FpcRfbInstance {
  scaleViewport: boolean;
  resizeSession: boolean;
  clipViewport: boolean;
  viewOnly: boolean;
  background: string;
  disconnect(): void;
  sendCtrlAltDel(): void;
  sendCredentials(credentials: { username?: string; password?: string; target?: string }): void;
  focus(): void;
  addEventListener(type: string, listener: (event: Event & { detail?: Record<string, unknown> }) => void): void;
}

export type FpcRfbConstructor = new (
  target: HTMLElement,
  urlOrChannel: string | FpcVncChannel,
  options?: { shared?: boolean; credentials?: { password?: string } },
) => FpcRfbInstance;

/** Loads noVNC's `RFB` class (lazily: the library is only fetched when a viewer connects). */
export const FPC_VNC_RFB_LOADER = new InjectionToken<() => Promise<FpcRfbConstructor>>('FPC_VNC_RFB_LOADER', {
  providedIn: 'root',
  factory: () => async () => {
    // No declaration file; whether that is an error depends on the consumer's `noImplicitAny` (hence not expect-error).
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore TS7016 - @novnc/novnc ships JavaScript only
    const mod = await import('@novnc/novnc/lib/rfb.js');

    return ((mod as { default?: FpcRfbConstructor }).default ?? mod) as FpcRfbConstructor;
  },
});

export type FpcVncState = 'idle' | 'connecting' | 'connected' | 'disconnected';

/**
 * Graphical remote console (noVNC). Generic: it takes a WebSocket-like `channel` (`FpcVncChannel`, e.g. an
 * `FpcVncChannelAdapter` over Socket.IO events) instead of a URL, so any authenticated transport works. A new
 * channel reconnects; `null` disconnects. Scales the remote screen to the container; colours follow the brand.
 */
@Component({
  selector: 'fpc-vnc-viewer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'fpc-vnc-viewer d-block position-relative',
    '[attr.data-state]': 'state()',
  },
  template: `<div
      #screen
      class="fpc-vnc-viewer__screen w-100 h-100"
      role="application"
      [attr.aria-label]="ariaLabel()"
      tabindex="0"
    ></div>
    @if (state() !== 'connected' && placeholder()) {
      <div
        class="fpc-vnc-viewer__placeholder position-absolute top-50 start-50 translate-middle text-body-secondary small"
      >
        {{ placeholder() }}
      </div>
    }`,
  styles: [
    `
      :host {
        min-height: 12rem;
        height: 100%;
        overflow: hidden;
        border-radius: var(--bs-border-radius);
        background-color: var(--bs-tertiary-bg);
      }
    `,
  ],
})
export class FpcVncViewerComponent {
  private readonly ngZone = inject(NgZone);
  private readonly loadRfb = inject(FPC_VNC_RFB_LOADER);
  private readonly screen = viewChild.required<ElementRef<HTMLDivElement>>('screen');

  /** The transport; a new channel reconnects, `null` disconnects. */
  readonly channel = input<FpcVncChannel | null>(null);
  readonly viewOnly = input(false);
  /** Scale the remote screen to fit (default) instead of clipping / scrolling. */
  readonly scale = input(true);
  /** Ask the server to resize the remote desktop to the viewer (servers that support it). */
  readonly resizeRemote = input(false);
  readonly ariaLabel = input('Remote console');
  /** Shown while not connected (e.g. "Connecting…"). */
  readonly placeholder = input<string | null>(null);

  readonly connected = output<void>();
  readonly disconnected = output<{ clean: boolean }>();
  /** The server asks for a password (`sendCredentials`). */
  readonly credentialsRequired = output<string[]>();
  readonly desktopName = output<string>();

  readonly state = signal<FpcVncState>('idle');

  private rfb: FpcRfbInstance | null = null;
  private generation = 0;

  constructor() {
    effect(() => {
      const channel = this.channel();

      untracked(() => void this.attach(channel));
    });
    effect(() => {
      const viewOnly = this.viewOnly();
      const scale = this.scale();
      const resize = this.resizeRemote();

      untracked(() => this.applyOptions(viewOnly, scale, resize));
    });
    inject(DestroyRef).onDestroy(() => {
      this.generation++;
      this.teardown();
    });
  }

  /** Ctrl+Alt+Del to the remote machine. */
  sendCtrlAltDel(): void {
    this.rfb?.sendCtrlAltDel();
  }

  sendCredentials(password: string, username?: string): void {
    this.rfb?.sendCredentials({ password, ...(username ? { username } : {}) });
  }

  focus(): void {
    this.rfb?.focus();
  }

  disconnect(): void {
    this.generation++;
    this.teardown();
    this.state.set('disconnected');
  }

  private applyOptions(viewOnly: boolean, scale: boolean, resize: boolean): void {
    if (!this.rfb) return;

    this.rfb.viewOnly = viewOnly;
    this.rfb.scaleViewport = scale;
    this.rfb.clipViewport = !scale;
    this.rfb.resizeSession = resize;
  }

  private teardown(): void {
    const rfb = this.rfb;

    this.rfb = null;

    if (rfb) {
      try {
        rfb.disconnect();
      } catch {
        // Already disconnected.
      }
    }
  }

  private async attach(channel: FpcVncChannel | null): Promise<void> {
    const generation = ++this.generation;

    this.teardown();

    if (!channel) {
      this.state.set('idle');

      return;
    }

    this.state.set('connecting');

    const RFB = await this.loadRfb();

    if (generation !== this.generation) return;

    this.ngZone.runOutsideAngular(() => {
      const rfb = new RFB(this.screen().nativeElement, channel, { shared: true });

      rfb.background = 'var(--bs-tertiary-bg)';
      this.rfb = rfb;
      this.applyOptions(this.viewOnly(), this.scale(), this.resizeRemote());
      rfb.addEventListener('connect', () =>
        this.ngZone.run(() => {
          if (this.rfb !== rfb) return;

          this.state.set('connected');
          this.connected.emit();
        }),
      );
      rfb.addEventListener('disconnect', (event) =>
        this.ngZone.run(() => {
          if (this.rfb !== rfb) return;

          this.rfb = null;
          this.state.set('disconnected');
          this.disconnected.emit({ clean: !!event.detail?.['clean'] });
        }),
      );
      rfb.addEventListener('credentialsrequired', (event) =>
        this.ngZone.run(() => this.credentialsRequired.emit((event.detail?.['types'] as string[]) ?? ['password'])),
      );
      rfb.addEventListener('desktopname', (event) =>
        this.ngZone.run(() => this.desktopName.emit(String(event.detail?.['name'] ?? ''))),
      );
    });
  }
}
