import { CommonModule } from '@angular/common';
import { Component, ElementRef, OnDestroy, effect, inject, input, signal, viewChild } from '@angular/core';
import { VncSessionsService } from '@forepath/agenstra/frontend/data-access-agent-console';
import { FpcEmptyStateComponent } from '@forepath/shared/frontend/ui-components';

import { loadNovncRfb, type NovncRfbInstance } from './load-novnc-rfb';

@Component({
  selector: 'framework-virtual-desktop',
  imports: [CommonModule, FpcEmptyStateComponent],
  templateUrl: './virtual-desktop.component.html',
  styleUrls: ['./virtual-desktop.component.scss'],
  standalone: true,
})
export class VirtualDesktopComponent implements OnDestroy {
  private readonly vncSessionsService = inject(VncSessionsService);

  clientId = input.required<string>();
  agentId = input.required<string>();

  private readonly screenHost = viewChild<ElementRef<HTMLDivElement>>('screenHost');

  readonly connecting = signal(true);
  readonly connected = signal(false);
  readonly errorMessage = signal<string | null>(null);

  readonly connectingLabel = $localize`:@@featureVirtualDesktop-connecting:Connecting to desktop…`;
  readonly errorTitle = $localize`:@@featureVirtualDesktop-errorTitle:Desktop unavailable`;

  private rfb: NovncRfbInstance | null = null;
  private connectGeneration = 0;

  constructor() {
    effect(() => {
      const clientId = this.clientId();
      const agentId = this.agentId();

      if (clientId && agentId) {
        void this.connect(clientId, agentId);
      }
    });
  }

  ngOnDestroy(): void {
    this.disconnect();
  }

  onReconnect(): void {
    void this.connect(this.clientId(), this.agentId());
  }

  private async connect(clientId: string, agentId: string): Promise<void> {
    const generation = ++this.connectGeneration;

    this.disconnect();
    this.connecting.set(true);
    this.connected.set(false);
    this.errorMessage.set(null);

    try {
      const session = await new Promise<{ ticket: string; expiresIn: number }>((resolve, reject) => {
        this.vncSessionsService.createSession(clientId, agentId).subscribe({
          next: resolve,
          error: reject,
        });
      });

      if (generation !== this.connectGeneration) {
        return;
      }

      const host = this.screenHost()?.nativeElement;

      if (!host) {
        throw new Error('Desktop screen host is not ready');
      }

      const websocketBase = this.vncSessionsService.resolveWebsocketBaseUrl();

      if (!websocketBase) {
        throw new Error('VNC websocket URL is not configured');
      }

      host.replaceChildren();

      const RFB = await loadNovncRfb();
      const wsUrl = this.vncSessionsService.buildWebsocketUrl(websocketBase);

      this.rfb = new RFB(host, wsUrl, {
        wsProtocols: this.vncSessionsService.buildWebsocketProtocols(session.ticket),
      });
      this.rfb.scaleViewport = true;
      this.rfb.resizeSession = true;
      this.rfb.clipViewport = true;

      this.rfb.addEventListener('connect', () => {
        if (generation !== this.connectGeneration) {
          return;
        }

        this.connecting.set(false);
        this.connected.set(true);
        this.errorMessage.set(null);
      });

      this.rfb.addEventListener('disconnect', () => {
        if (generation !== this.connectGeneration) {
          return;
        }

        this.connecting.set(false);
        this.connected.set(false);
      });

      this.rfb.addEventListener('securityfailure', () => {
        if (generation !== this.connectGeneration) {
          return;
        }

        this.connecting.set(false);
        this.connected.set(false);
        this.errorMessage.set($localize`:@@featureVirtualDesktop-securityFailure:Desktop authentication failed`);
      });
    } catch (error) {
      if (generation !== this.connectGeneration) {
        return;
      }

      this.connecting.set(false);
      this.connected.set(false);
      this.errorMessage.set(
        (error as { message?: string })?.message ||
          $localize`:@@featureVirtualDesktop-genericError:Failed to open virtual desktop`,
      );
    }
  }

  private disconnect(): void {
    if (this.rfb) {
      try {
        this.rfb.disconnect();
      } catch {
        // ignore
      }

      this.rfb = null;
    }
  }
}
