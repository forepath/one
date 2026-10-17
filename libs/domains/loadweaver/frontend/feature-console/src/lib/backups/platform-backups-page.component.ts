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
  type PlatformBackupKind,
  type PlatformBackupKindStatus,
  type PlatformBackupRunResult,
  type PlatformBackupStatus,
  type PlatformCopyRunResult,
  type PlatformCutover,
  type PlatformRestore,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcConfirmDialogComponent,
  FpcEmptyStateComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcPageHeaderComponent,
  FpcPanelComponent,
  FpcSpinnerComponent,
  FpcStatusBadgeComponent,
} from '@forepath/shared/frontend/ui-components';
import { catchError, firstValueFrom, forkJoin, interval, of, type Observable } from 'rxjs';

import { saveFile } from '../live/live-format';
import { formatBytes } from '../overview/console-format';
import { BACKUPS_IDLE_POLL_TICKS, BACKUPS_POLL_MS, isLocked } from './backup-format';
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

/**
 * Control-plane ("platform") backups and disaster recovery (M6): the cluster's own Postgres, OpenSearch and etcd per
 * kind (schedule, retention, last run, back up now), point-in-time recovery of Postgres into a separate scope and the
 * cut-over to it (planned, approved by a second cluster admin, executed), the external copy to off-cluster targets and
 * the DR info a fresh node is rebuilt from. Cluster roles read; cluster admins act (the API decides in the end).
 */
@Component({
  selector: 'loadweaver-platform-backups-page',
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcConfirmDialogComponent,
    FpcEmptyStateComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcPageHeaderComponent,
    FpcPanelComponent,
    FpcSpinnerComponent,
    FpcStatusBadgeComponent,
  ],
  templateUrl: './platform-backups-page.component.html',
  standalone: true,
})
export class LoadweaverPlatformBackupsPageComponent implements OnInit {
  private readonly service = inject(BackupsService);
  private readonly access = inject(ConsoleAccessFacade);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);

  readonly me = toSignal(this.access.me$, { initialValue: null });
  readonly isClusterAdmin = toSignal(this.access.isClusterAdmin$, { initialValue: false });

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
  readonly runTone = platformStatusTone;
  readonly runLabel = platformStatusLabel;
  readonly restoreTone = PLATFORM_RESTORE_TONE;
  readonly restoreLabel = platformRestoreLabel;
  readonly cutoverTone = PLATFORM_CUTOVER_TONE;
  readonly cutoverLabel = platformCutoverLabel;
  readonly bytes = formatBytes;
  readonly locked = isLocked;

  readonly title = $localize`:@@lwConsolePlatformBackups-title:Platform backups and disaster recovery`;
  readonly backLabel = $localize`:@@lwConsolePlatformBackups-back:Backups`;
  readonly refreshLabel = $localize`:@@lwConsolePlatformBackups-refresh:Refresh`;
  readonly cancelLabel = $localize`:@@lwConsolePlatformBackups-cancel:Cancel`;
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
