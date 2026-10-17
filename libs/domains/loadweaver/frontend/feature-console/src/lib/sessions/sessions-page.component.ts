import { CommonModule, DOCUMENT } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import {
  apiErrorMessage,
  ConsoleAccessFacade,
  ConsoleLiveFacade,
  isReplicaId,
  LiveService,
  parseAsciicast,
  type Asciicast,
  type LiveReplicaTarget,
  type TerminalSessionRecord,
  type TunnelRecord,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcEmptyStateComponent,
  FpcPageHeaderComponent,
  FpcSpinnerComponent,
} from '@forepath/shared/frontend/ui-components';
import { firstValueFrom } from 'rxjs';

import { sessionDuration, portForwardCommand, replicaGroups, saveFile, sessionTargetLabel } from '../live/live-format';
import { LoadweaverCastPlayerComponent } from './cast-player.component';

/**
 * Terminal sessions and tunnels (3.19): the audited session records with their recordings (download, or replay in the
 * browser), the open debug tunnels, and the CLI command that opens one (tunnels aren't opened from the browser).
 */
@Component({
  selector: 'loadweaver-sessions-page',
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcEmptyStateComponent,
    FpcPageHeaderComponent,
    FpcSpinnerComponent,
    LoadweaverCastPlayerComponent,
  ],
  templateUrl: './sessions-page.component.html',
  standalone: true,
})
export class LoadweaverSessionsPageComponent implements OnInit {
  private readonly live = inject(ConsoleLiveFacade);
  private readonly access = inject(ConsoleAccessFacade);
  private readonly service = inject(LiveService);
  private readonly route = inject(ActivatedRoute);
  private readonly document = inject(DOCUMENT);

  readonly sessions = toSignal(this.live.sessions$, { initialValue: [] as TerminalSessionRecord[] });
  readonly sessionsLoading = toSignal(this.live.sessionsLoading$, { initialValue: false });
  readonly sessionsError = toSignal(this.live.sessionsError$, { initialValue: null });
  readonly tunnels = toSignal(this.live.tunnels$, { initialValue: [] as TunnelRecord[] });
  readonly tunnelsLoading = toSignal(this.live.tunnelsLoading$, { initialValue: false });
  readonly tunnelsError = toSignal(this.live.tunnelsError$, { initialValue: null });
  readonly replicas = toSignal(this.live.replicas$, { initialValue: [] as LiveReplicaTarget[] });
  readonly projects = toSignal(this.access.projects$, { initialValue: [] as string[] });

  readonly project = signal('');
  readonly playing = signal<{ session: TerminalSessionRecord; cast: Asciicast } | null>(null);
  readonly loadingRecording = signal<string | null>(null);
  readonly recordingError = signal<string | null>(null);
  readonly forwardReplica = signal('');
  readonly remotePort = signal<number | null>(null);
  readonly localPort = signal<number | null>(null);
  readonly ttl = signal<number | null>(null);
  readonly copied = signal(false);

  readonly groups = computed(() => replicaGroups(this.replicas(), null));
  readonly command = computed(() =>
    isReplicaId(this.forwardReplica())
      ? portForwardCommand(this.forwardReplica(), this.remotePort(), this.localPort(), this.ttl())
      : null,
  );

  readonly targetLabel = sessionTargetLabel;
  readonly duration = sessionDuration;

  readonly title = $localize`:@@lwConsoleSessions-title:Sessions and tunnels`;
  readonly refreshLabel = $localize`:@@lwConsoleSessions-refresh:Refresh`;
  readonly playLabel = $localize`:@@lwConsoleSessions-play:Replay`;
  readonly downloadLabel = $localize`:@@lwConsoleSessions-download:Download recording`;
  readonly copyLabel = $localize`:@@lwConsoleSessions-copy:Copy`;
  readonly copiedLabel = $localize`:@@lwConsoleSessions-copied:Copied`;

  ngOnInit(): void {
    const params = this.route.snapshot.queryParamMap;
    const replica = params.get('replica');
    const project = params.get('project') ?? '';

    if (isReplicaId(replica)) this.forwardReplica.set(replica);

    this.project.set(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(project) ? project : '');
    this.live.loadTargets();
    this.live.loadSessions(this.project() || null);
    this.live.loadTunnels();
  }

  onProjectChange(project: string): void {
    this.project.set(project);
    this.live.loadSessions(project || null);
  }

  refresh(): void {
    this.live.loadSessions(this.project() || null);
    this.live.loadTunnels();
  }

  async play(session: TerminalSessionRecord): Promise<void> {
    this.loadingRecording.set(session.id);
    this.recordingError.set(null);

    try {
      const cast = parseAsciicast(await firstValueFrom(this.service.recording(session.id)));

      this.playing.set({ session, cast });
    } catch (error) {
      this.recordingError.set(apiErrorMessage(error, 'Failed to load the recording'));
    } finally {
      this.loadingRecording.set(null);
    }
  }

  async download(session: TerminalSessionRecord): Promise<void> {
    this.loadingRecording.set(session.id);
    this.recordingError.set(null);

    try {
      const cast = await firstValueFrom(this.service.recording(session.id));

      saveFile(this.document, cast, `session-${session.id}.cast`);
    } catch (error) {
      this.recordingError.set(apiErrorMessage(error, 'Failed to download the recording'));
    } finally {
      this.loadingRecording.set(null);
    }
  }

  closePlayer(): void {
    this.playing.set(null);
  }

  port(value: string | number | null): number | null {
    const port = Number(value);

    return Number.isInteger(port) && port > 0 && port < 65536 ? port : null;
  }

  ttlSeconds(value: string | number | null): number | null {
    const ttl = Number(value);

    return Number.isInteger(ttl) && ttl >= 60 && ttl <= 28800 ? ttl : null;
  }

  async copy(): Promise<void> {
    const command = this.command();
    const clipboard = this.document.defaultView?.navigator?.clipboard;

    if (!command || !clipboard) return;

    await clipboard.writeText(command).catch(() => undefined);
    this.copied.set(true);
    setTimeout(() => this.copied.set(false), 2000);
  }

  expired(tunnel: TunnelRecord): boolean {
    return new Date(tunnel.expiresAt).getTime() < Date.now();
  }
}
