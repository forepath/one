import { CommonModule, DOCUMENT } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import {
  apiErrorMessage,
  BackupsService,
  ConsoleAccessFacade,
  ConsoleBackupsFacade,
  ConsoleLiveFacade,
  liveBaseName,
  normalizeRelativePath,
  type Backup,
  type BackupFileEntry,
  type LiveVolumeTarget,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcEmptyStateComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcPageHeaderComponent,
  FpcPanelComponent,
  FpcSpinnerComponent,
  FpcSummaryBarComponent,
  FpcSummaryCardComponent,
} from '@forepath/shared/frontend/ui-components';
import { combineLatest, firstValueFrom, interval } from 'rxjs';

import { saveFile } from '../live/live-format';
import { formatBytes } from '../overview/console-format';
import {
  BACKUP_STATUS_TONE,
  backupStatusLabel,
  BACKUPS_POLL_MS,
  canAdminister,
  canOperate,
  isLocked,
  joinPath,
  keepReasonLabel,
  pathCrumbs,
  RESTORE_TEST_TONE,
  restoreTestLabel,
  scopeLabel,
} from './backup-format';
import { LoadweaverBackupRestoreModalComponent } from './backup-restore-modal.component';

/**
 * A backup (3.20): what it is (status, size, retention, restore test, immutability, targets) and its files: directory
 * navigation (`?path=`), download a file, restore a file / directory or the whole backup (wizard), compare with
 * another backup of the volume, restore test now.
 */
@Component({
  selector: 'loadweaver-backup-detail-page',
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcEmptyStateComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcPageHeaderComponent,
    FpcPanelComponent,
    FpcSpinnerComponent,
    FpcSummaryBarComponent,
    FpcSummaryCardComponent,
    LoadweaverBackupRestoreModalComponent,
  ],
  templateUrl: './backup-detail-page.component.html',
  standalone: true,
})
export class LoadweaverBackupDetailPageComponent implements OnInit {
  private readonly facade = inject(ConsoleBackupsFacade);
  private readonly service = inject(BackupsService);
  private readonly access = inject(ConsoleAccessFacade);
  private readonly live = inject(ConsoleLiveFacade);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);

  readonly backup = toSignal(this.facade.selected$, { initialValue: null });
  readonly volumeBackups = toSignal(this.facade.volumeBackups$, { initialValue: [] as Backup[] });
  readonly loading = toSignal(this.facade.selectedLoading$, { initialValue: false });
  readonly error = toSignal(this.facade.selectedError$, { initialValue: null });
  readonly files = toSignal(this.facade.files$, { initialValue: null });
  readonly testing = toSignal(this.facade.testing$, { initialValue: [] as string[] });
  readonly actionError = toSignal(this.facade.actionError$, { initialValue: null });
  readonly me = toSignal(this.access.me$, { initialValue: null });
  readonly liveVolumes = toSignal(this.live.volumes$, { initialValue: [] as LiveVolumeTarget[] });

  readonly id = signal('');
  readonly path = signal('');
  readonly downloading = signal<string | null>(null);
  readonly downloadError = signal<string | null>(null);
  readonly restoreOpen = signal(false);
  readonly restorePath = signal<string | null>(null);
  readonly diffOpen = signal(false);
  diffOther = '';

  readonly current = computed(() => {
    const backup = this.backup();

    return backup?.id === this.id() ? backup : null;
  });
  readonly available = computed(() => {
    const backup = this.current();

    return !!backup && backup.status === 'succeeded' && !backup.deletedAt;
  });
  readonly entries = computed(() => {
    const files = this.files();

    if (!files || files.id !== this.id() || files.path !== this.path()) return [] as BackupFileEntry[];

    return [...files.entries].sort((a, b) =>
      a.directory === b.directory ? a.name.localeCompare(b.name) : a.directory ? -1 : 1,
    );
  });
  readonly filesLoading = computed(() => !!this.files()?.loading);
  readonly filesError = computed(() => this.files()?.error ?? null);
  readonly crumbs = computed(() => pathCrumbs(this.path(), this.rootLabel));
  readonly others = computed(() =>
    this.volumeBackups().filter((b) => b.id !== this.id() && b.status === 'succeeded' && !b.deletedAt),
  );
  readonly mayOperate = computed(() => canOperate(this.me(), this.current()?.project ?? null));
  readonly mayRestore = computed(() => this.mayOperate() || canAdminister(this.me(), this.current()?.project ?? null));

  readonly statusTone = BACKUP_STATUS_TONE;
  readonly statusLabel = backupStatusLabel;
  readonly testTone = RESTORE_TEST_TONE;
  readonly testLabel = restoreTestLabel;
  readonly keepLabel = keepReasonLabel;
  readonly scope = scopeLabel;
  readonly bytes = formatBytes;
  readonly locked = isLocked;

  readonly title = $localize`:@@lwConsoleBackupDetail-title:Backup`;
  readonly backLabel = $localize`:@@lwConsoleBackupDetail-back:Backups`;
  readonly rootLabel = $localize`:@@lwConsoleBackupDetail-root:Volume root`;
  readonly statusTitle = $localize`:@@lwConsoleBackupDetail-status:Status`;
  readonly sizeTitle = $localize`:@@lwConsoleBackupDetail-size:Size`;
  readonly addedTitle = $localize`:@@lwConsoleBackupDetail-added:Added to the repository`;
  readonly filesTitle = $localize`:@@lwConsoleBackupDetail-files:Files`;
  readonly detailsTitle = $localize`:@@lwConsoleBackupDetail-details:Details`;
  readonly browserTitle = $localize`:@@lwConsoleBackupDetail-browser:Files in the backup`;
  readonly downloadLabel = $localize`:@@lwConsoleBackupDetail-download:Download`;
  readonly restoreLabel = $localize`:@@lwConsoleBackupDetail-restorePath:Restore this`;
  readonly refreshLabel = $localize`:@@lwConsoleBackupDetail-refresh:Refresh`;
  readonly diffTitle = $localize`:@@lwConsoleBackupDetail-diffTitle:Compare with another backup`;

  ngOnInit(): void {
    combineLatest([this.route.paramMap, this.route.queryParamMap])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([params, query]) => {
        const id = params.get('id') ?? '';
        const path = normalizeRelativePath(query.get('path'));
        const changed = id !== this.id();

        this.id.set(id);
        this.path.set(path);

        if (changed) this.facade.open(id);

        this.facade.browse(id, path);
      });
    this.live.loadTargets();

    // A running backup or restore test changes on its own.
    interval(BACKUPS_POLL_MS)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        const backup = this.current();

        if (backup && (backup.status === 'running' || backup.restoreTest?.status === 'running'))
          this.facade.open(backup.id, true);
      });
  }

  refresh(): void {
    this.facade.open(this.id());
    this.facade.browse(this.id(), this.path());
  }

  go(path: string): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { path: path || null },
      queryParamsHandling: 'merge',
    });
  }

  activate(entry: BackupFileEntry): void {
    if (entry.directory) this.go(joinPath(this.path(), entry.name));
    else void this.download(entry);
  }

  async download(entry: BackupFileEntry): Promise<void> {
    const path = joinPath(this.path(), entry.name);

    this.downloading.set(path);
    this.downloadError.set(null);

    try {
      saveFile(this.document, await firstValueFrom(this.service.download(this.id(), path)), liveBaseName(path));
    } catch (error) {
      this.downloadError.set(
        apiErrorMessage(error, $localize`:@@lwConsoleBackupDetail-downloadFailed:Download failed`),
      );
    } finally {
      this.downloading.set(null);
    }
  }

  /** The wizard for the whole backup (`null`) or one file / directory. */
  openRestore(path: string | null): void {
    this.restorePath.set(path);
    this.restoreOpen.set(true);
  }

  restoreEntry(entry: BackupFileEntry): void {
    this.openRestore(joinPath(this.path(), entry.name));
  }

  testNow(): void {
    this.facade.testNow(this.id());
  }

  openDiff(): void {
    this.diffOther =
      this.others().find((b) => b.startedAt < (this.current()?.startedAt ?? ''))?.id ?? this.others()[0]?.id ?? '';
    this.diffOpen.set(true);
  }

  compare(): void {
    const current = this.current();
    const other = this.others().find((b) => b.id === this.diffOther);

    if (!current || !other) return;

    const [from, to] = other.startedAt <= current.startedAt ? [other, current] : [current, other];

    this.diffOpen.set(false);
    void this.router.navigate(['/backups/diff'], { queryParams: { from: from.id, to: to.id } });
  }

  targetNames(backup: Backup): string {
    return backup.targets.map((t) => t.target).join(', ');
  }
}
