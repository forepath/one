import { CommonModule, DOCUMENT } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import {
  apiErrorMessage,
  apiErrorMessageAsync,
  BackupsService,
  ConsoleAccessFacade,
  type BackupsStatus,
  type PlatformBackupEntry,
  type PlatformBackupKind,
  type PlatformBackupKindStatus,
  type PlatformBackupRunResult,
  type PlatformBackupStatus,
  type PlatformCopyRunResult,
  type PlatformCopyTarget,
  type PlatformCutover,
  type PlatformRestore,
  ConsoleEndpointService,
  backendMessageLabel,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcConfirmDialogComponent,
  fpcCopyText,
  FpcDataTableComponent,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcInputGroupComponent,
  FpcListHeaderComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcPageHeaderComponent,
  fpcRunBulk,
  FpcTabComponent,
  FpcTabGroupComponent,
  FpcTableCellDirective,
  FpcTableRowDetailDirective,
  type FpcMenuItem,
  type FpcTableColumn,
  type FpcTableState,
} from '@forepath/shared/frontend/ui-components';
import { catchError, firstValueFrom, forkJoin, interval, of, type Observable } from 'rxjs';

import { saveFile } from '../live/live-format';
import { formatBytes } from '../overview/console-format';
import { BACKUPS_IDLE_POLL_TICKS, BACKUPS_POLL_MS, deletionStateLabel, isLocked } from './backup-format';
import {
  drRestoreCommand,
  isCutoverOpen,
  localDateTimeToIso,
  PLATFORM_CUTOVER_TONE,
  PLATFORM_RESTORE_TONE,
  platformBusy,
  platformCutoverLabel,
  platformKindLabel,
  platformRestoreLabel,
  platformStatusLabel,
  platformStatusTone,
  saveDrInfo,
} from './platform-backup-format';
import { approvalsAvailable } from '../access/access-format';
import { dlBulkSummary, dlCopyIdItem, dlUserLabel } from '../section/data-list';

/** A platform backup with its kind (the nested tables' inline download needs it). */
export interface PlatformBackupRow extends PlatformBackupEntry {
  kind: PlatformBackupKind;
}

/** The tabs of the page (decision 4): one table / section at a time. */
export type PlatformTab = 'kinds' | 'restores' | 'cutovers' | 'copies' | 'dr';

/**
 * Control-plane ("platform") backups and disaster recovery (M6): the cluster's own Postgres, OpenSearch and etcd per
 * kind (schedule, retention, last run, back up now), point-in-time recovery of Postgres into a separate scope and the
 * cut-over to it (planned, approved by a second cluster admin, executed), the external copy to off-cluster targets and
 * the DR info a fresh node is rebuilt from. Cluster roles read; cluster admins act (the API decides in the end).
 */
@Component({
  selector: 'loadweaver-platform-backups-page',
  imports: [
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcConfirmDialogComponent,
    FpcDataTableComponent,
    FpcEmptyStateComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcInputGroupComponent,
    FpcListHeaderComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcPageHeaderComponent,
    FpcTabComponent,
    FpcTabGroupComponent,
    FpcTableCellDirective,
    FpcTableRowDetailDirective,
    CommonModule,
    FormsModule,
    RouterModule,
  ],
  templateUrl: './platform-backups-page.component.html',
  standalone: true,
})
export class LoadweaverPlatformBackupsPageComponent implements OnInit {
  /** Requester / approver label (email, "Deleted user", …), never the raw id (D11). */
  readonly userLabel = dlUserLabel;
  private readonly service = inject(BackupsService);
  /** Fleet mode: approvals through the fleet only when the cluster verifies its identity claims (3.24). */
  protected readonly fleetMode = inject(ConsoleEndpointService).fleetMode;
  private readonly access = inject(ConsoleAccessFacade);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);

  /** A pin as a sentence (LW-15): the server's English pins translated, never raw lower case. */
  readonly pinText = backendMessageLabel;
  readonly me = toSignal(this.access.me$, { initialValue: null });
  readonly isClusterAdmin = toSignal(this.access.isClusterAdmin$, { initialValue: false });
  readonly approvalsHere = computed(() => approvalsAvailable(this.fleetMode, this.me()));

  readonly status = signal<PlatformBackupStatus | null>(null);
  readonly cutovers = signal<PlatformCutover[]>([]);
  readonly keys = signal<BackupsStatus['keys'] | null>(null);
  readonly loading = signal(false);
  readonly loaded = signal(false);
  readonly error = signal<string | null>(null);
  /** The running action: `run:<kind>`, `restore`, `discard:<id>`, `plan:<id>`, `approve:<id>`, `cancel:<id>`, … */
  readonly acting = signal<string | null>(null);
  readonly actionError = signal<string | null>(null);
  readonly runResults = signal<Partial<Record<PlatformBackupKind, PlatformBackupRunResult>>>({});
  readonly copyResults = signal<PlatformCopyRunResult[] | null>(null);
  /** The cluster id, known once the DR info was downloaded (fills in the restore command). */
  readonly drCluster = signal<string | null>(null);
  readonly commandCopied = signal(false);

  readonly restoreOpen = signal(false);
  restoreTargetTime = '';
  restoreNode = '';
  readonly planFor = signal<PlatformRestore | null>(null);
  readonly approveFor = signal<PlatformCutover | null>(null);
  readonly discardFor = signal<PlatformRestore | null>(null);
  readonly cancelFor = signal<PlatformCutover | null>(null);

  readonly kinds = computed(() => this.status()?.kinds ?? []);
  readonly restores = computed(() =>
    [...(this.status()?.restores ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  );
  readonly openCutovers = computed(() => this.cutovers().filter(isCutoverOpen));
  readonly pastCutovers = computed(() => this.cutovers().filter((c) => !isCutoverOpen(c)));
  readonly busy = computed(() => platformBusy(this.kinds(), this.restores(), this.cutovers()));
  readonly restoreCommand = computed(() => drRestoreCommand(this.drCluster()));

  readonly kindLabel = platformKindLabel;
  /** A retention request's state (deletion request states, D7). */
  readonly deletionState = deletionStateLabel;
  readonly cutoverOpen = isCutoverOpen;
  readonly runResultOf = (kind: PlatformBackupKind) => this.runResults()[kind] ?? null;
  readonly runTone = platformStatusTone;
  readonly runLabel = platformStatusLabel;
  readonly restoreTone = PLATFORM_RESTORE_TONE;
  readonly restoreLabel = platformRestoreLabel;
  readonly cutoverTone = PLATFORM_CUTOVER_TONE;
  readonly cutoverLabel = platformCutoverLabel;
  readonly bytes = formatBytes;
  readonly locked = isLocked;

  readonly title = $localize`:@@lwConsolePlatformBackups-title:Platform backups and disaster recovery`;
  readonly loadingLabel = $localize`:@@lwConsolePlatformBackups-loading:Loading platform backups`;
  readonly pitrTitle = $localize`:@@lwConsolePlatformBackups-pitrTitle:Point-in-time recovery (Postgres)`;
  readonly copiesTitle = $localize`:@@lwConsolePlatformBackups-copiesTitle:External copy`;
  readonly drTitle = $localize`:@@lwConsolePlatformBackups-drTitle:Disaster recovery`;
  /** Lanes (3.37): backups per kind | point-in-time recovery + cut-overs | external copy + disaster recovery. */
  readonly tab = signal<PlatformTab>('kinds');
  readonly restoresTitle = $localize`:@@lwConsolePlatformBackups-tabRestores:Restores`;
  readonly cutoversTitle = $localize`:@@lwConsolePlatformBackups-tabCutovers:Cut-overs`;
  readonly backupsOfKindTitle = $localize`:@@lwConsolePlatformBackups-backupsOfKind:Backups of this kind`;
  readonly runNowLabel = $localize`:@@lwConsolePlatformBackups-runNow:Back up now`;
  readonly planLabel = $localize`:@@lwConsolePlatformBackups-plan:Switch control-plane database to this restore`;
  readonly approveLabel = $localize`:@@lwConsolePlatformBackups-approve:Approve`;
  readonly latestLabel = $localize`:@@lwConsolePlatformBackups-latest:latest`;
  readonly onlyOnClusterLabel = $localize`:@@lwConsolePlatformBackups-noCopy:only on the cluster`;
  readonly retentionPendingLabel = $localize`:@@lwConsolePlatformBackups-retentionWaiting:Shorter retention waits for approval`;
  readonly undeclaredLabel = $localize`:@@lwConsolePlatformBackups-undeclared:Not declared`;
  readonly verifiedLabel = $localize`:@@lwConsolePlatformBackups-verifiedShort:DR envelope verified`;
  readonly notVerifiedLabel = $localize`:@@lwConsolePlatformBackups-notVerifiedShort:No DR envelope verified yet`;
  readonly lockedLabel = $localize`:@@lwConsolePlatformBackups-lockedUntil:locked until`;

  /** Open row details: a kind's backups, a cut-over's plan (the open cut-over opens itself). */
  readonly expandedKind = signal<string | null>(null);
  private readonly expandedCutoverChoice = signal<string | null | undefined>(undefined);
  readonly expandedCutover = computed(() => {
    const choice = this.expandedCutoverChoice();

    return choice !== undefined ? choice : (this.openCutovers()[0]?.id ?? null);
  });
  /** The backups per kind with their kind (precomputed for the nested tables). */
  private readonly backupRows = computed(
    () => new Map(this.kinds().map((k) => [k.kind, k.backups.map((b): PlatformBackupRow => ({ ...b, kind: k.kind }))])),
  );
  readonly backupsOf = (k: PlatformBackupKindStatus): PlatformBackupRow[] => this.backupRows().get(k.kind) ?? [];

  /** 3.38 D1: State (running / disabled / last run) · Kind · schedule · retention · last run · last backup · error. */
  readonly kindColumns: FpcTableColumn<PlatformBackupKindStatus>[] = [
    {
      id: 'state',
      label: $localize`:@@lwConsolePlatformBackups-colState:State`,
      type: 'state',
      state: (k): FpcTableState =>
        k.running
          ? { label: $localize`:@@lwConsolePlatformBackups-running:Running`, tone: 'primary', icon: 'arrow-repeat' }
          : !k.enabled
            ? { label: $localize`:@@lwConsolePlatformBackups-disabledBadge:Disabled`, tone: 'neutral' }
            : { label: platformStatusLabel(k.lastStatus), tone: platformStatusTone(k.lastStatus) },
    },
    {
      id: 'kind',
      label: $localize`:@@lwConsolePlatformBackups-colKind:Kind`,
      value: (k) => platformKindLabel(k.kind),
      required: true,
      priority: 1,
    },
    {
      id: 'schedule',
      label: $localize`:@@lwConsolePlatformBackups-schedule:Schedule`,
      value: (k) => k.schedule,
      mono: true,
      priority: 2,
    },
    {
      id: 'keep',
      label: $localize`:@@lwConsolePlatformBackups-keep:Keep`,
      value: (k) => k.effectiveKeep,
      align: 'end',
      width: '6rem',
      priority: 2,
    },
    {
      id: 'lastRun',
      label: $localize`:@@lwConsolePlatformBackups-lastRun:Last run`,
      value: (k) => k.lastStartedAt,
      priority: 1,
    },
    {
      id: 'lastBackup',
      label: $localize`:@@lwConsolePlatformBackups-colLastBackup:Last backup`,
      value: (k) => k.lastBackup ?? '',
      mono: true,
      priority: 3,
    },
    {
      id: 'error',
      label: $localize`:@@lwConsolePlatformBackups-colError:Error`,
      value: (k) => k.lastError ?? '',
      priority: 3,
    },
  ];

  /** A kind's backups (nested): State · Backup · size · started · finished · external copies; etcd download inline. */
  readonly backupColumns: FpcTableColumn<PlatformBackupRow>[] = [
    {
      id: 'status',
      label: $localize`:@@lwConsolePlatformBackups-colStatus:Status`,
      type: 'state',
      state: (b) => ({ label: platformStatusLabel(b.status), tone: platformStatusTone(b.status) }),
    },
    {
      id: 'name',
      label: $localize`:@@lwConsolePlatformBackups-colName:Backup`,
      value: (b) => b.name ?? b.startedAt,
      required: true,
      priority: 1,
    },
    {
      id: 'size',
      label: $localize`:@@lwConsolePlatformBackups-colSize:Size`,
      value: (b) => b.bytes,
      align: 'end',
      width: '7rem',
      priority: 1,
    },
    {
      id: 'started',
      label: $localize`:@@lwConsolePlatformBackups-colStarted:Started`,
      value: (b) => b.startedAt,
      priority: 2,
    },
    {
      id: 'finished',
      label: $localize`:@@lwConsolePlatformBackups-colFinished:Finished`,
      value: (b) => b.finishedAt,
      priority: 3,
    },
    { id: 'targets', label: $localize`:@@lwConsolePlatformBackups-colTargets:External copies`, priority: 2 },
  ];

  /** Restores: State · Target time · node · scope · ready · endpoint · error; ⋮ switch / discard. */
  readonly restoreColumns: FpcTableColumn<PlatformRestore>[] = [
    {
      id: 'state',
      label: $localize`:@@lwConsolePlatformBackups-colState:State`,
      type: 'state',
      state: (r) => ({ label: platformRestoreLabel(r.state), tone: PLATFORM_RESTORE_TONE[r.state] }),
    },
    {
      id: 'targetTime',
      label: $localize`:@@lwConsolePlatformBackups-colTargetTime:Target time`,
      value: (r) => r.targetTime ?? '',
      required: true,
      priority: 1,
    },
    {
      id: 'node',
      label: $localize`:@@lwConsolePlatformBackups-colNode:Node`,
      value: (r) => r.node,
      priority: 2,
    },
    {
      id: 'scope',
      label: $localize`:@@lwConsolePlatformBackups-colScope:Scope`,
      value: (r) => r.scope,
      mono: true,
      priority: 2,
    },
    {
      id: 'ready',
      label: $localize`:@@lwConsolePlatformBackups-colReady:Ready`,
      value: (r) => r.readyAt,
      priority: 1,
    },
    {
      id: 'endpoint',
      label: $localize`:@@lwConsolePlatformBackups-colEndpoint:Endpoint`,
      value: (r) => (r.endpoint.host ? `${r.endpoint.host}:${r.endpoint.port}` : ''),
      mono: true,
      priority: 3,
    },
    {
      id: 'error',
      label: $localize`:@@lwConsolePlatformBackups-colError:Error`,
      value: (r) => r.error ?? '',
      priority: 3,
    },
  ];

  /** Cut-overs: State · Switch (previous → new scope) · data loss after · requested · approved · node · final backup. */
  readonly cutoverColumns: FpcTableColumn<PlatformCutover>[] = [
    {
      id: 'state',
      label: $localize`:@@lwConsolePlatformBackups-colState:State`,
      type: 'state',
      state: (c) => ({ label: platformCutoverLabel(c.state), tone: PLATFORM_CUTOVER_TONE[c.state] }),
    },
    {
      id: 'switch',
      label: $localize`:@@lwConsolePlatformBackups-colSwitch:Switch`,
      value: (c) => `${c.previousScope} → ${c.scope}`,
      required: true,
      priority: 1,
      mono: true,
    },
    {
      id: 'dataLoss',
      label: $localize`:@@lwConsolePlatformBackups-colDataLoss:Data lost after`,
      value: (c) => c.plan.dataLossAfter,
      priority: 1,
    },
    {
      id: 'requestedBy',
      label: $localize`:@@lwConsolePlatformBackups-colRequestedBy:Requested by`,
      value: (c) => dlUserLabel(c.requestedBy, c.requestedByEmail),
      priority: 2,
    },
    {
      id: 'created',
      label: $localize`:@@lwConsolePlatformBackups-colCreated:Requested`,
      value: (c) => c.createdAt,
      priority: 2,
    },
    {
      id: 'approvedBy',
      label: $localize`:@@lwConsolePlatformBackups-colApprovedBy:Approved by`,
      value: (c) => dlUserLabel(c.approvedBy, c.approvedByEmail),
      priority: 3,
    },
    {
      id: 'node',
      label: $localize`:@@lwConsolePlatformBackups-colNode:Node`,
      value: (c) => c.node,
      priority: 3,
    },
    {
      id: 'finalBackup',
      label: $localize`:@@lwConsolePlatformBackups-finalBackup:final backup`,
      value: (c) => c.finalBackup ?? '',
      mono: true,
      priority: 3,
      hidden: true,
    },
  ];

  /** External copy targets: State (last copy) · Target · type · object lock · last copy · objects · size · verified. */
  readonly copyColumns: FpcTableColumn<PlatformCopyTarget>[] = [
    {
      id: 'state',
      label: $localize`:@@lwConsolePlatformBackups-colState:State`,
      type: 'state',
      state: (t) => ({ label: platformStatusLabel(t.lastStatus), tone: platformStatusTone(t.lastStatus) }),
    },
    {
      id: 'target',
      label: $localize`:@@lwConsolePlatformBackups-colTarget:Target`,
      value: (t) => t.target,
      required: true,
      priority: 1,
    },
    {
      id: 'type',
      label: $localize`:@@lwConsolePlatformBackups-colType:Type`,
      value: (t) => (t.type ? t.type.toUpperCase() : ''),
      priority: 3,
    },
    { id: 'lock', label: $localize`:@@lwConsolePlatformBackups-objectLock:Object lock`, priority: 3 },
    {
      id: 'lastCopy',
      label: $localize`:@@lwConsolePlatformBackups-lastCopy:Last copy`,
      value: (t) => t.lastStartedAt,
      priority: 1,
    },
    {
      id: 'objects',
      label: $localize`:@@lwConsolePlatformBackups-colObjects:Objects`,
      value: (t) => t.objects,
      align: 'end',
      width: '6rem',
      priority: 3,
    },
    {
      id: 'bytes',
      label: $localize`:@@lwConsolePlatformBackups-colSize:Size`,
      value: (t) => t.bytes,
      align: 'end',
      width: '7rem',
      priority: 2,
    },
    { id: 'verified', label: $localize`:@@lwConsolePlatformBackups-colVerified:DR envelope`, priority: 2 },
    {
      id: 'error',
      label: $localize`:@@lwConsolePlatformBackups-colError:Error`,
      value: (t) => t.lastError ?? '',
      priority: 3,
    },
  ];

  readonly kindId = (k: PlatformBackupKindStatus) => k.kind;
  readonly copyId = (t: PlatformCopyTarget) => t.target;
  readonly kindMenu = (k: PlatformBackupKindStatus): FpcMenuItem[] =>
    this.isClusterAdmin()
      ? [{ id: 'run', label: this.runNowLabel, icon: 'play-fill', disabled: this.acting() !== null || k.running }]
      : [];
  /** Only etcd snapshots download (inline, the dominant action of such a row). */
  readonly backupInline = (b: PlatformBackupRow): FpcMenuItem[] =>
    b.kind === 'etcd' && b.name && b.status === 'succeeded'
      ? [{ id: 'download', label: this.downloadLabel, icon: 'download', disabled: this.acting() !== null }]
      : [];
  readonly restoreMenu = (r: PlatformRestore): FpcMenuItem[] => [
    ...(this.isClusterAdmin() && r.state === 'ready' && !this.cutoverFor(r)
      ? [
          {
            id: 'plan',
            label: this.planLabel,
            icon: 'shuffle',
            danger: true,
            disabled: this.acting() !== null || this.openCutovers().length > 0,
          },
        ]
      : []),
    ...(this.isClusterAdmin() && this.discardable(r)
      ? [
          {
            id: 'discard',
            label: this.discardLabel,
            icon: 'trash',
            danger: true,
            disabled: this.acting() !== null || !!this.cutoverFor(r),
          },
        ]
      : []),
    { ...dlCopyIdItem(), dividerBefore: this.isClusterAdmin() },
  ];
  readonly cutoverMenu = (c: PlatformCutover): FpcMenuItem[] => [
    ...(this.isClusterAdmin() && this.canCancel(c)
      ? [{ id: 'cancel', label: this.cancelLabel, icon: 'x-circle', disabled: this.acting() !== null }]
      : []),
    ...(this.isClusterAdmin() && this.approvalsHere() && c.state === 'planned'
      ? [{ id: 'approve', label: this.approveLabel, icon: 'check2', danger: true, disabled: this.acting() !== null }]
      : []),
    { ...dlCopyIdItem(), dividerBefore: this.isClusterAdmin() },
  ];

  /** Bulk: back up the selected kinds now; discard the selected restores (confirm). */
  readonly selectedKinds = signal<readonly string[]>([]);
  readonly selectedRestores = signal<readonly string[]>([]);
  readonly confirmBulkDiscard = signal(false);
  readonly bulkResult = signal<{ tone: 'success' | 'warning' | 'danger'; message: string } | null>(null);
  private readonly pickedKinds = computed(() => {
    const ids = new Set(this.selectedKinds());

    return this.kinds().filter((k) => ids.has(k.kind));
  });
  private readonly pickedRestores = computed(() => {
    const ids = new Set(this.selectedRestores());

    return this.restores().filter((r) => ids.has(r.id));
  });
  readonly canRunSelection = computed(
    () => this.isClusterAdmin() && this.pickedKinds().length > 0 && this.pickedKinds().every((k) => !k.running),
  );
  readonly canDiscardSelection = computed(
    () =>
      this.isClusterAdmin() &&
      this.pickedRestores().length > 0 &&
      this.pickedRestores().every((r) => this.discardable(r) && !this.cutoverFor(r)),
  );
  readonly bulkDiscardMessage = computed(
    () =>
      $localize`:@@lwConsolePlatformBackups-bulkDiscardMessage:${this.pickedRestores().length}:count: selected restores are discarded (their databases are removed). Restores you may not discard are reported and left as they are.`,
  );
  readonly kindsTitle = $localize`:@@lwConsolePlatformBackups-kindsTitle:Backups per kind`;
  readonly refreshLabel = $localize`:@@lwConsolePlatformBackups-refresh:Refresh`;
  readonly cancelLabel = $localize`:@@lwConsolePlatformBackups-cancel:Cancel`;
  readonly downloadLabel = $localize`:@@lwConsolePlatformBackups-download:Download`;
  readonly discardLabel = $localize`:@@lwConsolePlatformBackups-discard:Discard`;
  readonly restoreTitle = $localize`:@@lwConsolePlatformBackups-restoreTitle:Point-in-time restore of the control-plane database`;
  readonly planTitle = $localize`:@@lwConsolePlatformBackups-planTitle:Switch the control-plane database to this restore?`;
  readonly planConfirm = $localize`:@@lwConsolePlatformBackups-planConfirm:Plan the cut-over`;
  readonly approveTitle = $localize`:@@lwConsolePlatformBackups-approveTitle:Approve the cut-over?`;
  readonly approveConfirm = $localize`:@@lwConsolePlatformBackups-approveConfirm:Approve and switch`;
  readonly copyLabel = $localize`:@@lwConsolePlatformBackups-copyCommand:Copy the command`;
  readonly discardTitle = $localize`:@@lwConsolePlatformBackups-discardTitle:Discard this restore?`;
  readonly discardConfirm = $localize`:@@lwConsolePlatformBackups-discardConfirm:Discard the restore`;
  readonly cancelCutoverTitle = $localize`:@@lwConsolePlatformBackups-cancelCutoverTitle:Cancel this cut-over?`;
  readonly cancelCutoverConfirm = $localize`:@@lwConsolePlatformBackups-cancelCutoverConfirm:Cancel the cut-over`;
  readonly keepLabel = $localize`:@@lwConsolePlatformBackups-dialogKeep:Keep it`;

  ngOnInit(): void {
    this.access.load();
    void this.load();

    // Something running changes on its own; idle the page refreshes every few ticks.
    let tick = 0;

    interval(BACKUPS_POLL_MS)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        tick += 1;

        if (!this.loading() && (this.busy() || tick % BACKUPS_IDLE_POLL_TICKS === 0)) void this.load(true);
      });
  }

  refresh(): void {
    void this.load();
  }

  /** Platform status, cut-overs and the key / kit state (from the backups status). */
  async load(quiet = false): Promise<void> {
    this.loading.set(true);

    if (!quiet) this.error.set(null);

    try {
      const [status, cutovers, backups] = await firstValueFrom(
        forkJoin([
          this.service.platformStatus(),
          this.service.platformCutovers().pipe(catchError(() => of(null))),
          this.service.status().pipe(catchError(() => of(null))),
        ]),
      );

      this.status.set(status);

      if (cutovers) this.cutovers.set(cutovers);

      if (backups) this.keys.set(backups.keys);

      this.error.set(null);
    } catch (error) {
      this.error.set(
        apiErrorMessage(error, $localize`:@@lwConsolePlatformBackups-loadFailed:Platform backups could not be loaded`),
      );
    } finally {
      this.loading.set(false);
      this.loaded.set(true);
    }
  }

  isActing(key: string): boolean {
    return this.acting() === key;
  }

  private async act<T>(key: string, request: Observable<T>): Promise<T | null> {
    this.acting.set(key);
    this.actionError.set(null);

    try {
      return await firstValueFrom(request);
    } catch (error) {
      this.actionError.set(
        apiErrorMessage(error, $localize`:@@lwConsolePlatformBackups-actionFailed:The action failed`),
      );

      return null;
    } finally {
      this.acting.set(null);
    }
  }

  async runNow(kind: PlatformBackupKindStatus): Promise<void> {
    const result = await this.act(`run:${kind.kind}`, this.service.runPlatformBackup(kind.kind));

    if (result) this.runResults.update((results) => ({ ...results, [kind.kind]: result }));

    await this.load(true);
  }

  openRestore(): void {
    this.restoreTargetTime = '';
    this.restoreNode = '';
    this.actionError.set(null);
    this.restoreOpen.set(true);
  }

  onRestoreOpenChange(open: boolean): void {
    if (!open) this.restoreOpen.set(false);
  }

  async requestRestore(): Promise<void> {
    const targetTime = localDateTimeToIso(this.restoreTargetTime);
    const node = this.restoreNode.trim();
    const restore = await this.act(
      'restore',
      this.service.requestPlatformRestore({
        ...(targetTime ? { targetTime } : {}),
        ...(node ? { node } : {}),
      }),
    );

    if (restore) {
      this.restoreOpen.set(false);
      await this.load(true);
    }
  }

  askDiscard(restore: PlatformRestore): void {
    this.actionError.set(null);
    this.discardFor.set(restore);
  }

  onDiscardOpenChange(open: boolean): void {
    if (!open) this.discardFor.set(null);
  }

  async discard(): Promise<void> {
    const restore = this.discardFor();

    this.discardFor.set(null);

    if (restore && (await this.act(`discard:${restore.id}`, this.service.discardPlatformRestore(restore.id))))
      await this.load(true);
  }

  askPlan(restore: PlatformRestore): void {
    this.actionError.set(null);
    this.planFor.set(restore);
  }

  onPlanOpenChange(open: boolean): void {
    if (!open) this.planFor.set(null);
  }

  async plan(): Promise<void> {
    const restore = this.planFor();

    this.planFor.set(null);

    if (restore && (await this.act(`plan:${restore.id}`, this.service.planPlatformCutover(restore.id))))
      await this.load(true);
  }

  askApprove(cutover: PlatformCutover): void {
    this.actionError.set(null);
    this.approveFor.set(cutover);
  }

  onApproveOpenChange(open: boolean): void {
    if (!open) this.approveFor.set(null);
  }

  async approve(): Promise<void> {
    const cutover = this.approveFor();

    this.approveFor.set(null);

    if (cutover) {
      await this.act(`approve:${cutover.id}`, this.service.actOnPlatformCutover(cutover.id, 'approve'));
      await this.load(true);
    }
  }

  askCancelCutover(cutover: PlatformCutover): void {
    this.actionError.set(null);
    this.cancelFor.set(cutover);
  }

  onCancelCutoverOpenChange(open: boolean): void {
    if (!open) this.cancelFor.set(null);
  }

  async cancelCutover(): Promise<void> {
    const cutover = this.cancelFor();

    this.cancelFor.set(null);

    if (cutover && (await this.act(`cancel:${cutover.id}`, this.service.actOnPlatformCutover(cutover.id, 'cancel'))))
      await this.load(true);
  }

  /** A restore that can still be discarded. */
  discardable(restore: PlatformRestore): boolean {
    return ['requested', 'restoring', 'ready', 'failed'].includes(restore.state);
  }

  toggleKind(kind: PlatformBackupKindStatus): void {
    this.expandedKind.update((open) => (open === kind.kind ? null : kind.kind));
  }

  toggleCutover(cutover: PlatformCutover): void {
    this.expandedCutoverChoice.set(this.expandedCutover() === cutover.id ? null : cutover.id);
  }

  onKindAction(kind: PlatformBackupKindStatus, action: string): void {
    if (action === 'run') void this.runNow(kind);
  }

  onBackupAction(backup: PlatformBackupRow, action: string): void {
    if (action === 'download' && backup.name) void this.downloadEtcd(backup.name);
  }

  onRestoreAction(restore: PlatformRestore, action: string): void {
    if (action === 'plan') this.askPlan(restore);
    else if (action === 'discard') this.askDiscard(restore);
    else if (action === 'copy-id') fpcCopyText(restore.id);
  }

  onCutoverAction(cutover: PlatformCutover, action: string): void {
    if (action === 'cancel') this.askCancelCutover(cutover);
    else if (action === 'approve') this.askApprove(cutover);
    else if (action === 'copy-id') fpcCopyText(cutover.id);
  }

  /** Bulk Back up now: one run per selected kind (same endpoint + authorization as the row action). */
  async runSelected(): Promise<void> {
    const kinds = this.pickedKinds().filter((k) => !k.running);

    if (kinds.length === 0) return;

    const result = await fpcRunBulk(kinds, (k) => firstValueFrom(this.service.runPlatformBackup(k.kind)));

    this.bulkResult.set(dlBulkSummary(result, (k) => platformKindLabel(k.kind)));
    this.selectedKinds.set([]);
    await this.load(true);
  }

  /** Bulk Discard: one call per selected restore, per-restore result. */
  async discardSelected(): Promise<void> {
    const restores = this.pickedRestores().filter((r) => this.discardable(r) && !this.cutoverFor(r));

    if (restores.length === 0) return;

    const result = await fpcRunBulk(restores, (r) => firstValueFrom(this.service.discardPlatformRestore(r.id)));

    this.bulkResult.set(
      dlBulkSummary(
        result,
        (r) => `${r.targetTime ? new Date(r.targetTime).toLocaleString() : this.latestLabel} (${r.node})`,
      ),
    );
    this.selectedRestores.set([]);
    await this.load(true);
  }

  /** The signed-in admin requested the cut-over: a second cluster admin has to approve. */
  requestedByMe(cutover: PlatformCutover): boolean {
    const me = this.me();

    return !!me?.userId && me.userId === cutover.requestedBy;
  }

  canCancel(cutover: PlatformCutover): boolean {
    return cutover.state === 'planned' || cutover.state === 'approved';
  }

  /** A cut-over is open for this restore. */
  cutoverFor(restore: PlatformRestore): PlatformCutover | null {
    return this.openCutovers().find((c) => c.restoreId === restore.id) ?? null;
  }

  async runCopies(): Promise<void> {
    const results = await this.act('copies', this.service.runPlatformCopies());

    if (results) this.copyResults.set(results);

    await this.load(true);
  }

  async downloadDrInfo(): Promise<void> {
    const doc = await this.act('dr-info', saveDrInfo(this.service, this.document));

    if (doc) this.drCluster.set(doc.clusterId);
  }

  async downloadEtcd(name: string): Promise<void> {
    this.acting.set(`etcd:${name}`);
    this.actionError.set(null);

    try {
      saveFile(this.document, await firstValueFrom(this.service.downloadEtcdSnapshot(name)), name);
    } catch (error) {
      this.actionError.set(
        await apiErrorMessageAsync(error, $localize`:@@lwConsolePlatformBackups-downloadFailed:Download failed`),
      );
    } finally {
      this.acting.set(null);
    }
  }

  copyCommand(): void {
    void navigator.clipboard?.writeText(this.restoreCommand());
    this.commandCopied.set(true);
  }

  /** The declared retention is shorter than the one in effect: it waits for a second admin and the delay. */
  retentionPending(kind: PlatformBackupKindStatus): boolean {
    return kind.keep !== kind.effectiveKeep || !!kind.retentionRequest;
  }
}
