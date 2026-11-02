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
  fpcCopyText,
  FpcDataTableComponent,
  FpcListToolbarComponent,
  fpcListQueryState,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcPageHeaderComponent,
  FpcSectionRowComponent,
  FpcTabComponent,
  FpcTabGroupComponent,
  FpcTableCellDirective,
  type FpcMenuItem,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';
import { firstValueFrom } from 'rxjs';

import { filterBySearch, NO_MATCHES_HINT, NO_MATCHES_TITLE } from '../list-search';
import { dlCopyIdItem, dlUserLabel } from '../section/data-list';
import { LoadweaverLaneComponent } from '../section/lane.component';
import { sessionDuration, portForwardCommand, replicaGroups, saveFile, sessionTargetLabel } from '../live/live-format';
import { LoadweaverCastPlayerComponent } from './cast-player.component';
import { savedViewBinding } from '../views/saved-views';
import { LoadweaverSavedViewsComponent } from '../views/saved-views.component';

/**
 * Terminal sessions and tunnels (3.19): the audited session records with their recordings (download, or replay in the
 * browser), the open debug tunnels, and the CLI command that opens one (tunnels aren't opened from the browser).
 */
@Component({
  selector: 'loadweaver-sessions-page',
  imports: [
    LoadweaverSavedViewsComponent,
    CommonModule,
    FormsModule,
    RouterModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcDataTableComponent,
    FpcListToolbarComponent,
    FpcEmptyStateComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcPageHeaderComponent,
    FpcSectionRowComponent,
    FpcTabComponent,
    FpcTabGroupComponent,
    FpcTableCellDirective,
    LoadweaverLaneComponent,
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
  readonly filtersOpen = signal(false);
  readonly search = signal('');
  /** "Views ▾" (3.37): saved search / filters of this list, per user. */
  readonly tunnelSearch = signal('');
  readonly views = savedViewBinding(
    { project: this.project, search: this.search, tunnelSearch: this.tunnelSearch },
    () => this.refresh(),
  );
  /** Phone lane (the player lane only while a recording plays). */
  readonly lane = signal<'player' | 'sessions' | 'tunnels'>('sessions');
  readonly activeLane = computed(() => (this.lane() === 'player' && !this.playing() ? 'sessions' : this.lane()));
  readonly filteredSessions = computed(() =>
    filterBySearch(this.sessions(), this.search(), (s) => [
      sessionTargetLabel(s),
      s.target,
      s.node,
      dlUserLabel(s.userId, s.userEmail),
      s.userId,
    ]),
  );
  readonly filteredTunnels = computed(() =>
    filterBySearch(this.tunnels(), this.tunnelSearch(), (t) => [
      t.replica,
      t.port,
      t.node,
      dlUserLabel(t.userId, t.userEmail),
      t.userId,
    ]),
  );
  readonly forwardOpen = signal(false);

  readonly groups = computed(() => replicaGroups(this.replicas(), null));
  readonly command = computed(() =>
    isReplicaId(this.forwardReplica())
      ? portForwardCommand(this.forwardReplica(), this.remotePort(), this.localPort(), this.ttl())
      : null,
  );

  readonly targetLabel = sessionTargetLabel;
  readonly duration = sessionDuration;

  /** Applied filters (+ search) in the URL; the drawer edits a draft until Apply (3.38 R12). */
  readonly filterState = fpcListQueryState({
    filters: { project: this.project },
    search: this.search,
    open: this.filtersOpen,
    changed: () => this.live.loadSessions(this.project() || null),
  });
  readonly title = $localize`:@@lwConsoleSessions-title:Sessions and tunnels`;
  readonly refreshLabel = $localize`:@@lwConsoleSessions-refresh:Refresh`;
  readonly searchLabel = $localize`:@@lwConsoleSessions-searchSessions:Search sessions`;
  readonly tunnelSearchLabel = $localize`:@@lwConsoleSessions-searchTunnels:Search tunnels`;
  readonly noMatchesTitle = NO_MATCHES_TITLE;
  readonly noMatchesHint = NO_MATCHES_HINT;
  readonly playLabel = $localize`:@@lwConsoleSessions-play:Replay`;
  readonly downloadLabel = $localize`:@@lwConsoleSessions-download:Download recording`;
  readonly copyLabel = $localize`:@@lwConsoleSessions-copy:Copy`;
  readonly copiedLabel = $localize`:@@lwConsoleSessions-copied:Copied`;
  readonly projectLabel = $localize`:@@lwConsoleSessions-project:Project`;
  readonly closePlayerLabel = $localize`:@@lwConsoleSessions-closePlayer:Close player`;
  readonly sessionsTitle = $localize`:@@lwConsoleSessions-sessions:Terminal sessions`;
  readonly tunnelsTitle = $localize`:@@lwConsoleSessions-tunnels:Open debug tunnels`;
  readonly forwardTitle = $localize`:@@lwConsoleSessions-forwardTitle:Open a tunnel`;
  readonly forwardReplicaLabel = $localize`:@@lwConsoleSessions-forwardReplica:Replica`;
  readonly remotePortLabel = $localize`:@@lwConsoleSessions-remotePort:Replica port`;
  readonly localPortLabel = $localize`:@@lwConsoleSessions-localPort:Local port`;
  readonly ttlLabel = $localize`:@@lwConsoleSessions-ttl:TTL (seconds)`;
  readonly closeLabel = $localize`:@@lwConsoleSessions-close:Close`;
  readonly runningLabel = $localize`:@@lwConsoleSessions-running:running`;
  readonly recordedPendingLabel = $localize`:@@lwConsoleSessions-recordedPending:recorded (stored when it ends)`;
  readonly loadingSessionsLabel = $localize`:@@lwConsoleSessions-loadingSessions:Loading terminal sessions`;
  readonly tableLabels = { refresh: this.refreshLabel, empty: NO_MATCHES_TITLE };
  /** 3.38 D1: State (running / exit) · Target · started · node · user · duration · recording (Play inline). */
  readonly sessionColumns: FpcTableColumn<TerminalSessionRecord>[] = [
    {
      id: 'state',
      label: $localize`:@@lwConsoleSessions-colState:State`,
      type: 'state',
      state: (s) =>
        !s.endedAt
          ? { label: this.runningLabel, tone: 'primary', icon: 'play-circle' }
          : s.exitCode === null || s.exitCode === undefined || s.exitCode === 0
            ? { label: $localize`:@@lwConsoleSessions-stateEnded:Ended`, tone: 'success' }
            : { label: $localize`:@@lwConsoleSessions-stateFailed:Exited with an error`, tone: 'warning' },
    },
    {
      id: 'started',
      label: $localize`:@@lwConsoleSessions-colStarted:Started`,
      value: (s) => s.startedAt,
      width: '11rem',
    },
    {
      id: 'target',
      label: $localize`:@@lwConsoleSessions-colTarget:Target`,
      value: (s) => sessionTargetLabel(s),
      required: true,
      priority: 1,
    },
    { id: 'node', label: $localize`:@@lwConsoleSessions-colNode:Node`, value: (s) => s.node },
    {
      id: 'user',
      label: $localize`:@@lwConsoleSessions-colUser:User`,
      value: (s) => dlUserLabel(s.userId, s.userEmail) || '—',
    },
    {
      id: 'duration',
      label: $localize`:@@lwConsoleSessions-colDuration:Duration`,
      value: (s) => (s.endedAt ? new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime() : null),
      align: 'end',
    },
    {
      id: 'exit',
      label: $localize`:@@lwConsoleSessions-colExit:Exit`,
      value: (s) => s.exitCode ?? '',
      align: 'end',
      mono: true,
    },
    { id: 'recording', label: $localize`:@@lwConsoleSessions-colRecording:Recording`, align: 'end' },
  ];
  /** State (open / expired) · Replica · port · node · user · opened · expires. */
  readonly tunnelColumns: FpcTableColumn<TunnelRecord>[] = [
    {
      id: 'state',
      label: $localize`:@@lwConsoleSessions-colState:State`,
      type: 'state',
      state: (t) =>
        this.expired(t)
          ? { label: $localize`:@@lwConsoleSessions-tunnelExpired:Expired`, tone: 'neutral' }
          : { label: $localize`:@@lwConsoleSessions-tunnelOpen:Open`, tone: 'success', icon: 'ethernet' },
    },
    {
      id: 'replica',
      label: $localize`:@@lwConsoleSessions-colReplica:Replica`,
      value: (t) => t.replica,
      mono: true,
      required: true,
      priority: 1,
    },
    {
      id: 'port',
      label: $localize`:@@lwConsoleSessions-colPort:Port`,
      value: (t) => t.port,
      align: 'end',
      mono: true,
    },
    { id: 'node', label: $localize`:@@lwConsoleSessions-colNode:Node`, value: (t) => t.node },
    {
      id: 'user',
      label: $localize`:@@lwConsoleSessions-colUser:User`,
      value: (t) => dlUserLabel(t.userId, t.userEmail) || '—',
    },
    { id: 'opened', label: $localize`:@@lwConsoleSessions-colOpened:Opened`, value: (t) => t.openedAt },
    { id: 'expires', label: $localize`:@@lwConsoleSessions-colExpires:Expires`, value: (t) => t.expiresAt },
  ];

  readonly sessionMenu = (s: TerminalSessionRecord): FpcMenuItem[] => [
    ...(s.hasRecording
      ? [
          { id: 'play', label: this.playLabel, icon: 'play-fill' },
          { id: 'download', label: this.downloadLabel, icon: 'download' },
        ]
      : []),
    { ...dlCopyIdItem(), dividerBefore: s.hasRecording },
  ];
  readonly tunnelMenu = (): FpcMenuItem[] => [dlCopyIdItem()];

  onSessionAction(session: TerminalSessionRecord, action: string): void {
    if (action === 'play') void this.play(session);
    else if (action === 'download') void this.download(session);
    else if (action === 'copy-id') fpcCopyText(session.id);
  }

  onTunnelAction(tunnel: TunnelRecord, action: string): void {
    if (action === 'copy-id') fpcCopyText(tunnel.id);
  }

  ngOnInit(): void {
    const params = this.route.snapshot.queryParamMap;
    const replica = params.get('replica');
    const project = params.get('project') ?? '';

    // A deep-linked replica opens the port-forward dialog with it.
    if (isReplicaId(replica)) {
      this.forwardReplica.set(replica);
      this.forwardOpen.set(true);
    }

    this.project.set(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(project) ? project : '');
    this.live.loadTargets();
    this.live.loadSessions(this.project() || null);
    this.live.loadTunnels();
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
      this.lane.set('player');
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
