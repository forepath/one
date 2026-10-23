import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import {
  backupTimeline,
  ConsoleAccessFacade,
  ConsoleBackupsFacade,
  ConsoleLiveFacade,
  type Backup,
  type BackupDeletion,
  type BackupVolume,
  type LiveVolumeTarget,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcCollapsibleFilterPanelComponent,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcListComponent,
  FpcListItemComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcPageHeaderComponent,
  FpcPanelComponent,
  FpcPanelGridComponent,
  FpcSpinnerComponent,
  FpcStatusBadgeComponent,
  FpcSummaryBarComponent,
  FpcSummaryCardComponent,
} from '@forepath/shared/frontend/ui-components';
import { interval } from 'rxjs';

import { formatBytes } from '../overview/console-format';
import { LoadweaverBackupsNavComponent } from './backups-nav.component';
import {
  BACKUP_STATUS_TONE,
  backupStatusLabel,
  BACKUPS_IDLE_POLL_TICKS,
  BACKUPS_POLL_MS,
  canAdminister,
  canOperate,
  isLocked,
  keepReasonLabel,
  RESTORE_TEST_TONE,
  restoreTestLabel,
} from './backup-format';
import { LoadweaverBackupRestoreModalComponent } from './backup-restore-modal.component';

/** A volume the catalog lists: with backups, or (from the topology) without any yet. */
export interface CatalogVolume extends BackupVolume {
  /** Only known from the topology. */
  empty: boolean;
}

/**
 * Backups (3.20): pins, key / kit state, usage per project and target status; the catalog grouped by volume with a
 * timeline per volume (status, size, retention, restore test, immutability, targets) and the actions per backup
 * (browse, diff, restore, restore test, deletion request) and per volume (back up now).
 */
@Component({
  selector: 'loadweaver-backups-page',
  imports: [
    FpcCollapsibleFilterPanelComponent,
    FpcFormFieldComponent,
    FpcFormControlComponent,
    FpcPanelGridComponent,
    FpcListComponent,
    FpcListItemComponent,
    LoadweaverBackupsNavComponent,
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
    FpcStatusBadgeComponent,
    FpcSummaryBarComponent,
    FpcSummaryCardComponent,
    LoadweaverBackupRestoreModalComponent,
  ],
  templateUrl: './backups-page.component.html',
  styleUrl: './backups-page.component.scss',
  standalone: true,
})
export class LoadweaverBackupsPageComponent implements OnInit {
  private readonly facade = inject(ConsoleBackupsFacade);
  private readonly access = inject(ConsoleAccessFacade);
  private readonly live = inject(ConsoleLiveFacade);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly status = toSignal(this.facade.status$, { initialValue: null });
  readonly volumes = toSignal(this.facade.volumes$, { initialValue: [] as BackupVolume[] });
  readonly openDeletions = toSignal(this.facade.openDeletions$, { initialValue: [] as BackupDeletion[] });
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
  readonly hasClusterRole = toSignal(this.access.seesInfrastructure$, { initialValue: false });
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

  /** Volumes with backups, then (from the topology) the project's volumes that have none yet. */
  readonly catalog = computed<CatalogVolume[]>(() => {
    const project = this.project();
    const listed = this.volumes()
      .filter((v) => !project || v.project === project)
      .map((v) => ({ ...v, empty: false }));
    const known = new Set(listed.map((v) => v.resource));
    const empty = this.liveVolumes()
      .filter((v) => (!project || v.project === project) && !known.has(v.id))
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
  readonly usage = computed(() => {
    const project = this.project();

    return (this.status()?.usage ?? []).filter((u) => !project || u.project === project);
  });
  readonly totals = computed(() =>
    this.usage().reduce(
      (sum, u) => ({
        backups: sum.backups + u.backups,
        bytes: sum.bytes + u.bytes,
        stored: sum.stored + u.uploadedBytes,
      }),
      { backups: 0, bytes: 0, stored: 0 },
    ),
  );
  readonly kitState = computed(() => {
    const keys = this.status()?.keys;

    if (!keys || keys.generation === null) return 'none';

    return keys.kitConfirmed ? 'confirmed' : keys.escrowed ? 'escrowed' : 'unconfirmed';
  });

  /** Restore wizard, diff picker and deletion request dialog. */
  readonly restoreFor = signal<{ backup: Backup; candidates: Backup[] } | null>(null);
  readonly restoreOpen = signal(false);
  readonly diffFor = signal<{ backup: Backup; others: Backup[] } | null>(null);
  diffOther = '';
  readonly deleteFor = signal<Backup | null>(null);
  deletionReason = '';

  readonly statusTone = BACKUP_STATUS_TONE;
  readonly statusLabel = backupStatusLabel;
  readonly testTone = RESTORE_TEST_TONE;
  readonly testLabel = restoreTestLabel;
  readonly keepLabel = keepReasonLabel;
  readonly bytes = formatBytes;
  readonly locked = isLocked;
  readonly timeline = backupTimeline;

  readonly title = $localize`:@@lwConsoleBackups-title:Backups`;
  readonly refreshLabel = $localize`:@@lwConsoleBackups-refresh:Refresh`;
  readonly allProjectsLabel = $localize`:@@lwConsoleBackups-allProjects:All projects`;
  readonly filtersTitle = $localize`:@@lwConsoleBackups-filters:Filters`;
  readonly projectLabel = $localize`:@@lwConsoleBackups-project:Project`;
  readonly filtersOpen = signal(false);
  readonly keyLabel = $localize`:@@lwConsoleBackups-keyCard:Recovery kit`;
  readonly backupsLabel = $localize`:@@lwConsoleBackups-backupsCard:Backups`;
  readonly sizeLabel = $localize`:@@lwConsoleBackups-sizeCard:Backed-up data`;
  readonly storedLabel = $localize`:@@lwConsoleBackups-storedCard:Stored after deduplication`;
  readonly deletionsLabel = $localize`:@@lwConsoleBackups-deletionsCard:Pending deletions`;
  readonly usageTitle = $localize`:@@lwConsoleBackups-usageTitle:Usage per project`;
  readonly targetsTitle = $localize`:@@lwConsoleBackups-targetsTitle:Backup targets`;
  readonly catalogTitle = $localize`:@@lwConsoleBackups-catalogTitle:Catalog`;
  readonly diffTitle = $localize`:@@lwConsoleBackups-diffTitle:Compare with another backup`;
  readonly deleteTitle = $localize`:@@lwConsoleBackups-deleteTitle:Request deletion`;
  readonly browseLabel = $localize`:@@lwConsoleBackups-browse:Browse files`;
  readonly compareLabel = $localize`:@@lwConsoleBackups-compare:Compare`;
  readonly restoreLabel = $localize`:@@lwConsoleBackups-restore:Restore`;
  readonly testNowLabel = $localize`:@@lwConsoleBackups-testNow:Restore test now`;
  readonly deleteLabel = $localize`:@@lwConsoleBackups-delete:Request deletion`;
  readonly kitStateLabels: Record<string, string> = {
    none: $localize`:@@lwConsoleBackups-kitNone:No key yet`,
    confirmed: $localize`:@@lwConsoleBackups-kitConfirmed:Confirmed`,
    escrowed: $localize`:@@lwConsoleBackups-kitEscrowed:KMS escrow only`,
    unconfirmed: $localize`:@@lwConsoleBackups-kitUnconfirmed:Not confirmed`,
  };

  ngOnInit(): void {
    this.project.set(this.route.snapshot.queryParamMap.get('project'));
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
    void this.router.navigate(['/backups/diff'], { queryParams: { from: from.id, to: to.id } });
  }

  openDelete(backup: Backup): void {
    this.deletionReason = '';
    this.facade.clearDeletionRequest();
    this.deleteFor.set(backup);
  }

  onDiffOpenChange(open: boolean): void {
    if (!open) this.diffFor.set(null);
  }

  onDeleteOpenChange(open: boolean): void {
    if (!open) this.closeDelete();
  }

  closeDelete(): void {
    this.deleteFor.set(null);
    this.facade.clearDeletionRequest();
  }

  requestDeletion(): void {
    const backup = this.deleteFor();

    if (backup && this.deletionReason.trim().length >= 3)
      this.facade.requestDeletion([backup.id], this.deletionReason.trim());
  }

  targetNames(backup: Backup): string {
    return backup.targets.map((t) => t.target).join(', ');
  }

  timelineTitle(backup: Backup): string {
    return `${new Date(backup.startedAt).toLocaleString()} · ${backupStatusLabel(backup.status)} · ${formatBytes(backup.bytes)}`;
  }
}
