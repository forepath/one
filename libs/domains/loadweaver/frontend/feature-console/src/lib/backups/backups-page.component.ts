import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import {
  backupTimeline,
  ConsoleAccessFacade,
  ConsoleBackupsFacade,
  ConsoleLiveFacade,
  type Backup,
  BackupsService,
  type BackupVolume,
  type LiveVolumeTarget,
  type RestoreTestStatus,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  fpcCopyText,
  FpcDataTableComponent,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcLaneHeaderComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  fpcListQueryState,
  fpcRunBulk,
  FpcTableCellDirective,
  FpcTableRowDetailDirective,
  type FpcMenuItem,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';
import { interval } from 'rxjs';

import { filterBySearch } from '../list-search';
import { CREATE_HINT } from '../nav/create-kinds';
import { dlBulkSummary, dlCopyIdItem, dlOpenItem } from '../section/data-list';
import { MasterDetailState } from '../section/master-detail.component';
import { formatBytes } from '../overview/console-format';
import {
  BACKUP_STATUS_TONE,
  backupStatusLabel,
  BACKUPS_IDLE_POLL_TICKS,
  BACKUPS_POLL_MS,
  canAdminister,
  canOperate,
  catalogVolumeInResource,
  isLocked,
  keepReasonLabel,
  RESTORE_TEST_TONE,
  restoreTestLabel,
} from './backup-format';
import { LoadweaverBackupRestoreModalComponent } from './backup-restore-modal.component';
import { injectSectionScope, sectionQuery } from '../section/section-scope';
import { savedViewBinding } from '../views/saved-views';
import { LoadweaverSavedViewsComponent } from '../views/saved-views.component';

/** A volume the catalog lists: with backups, or (from the topology) without any yet. */
export interface CatalogVolume extends BackupVolume {
  /** Only known from the topology. */
  empty: boolean;
}

/**
 * Backups (3.20): the catalog as a table of volumes (3.38 D1; bulk Back up now); a volume's row detail holds its
 * timeline and its backups as a nested table (status, size, retention, restore test, immutability, targets) with the
 * actions per backup in ⋮ (browse, diff, restore, restore test, deletion request) and as bulk actions (restore test,
 * one deletion request for the selection). The list of the Backups master-detail shell (3.38): the page
 * header, pins, kit warning and KPI bar sit in the shell's full-width summary (`LoadweaverBackupsSummaryComponent`),
 * usage and targets in the empty detail lane (`LoadweaverBackupsOverviewComponent`).
 *
 * Embedded in an object tab (3.38) the scope is `{ project, resource }` (`resource`: a deployment, a volume, or a VM
 * `lw-vm/<vm>`): the catalog loads the project and keeps the object's volumes (client-side, see
 * `catalogVolumeInResource`), the project filter and Views are hidden, the URL is never written; opening a backup
 * navigates to `/operate/backups/:id`.
 */
@Component({
  selector: 'loadweaver-backups-page',
  imports: [
    LoadweaverSavedViewsComponent,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcDataTableComponent,
    FpcLaneHeaderComponent,
    FpcEmptyStateComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcTableCellDirective,
    FpcTableRowDetailDirective,
    CommonModule,
    FormsModule,
    RouterModule,
    LoadweaverBackupRestoreModalComponent,
  ],
  templateUrl: './backups-page.component.html',
  styleUrl: './backups-page.component.scss',
  standalone: true,
})
export class LoadweaverBackupsPageComponent implements OnInit {
  /** The row open in the detail lane (3.37 P6 master-detail; null outside the shell). */
  readonly openId = computed(() => this.masterDetail?.selectedId() ?? null);
  private readonly masterDetail = inject(MasterDetailState, { optional: true });
  private readonly facade = inject(ConsoleBackupsFacade);
  private readonly access = inject(ConsoleAccessFacade);
  private readonly live = inject(ConsoleLiveFacade);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly service = inject(BackupsService);
  readonly scope = injectSectionScope();
  /** The object's volumes (embedded; `null`: all). */
  private readonly scopeResource = this.scope?.params()['resource'] || null;

  readonly status = toSignal(this.facade.status$, { initialValue: null });
  readonly volumes = toSignal(this.facade.volumes$, { initialValue: [] as BackupVolume[] });
  readonly loaded = toSignal(this.facade.loaded$, { initialValue: false });
  readonly loading = toSignal(this.facade.loading$, { initialValue: false });
  readonly error = toSignal(this.facade.error$, { initialValue: null });
  readonly busy = toSignal(this.facade.busy$, { initialValue: false });
  readonly backingUp = toSignal(this.facade.backingUp$, { initialValue: [] as string[] });
  readonly testing = toSignal(this.facade.testing$, { initialValue: [] as string[] });
  readonly actionError = toSignal(this.facade.actionError$, { initialValue: null });
  readonly requesting = toSignal(this.facade.requestingDeletion$, { initialValue: false });
  readonly requestError = toSignal(this.facade.deletionRequestError$, { initialValue: null });
  readonly requested = toSignal(this.facade.requestedDeletion$, { initialValue: null });
  readonly me = toSignal(this.access.me$, { initialValue: null });
  readonly isClusterAdmin = toSignal(this.access.isClusterAdmin$, { initialValue: false });
  readonly accessProjects = toSignal(this.access.projects$, { initialValue: [] as string[] });
  readonly liveVolumes = toSignal(this.live.volumes$, { initialValue: [] as LiveVolumeTarget[] });

  readonly project = signal<string | null>(null);

  /** Projects to filter by: the caller's, plus those the catalog / usage shows (cluster roles see every project). */
  readonly projects = computed(() =>
    [
      ...new Set([
        ...this.accessProjects(),
        ...(this.status()?.usage ?? []).map((u) => u.project),
        ...this.volumes()
          .map((v) => v.project)
          .filter((p): p is string => !!p),
      ]),
    ].sort(),
  );

  readonly search = signal('');
  /** "Views ▾" (3.37): saved search / filters of this list, per user. */
  readonly views = savedViewBinding({ project: this.project, search: this.search });
  /** The catalog volumes that match the search (volume, project, deployment). */
  readonly visibleCatalog = computed(() =>
    filterBySearch(this.catalog(), this.search(), (v) => [v.resource, v.project, v.deployment, v.volume]),
  );

  /** Volumes with backups, then (from the topology) the project's volumes that have none yet. */
  readonly catalog = computed<CatalogVolume[]>(() => {
    const project = this.project();
    const resource = this.scopeResource;
    const inScope = (v: { deployment: string; volume: string }) => !resource || catalogVolumeInResource(v, resource);
    const listed = this.volumes()
      .filter((v) => (!project || v.project === project) && inScope(v))
      .map((v) => ({ ...v, empty: false }));
    const known = new Set(listed.map((v) => v.resource));
    const empty = this.liveVolumes()
      .filter(
        (v) =>
          (!project || v.project === project) &&
          !known.has(v.id) &&
          inScope({ deployment: v.deployment, volume: v.name }),
      )
      .map(
        (v): CatalogVolume => ({
          resource: v.id,
          project: v.project,
          deployment: v.deployment,
          volume: v.name,
          backups: [],
          latest: null,
          lastSucceeded: null,
          running: false,
          storedBytes: 0,
          empty: true,
        }),
      );

    return [...listed, ...empty].sort((a, b) => a.resource.localeCompare(b.resource));
  });

  /** Restore wizard, diff picker and deletion request dialog. */
  readonly restoreFor = signal<{ backup: Backup; candidates: Backup[] } | null>(null);
  readonly restoreOpen = signal(false);
  readonly diffFor = signal<{ backup: Backup; others: Backup[] } | null>(null);
  diffOther = '';
  /** The backups of one deletion request (row action: one; bulk: the selection). */
  readonly deleteFor = signal<Backup[] | null>(null);
  deletionReason = '';

  readonly statusTone = BACKUP_STATUS_TONE;
  readonly statusLabel = backupStatusLabel;
  readonly testTone = RESTORE_TEST_TONE;
  readonly testLabel = restoreTestLabel;
  readonly testToneOf = (status: RestoreTestStatus) => RESTORE_TEST_TONE[status];
  readonly keepLabel = keepReasonLabel;
  readonly bytes = formatBytes;
  readonly locked = isLocked;
  readonly timeline = backupTimeline;

  readonly title = $localize`:@@lwConsoleBackups-title:Backups`;
  readonly refreshLabel = $localize`:@@lwConsoleBackups-refresh:Refresh`;
  readonly emptyMessage = `${$localize`:@@lwConsoleBackups-emptyMessage:Volumes are backed up once a backup policy selects them.`} ${CREATE_HINT}`;
  readonly searchLabel = $localize`:@@lwConsoleBackups-search:Search volumes`;
  readonly volumesTitle = $localize`:@@lwConsoleBackups-volumesTitle:Volumes`;
  readonly allProjectsLabel = $localize`:@@lwConsoleBackups-allProjects:All projects`;
  readonly projectLabel = $localize`:@@lwConsoleBackups-project:Project`;
  readonly filtersOpen = signal(false);
  /** Applied filters (+ search) in the URL; the drawer edits a draft until Apply (3.38 R12). */
  readonly filterState = fpcListQueryState({
    filters: { project: this.project },
    search: this.search,
    url: false,
    open: this.filtersOpen,
    changed: () => this.selectProject(this.project()),
  });
  readonly loadingLabel = $localize`:@@lwConsoleBackups-loading:Loading backups`;
  readonly backupNowLabel = $localize`:@@lwConsoleBackups-backupNow:Back up now`;
  readonly policiesLabel = $localize`:@@lwConsoleBackups-policies:Backup policies`;
  readonly catalogTitle = $localize`:@@lwConsoleBackups-catalogTitle:Catalog`;
  readonly diffTitle = $localize`:@@lwConsoleBackups-diffTitle:Compare with another backup`;
  readonly deleteTitle = $localize`:@@lwConsoleBackups-deleteTitle:Request deletion`;
  readonly browseLabel = $localize`:@@lwConsoleBackups-browse:Browse files`;
  readonly compareLabel = $localize`:@@lwConsoleBackups-compare:Compare`;
  readonly restoreLabel = $localize`:@@lwConsoleBackups-restore:Restore`;
  readonly testNowLabel = $localize`:@@lwConsoleBackups-testNow:Restore test now`;
  readonly deleteLabel = $localize`:@@lwConsoleBackups-delete:Request deletion`;
  readonly backupsOfLabel = $localize`:@@lwConsoleBackups-backupsOfVolume:Backups of the volume`;
  readonly deletedLabel = $localize`:@@lwConsoleBackups-deleted:Deleted`;
  readonly noBackupsLabel = $localize`:@@lwConsoleBackups-volumeNone:No backups`;
  readonly immutableLabel = $localize`:@@lwConsoleBackups-immutable:Immutable`;
  readonly unlockedLabel = $localize`:@@lwConsoleBackups-unlocked:No longer immutable`;
  readonly copyResourceLabel = $localize`:@@lwConsoleBackups-copyVolume:Copy volume path`;

  /** The volume whose backups are open (row detail); `undefined`: none chosen — a single volume opens itself. */
  private readonly expandedChoice = signal<string | null | undefined>(undefined);
  readonly expanded = computed(() => {
    const choice = this.expandedChoice();
    const catalog = this.visibleCatalog();

    return choice !== undefined ? choice : catalog.length === 1 ? catalog[0].resource : null;
  });

  /** 3.38 D1: State · Volume · project · stored · last good · backups; the backups (timeline + table) in the detail. */
  readonly volumeColumns: FpcTableColumn<CatalogVolume>[] = [
    {
      id: 'state',
      label: $localize`:@@lwConsoleBackups-colState:State`,
      type: 'state',
      state: (v) =>
        v.running
          ? {
              label: $localize`:@@lwConsoleBackups-volumeRunning:Backup running`,
              tone: 'primary',
              icon: 'arrow-repeat',
            }
          : v.empty || !v.latest
            ? { label: this.noBackupsLabel, tone: 'neutral' }
            : { label: backupStatusLabel(v.latest.status), tone: BACKUP_STATUS_TONE[v.latest.status] },
    },
    {
      id: 'volume',
      label: $localize`:@@lwConsoleBackups-colVolume:Volume`,
      value: (v) => v.resource,
      required: true,
      priority: 1,
    },
    {
      id: 'project',
      label: $localize`:@@lwConsoleBackups-project:Project`,
      value: (v) => v.project ?? '',
      priority: 2,
    },
    {
      id: 'stored',
      label: $localize`:@@lwConsoleBackups-colStored:Stored`,
      value: (v) => v.storedBytes,
      align: 'end',
      width: '7rem',
      priority: 2,
    },
    {
      id: 'lastGood',
      label: $localize`:@@lwConsoleBackups-colLastGood:Last good`,
      value: (v) => v.lastSucceeded?.startedAt ?? null,
      priority: 1,
    },
    {
      id: 'backups',
      label: $localize`:@@lwConsoleBackups-colBackups:Backups`,
      value: (v) => v.backups.length,
      align: 'end',
      width: '6rem',
      priority: 3,
    },
  ];

  /** The backups of a volume (nested): State · Time (link) · size · kept as · restore test · immutable · targets. */
  readonly backupColumns: FpcTableColumn<Backup>[] = [
    {
      id: 'status',
      label: $localize`:@@lwConsoleBackups-colStatus:Status`,
      type: 'state',
      state: (b) =>
        b.deletedAt
          ? { label: this.deletedLabel, tone: 'neutral', icon: 'trash' }
          : { label: backupStatusLabel(b.status), tone: BACKUP_STATUS_TONE[b.status] },
    },
    {
      id: 'time',
      label: $localize`:@@lwConsoleBackups-colTime:Time`,
      value: (b) => b.startedAt,
      required: true,
      priority: 1,
    },
    {
      id: 'size',
      label: $localize`:@@lwConsoleBackups-colSize:Size`,
      value: (b) => b.bytes,
      align: 'end',
      width: '7rem',
      priority: 1,
    },
    { id: 'keep', label: $localize`:@@lwConsoleBackups-colKeep:Kept as`, priority: 2 },
    {
      id: 'test',
      label: $localize`:@@lwConsoleBackups-colTest:Restore test`,
      value: (b) => (b.restoreTest ? restoreTestLabel(b.restoreTest.status) : ''),
      priority: 2,
    },
    {
      id: 'locked',
      label: $localize`:@@lwConsoleBackups-colImmutable:Immutable until`,
      value: (b) => b.lockedUntil,
      priority: 3,
    },
    {
      id: 'targets',
      label: $localize`:@@lwConsoleBackups-colTargets:Targets`,
      value: (b) => this.targetNames(b),
      priority: 3,
    },
    { id: 'error', label: $localize`:@@lwConsoleBackups-colError:Error`, value: (b) => b.error ?? '', priority: 3 },
  ];

  readonly volumeId = (v: CatalogVolume) => v.resource;
  readonly backupLink = (b: Backup) => `/operate/backups/${encodeURIComponent(b.id)}`;
  readonly volumeMenu = (v: CatalogVolume): FpcMenuItem[] => [
    ...(this.mayOperate(v.project)
      ? [
          {
            id: 'backup-now',
            label: this.backupNowLabel,
            icon: 'play-fill',
            disabled: v.running || this.backingUp().includes(v.resource),
          },
        ]
      : []),
    { id: 'copy-resource', label: this.copyResourceLabel, icon: 'copy', dividerBefore: this.mayOperate(v.project) },
  ];
  /** ⋮ of a backup: Open (browse files), Compare, Restore, Restore test, Request deletion, Copy ID. */
  readonly backupMenu = (b: Backup): FpcMenuItem[] => {
    const volume = this.catalog().find((v) => v.resource === b.resource);
    const project = volume?.project ?? b.project;

    if (!this.available(b)) return [dlOpenItem(), dlCopyIdItem()];

    return [
      dlOpenItem(),
      { id: 'compare', label: this.compareLabel, icon: 'file-diff' },
      ...(this.mayOperate(project) || this.mayAdminister(project)
        ? [{ id: 'restore', label: this.restoreLabel, icon: 'arrow-counterclockwise' }]
        : []),
      ...(this.mayOperate(project)
        ? [
            {
              id: 'test',
              label: this.testNowLabel,
              icon: 'clipboard-check',
              disabled: this.testing().includes(b.id) || b.restoreTest?.status === 'running',
            },
          ]
        : []),
      ...(this.mayAdminister(project)
        ? [{ id: 'delete', label: this.deleteLabel, icon: 'trash', danger: true, dividerBefore: true }]
        : []),
      dlCopyIdItem(),
    ];
  };

  /** Bulk selection: volumes (Back up now) and the backups of the open volume (restore test, request deletion). */
  readonly selectedVolumes = signal<readonly string[]>([]);
  readonly selectedBackups = signal<readonly string[]>([]);
  readonly bulkResult = signal<{ tone: 'success' | 'warning' | 'danger'; message: string } | null>(null);
  private readonly pickedVolumes = computed(() => {
    const ids = new Set(this.selectedVolumes());

    return this.catalog().filter((v) => ids.has(v.resource));
  });
  private readonly pickedBackups = computed(() => {
    const ids = new Set(this.selectedBackups());

    return this.catalog()
      .flatMap((v) => v.backups.map((backup) => ({ backup, project: v.project })))
      .filter((entry) => ids.has(entry.backup.id));
  });
  readonly canBackupSelection = computed(
    () =>
      this.pickedVolumes().length > 0 && this.pickedVolumes().every((v) => this.mayOperate(v.project) && !v.running),
  );
  readonly canTestSelection = computed(
    () =>
      this.pickedBackups().length > 0 &&
      this.pickedBackups().every((e) => this.available(e.backup) && this.mayOperate(e.project)),
  );
  readonly canDeleteSelection = computed(
    () =>
      this.pickedBackups().length > 0 &&
      this.pickedBackups().every((e) => this.available(e.backup) && this.mayAdminister(e.project)),
  );

  ngOnInit(): void {
    this.project.set(sectionQuery(this.route, this.scope).get('project'));
    this.facade.load(this.project());
    this.live.loadTargets();

    let ticks = 0;

    interval(BACKUPS_POLL_MS)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        ticks++;

        if (this.busy() || ticks % BACKUPS_IDLE_POLL_TICKS === 0) this.facade.load(this.project(), true);
      });
  }

  refresh(): void {
    this.facade.load(this.project());
    this.live.loadTargets();
  }

  selectProject(project: string | null): void {
    this.project.set(project || null);
    this.facade.load(this.project());

    if (this.scope) return;

    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { project: project || null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  mayOperate(project: string | null): boolean {
    return canOperate(this.me(), project);
  }

  mayAdminister(project: string | null): boolean {
    return canAdminister(this.me(), project);
  }

  available(backup: Backup): boolean {
    return backup.status === 'succeeded' && !backup.deletedAt;
  }

  backupNow(volume: CatalogVolume): void {
    this.facade.backupNow(volume.resource);
  }

  /** Row click / Enter on a volume opens / closes its backups. */
  toggle(volume: CatalogVolume): void {
    this.expandedChoice.set(this.expanded() === volume.resource ? null : volume.resource);
    this.selectedBackups.set([]);
  }

  onVolumeAction(volume: CatalogVolume, action: string): void {
    if (action === 'backup-now') this.backupNow(volume);
    else if (action === 'copy-resource') fpcCopyText(volume.resource);
  }

  onBackupAction(backup: Backup, action: string): void {
    const volume = this.catalog().find((v) => v.resource === backup.resource);

    if (action === 'open') void this.router.navigate(['/operate/backups', backup.id]);
    else if (action === 'compare' && volume) this.openDiff(backup, volume);
    else if (action === 'restore' && volume) this.openRestore(backup, volume);
    else if (action === 'test') this.testNow(backup);
    else if (action === 'delete') this.openDelete([backup]);
    else if (action === 'copy-id') fpcCopyText(backup.id);
  }

  /** Bulk Back up now: one call per volume (same endpoint + authorization as the row action), per-volume result. */
  async backupSelected(): Promise<void> {
    const volumes = this.pickedVolumes().filter((v) => this.mayOperate(v.project) && !v.running);

    if (volumes.length === 0) return;

    const result = await fpcRunBulk(volumes, (v) => firstValueFrom(this.service.backupNow(v.resource)));

    this.bulkResult.set(dlBulkSummary(result, (v) => v.resource));
    this.selectedVolumes.set([]);
    this.facade.load(this.project(), true);
  }

  /** Bulk Restore test: one call per backup, per-backup result. */
  async testSelected(): Promise<void> {
    const backups = this.pickedBackups()
      .filter((e) => this.available(e.backup) && this.mayOperate(e.project))
      .map((e) => e.backup);

    if (backups.length === 0) return;

    const result = await fpcRunBulk(backups, (b) => firstValueFrom(this.service.restoreTest(b.id)));

    this.bulkResult.set(dlBulkSummary(result, (b) => this.backupName(b)));
    this.selectedBackups.set([]);
    this.facade.load(this.project(), true);
  }

  /** Bulk Request deletion: one deletion request for the selection (the endpoint takes several backups). */
  deleteSelected(): void {
    this.openDelete(this.pickedBackups().map((e) => e.backup));
  }

  /** A backup for people: volume + start time (no id, D11). */
  backupName(backup: Backup): string {
    return `${backup.resource} · ${new Date(backup.startedAt).toLocaleString()}`;
  }

  testNow(backup: Backup): void {
    this.facade.testNow(backup.id);
  }

  openRestore(backup: Backup, volume: CatalogVolume): void {
    this.restoreFor.set({ backup, candidates: volume.backups });
    this.restoreOpen.set(true);
  }

  openDiff(backup: Backup, volume: CatalogVolume): void {
    const others = volume.backups.filter((b) => b.id !== backup.id && this.available(b));

    this.diffOther = others[0]?.id ?? '';
    this.diffFor.set({ backup, others });
  }

  /** Older backup → newer backup, whichever was picked first. */
  compare(): void {
    const current = this.diffFor();
    const other = current?.others.find((b) => b.id === this.diffOther);

    if (!current || !other) return;

    const [from, to] = other.startedAt <= current.backup.startedAt ? [other, current.backup] : [current.backup, other];

    this.diffFor.set(null);
    void this.router.navigate(['/operate/backups/diff'], { queryParams: { from: from.id, to: to.id } });
  }

  openDelete(backups: Backup[]): void {
    if (backups.length === 0) return;

    this.deletionReason = '';
    this.facade.clearDeletionRequest();
    this.deleteFor.set(backups);
  }

  onDiffOpenChange(open: boolean): void {
    if (!open) this.diffFor.set(null);
  }

  onDeleteOpenChange(open: boolean): void {
    if (!open) this.closeDelete();
  }

  closeDelete(): void {
    if (this.requested()) this.selectedBackups.set([]);

    this.deleteFor.set(null);
    this.facade.clearDeletionRequest();
  }

  requestDeletion(): void {
    const backups = this.deleteFor();

    if (backups && backups.length > 0 && this.deletionReason.trim().length >= 3)
      this.facade.requestDeletion(
        backups.map((b) => b.id),
        this.deletionReason.trim(),
      );
  }

  targetNames(backup: Backup): string {
    return backup.targets.map((t) => t.target).join(', ');
  }

  timelineTitle(backup: Backup): string {
    return `${new Date(backup.startedAt).toLocaleString()}: ${backupStatusLabel(backup.status)} (${formatBytes(backup.bytes)})`;
  }
}
