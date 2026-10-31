import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import {
  ConsoleAccessFacade,
  ConsoleBackupsFacade,
  type BackupDeletion,
  type BackupRestore,
  type RestoreTest,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  fpcCopyText,
  FpcDataTableComponent,
  fpcListQueryState,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcPageHeaderComponent,
  FpcTabComponent,
  FpcTabGroupComponent,
  FpcTableCellDirective,
  FpcTableRowDetailDirective,
  type FpcMenuItem,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';
import { interval } from 'rxjs';

import { filterBySearch } from '../list-search';
import { dlCopyIdItem } from '../section/data-list';
import { formatBytes } from '../overview/console-format';
import {
  BACKUPS_IDLE_POLL_TICKS,
  BACKUPS_POLL_MS,
  RESTORE_STATUS_TONE,
  RESTORE_TEST_TONE,
  restoreStatusLabel,
  restoreTestLabel,
} from './backup-format';
import { savedViewBinding } from '../views/saved-views';
import { LoadweaverSavedViewsComponent } from '../views/saved-views.component';

export type RestoresTab = 'restores' | 'tests';

/**
 * Restores (`Restore` resources, executed once per generation) with live progress, and restore tests (automated and
 * "restore test now") with their check hook's result. Polls every 5 s while something runs.
 */
@Component({
  selector: 'loadweaver-backup-restores-page',
  imports: [
    LoadweaverSavedViewsComponent,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcDataTableComponent,
    FpcEmptyStateComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcPageHeaderComponent,
    FpcTableCellDirective,
    FpcTableRowDetailDirective,
    FpcTabComponent,
    FpcTabGroupComponent,
    CommonModule,
    FormsModule,
    RouterModule,
  ],
  templateUrl: './backup-restores-page.component.html',
  styleUrl: './backup-restores-page.component.scss',
  standalone: true,
})
export class LoadweaverBackupRestoresPageComponent implements OnInit {
  private readonly facade = inject(ConsoleBackupsFacade);
  private readonly access = inject(ConsoleAccessFacade);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly restores = toSignal(this.facade.restores$, { initialValue: [] as BackupRestore[] });
  readonly tests = toSignal(this.facade.restoreTests$, { initialValue: [] as RestoreTest[] });
  /** Lane searches (3.37 lane grammar): restores and restore tests. */
  readonly search = signal('');
  readonly testSearch = signal('');
  /** "Views ▾" (3.37): saved lane searches, per user. */
  readonly views = savedViewBinding({ search: this.search, testSearch: this.testSearch });
  readonly visibleRestores = computed(() =>
    filterBySearch(this.restores(), this.search(), (r) => [
      r.name,
      r.project,
      r.volume,
      r.node,
      restoreStatusLabel(r.status),
    ]),
  );
  readonly visibleTests = computed(() =>
    filterBySearch(this.tests(), this.testSearch(), (t) => [t.resource, t.node, restoreTestLabel(t.status)]),
  );
  readonly loaded = toSignal(this.facade.restoresLoaded$, { initialValue: false });
  readonly loading = toSignal(this.facade.restoresLoading$, { initialValue: false });
  readonly error = toSignal(this.facade.restoresError$, { initialValue: null });
  readonly busy = toSignal(this.facade.restoresBusy$, { initialValue: false });
  readonly accessProjects = toSignal(this.access.projects$, { initialValue: [] as string[] });
  readonly isClusterAdmin = toSignal(this.access.isClusterAdmin$, { initialValue: false });
  readonly hasClusterRole = toSignal(this.access.seesInfrastructure$, { initialValue: false });
  readonly openDeletions = toSignal(this.facade.openDeletions$, { initialValue: [] as BackupDeletion[] });
  readonly filtersOpen = signal(false);

  readonly project = signal<string | null>(null);
  readonly activeTab = signal<RestoresTab>('restores');

  readonly projects = computed(() =>
    [
      ...new Set([
        ...this.accessProjects(),
        ...this.restores().map((r) => r.project),
        ...this.tests()
          .map((t) => t.project)
          .filter((p): p is string => !!p),
      ]),
    ].sort(),
  );

  readonly restoreTone = RESTORE_STATUS_TONE;
  readonly restoreLabel = restoreStatusLabel;
  readonly testTone = RESTORE_TEST_TONE;
  readonly testLabel = restoreTestLabel;
  readonly bytes = formatBytes;

  /** Applied filters (+ search) in the URL; the drawer edits a draft until Apply (3.38 R12). */
  readonly filterState = fpcListQueryState({
    filters: { project: this.project },
    search: this.search,
    url: false,
    open: this.filtersOpen,
    changed: () => this.selectProject(this.project()),
  });
  readonly title = $localize`:@@lwConsoleBackupRestores-title:Restores`;
  readonly refreshLabel = $localize`:@@lwConsoleBackupRestores-refresh:Refresh`;
  readonly searchLabel = $localize`:@@lwConsoleBackupRestores-search:Search restores`;
  readonly testSearchLabel = $localize`:@@lwConsoleBackupRestores-searchTests:Search restore tests`;
  readonly loadingLabel = $localize`:@@lwConsoleBackupRestores-loading:Loading restores`;
  readonly openBackupLabel = $localize`:@@lwConsoleBackupRestores-openBackup:Open backup`;
  readonly allProjectsLabel = $localize`:@@lwConsoleBackupRestores-allProjects:All projects`;
  readonly projectLabel = $localize`:@@lwConsoleBackupRestores-project:Project`;
  readonly tabRestores = $localize`:@@lwConsoleBackupRestores-tabRestores:Restores`;
  readonly tabTests = $localize`:@@lwConsoleBackupRestores-tabTests:Restore tests`;
  readonly kindPathLabel = $localize`:@@lwConsoleBackupRestores-kindPath:Single path`;
  readonly kindVolumeLabel = $localize`:@@lwConsoleBackupRestores-kindVolume:Whole volume`;
  readonly expandedTest = signal<string | null>(null);

  /** 3.38 D1: State · Restore (→ its backup) · project · kind · volume · progress · node · started · finished. */
  readonly restoreColumns: FpcTableColumn<BackupRestore>[] = [
    {
      id: 'status',
      label: $localize`:@@lwConsoleBackupRestores-colStatus:Status`,
      type: 'state',
      state: (r) => ({ label: restoreStatusLabel(r.status), tone: RESTORE_STATUS_TONE[r.status] }),
    },
    {
      id: 'name',
      label: $localize`:@@lwConsoleBackupRestores-colRestore:Restore`,
      value: (r) => r.name,
      required: true,
      priority: 1,
    },
    { id: 'project', label: this.projectLabel, value: (r) => r.project, priority: 2 },
    {
      id: 'kind',
      label: $localize`:@@lwConsoleBackupRestores-colKind:Kind`,
      value: (r) => (r.kind === 'path' ? this.kindPathLabel : this.kindVolumeLabel),
      priority: 3,
    },
    {
      id: 'volume',
      label: $localize`:@@lwConsoleBackupRestores-colVolume:Volume`,
      value: (r) => r.volume,
      mono: true,
      priority: 1,
    },
    { id: 'progress', label: $localize`:@@lwConsoleBackupRestores-colProgress:Progress`, priority: 2 },
    { id: 'node', label: $localize`:@@lwConsoleBackupRestores-colNode:Node`, value: (r) => r.node ?? '', priority: 3 },
    {
      id: 'started',
      label: $localize`:@@lwConsoleBackupRestores-colStarted:Started`,
      value: (r) => r.startedAt,
      priority: 2,
    },
    {
      id: 'finished',
      label: $localize`:@@lwConsoleBackupRestores-colFinished:Finished`,
      value: (r) => r.finishedAt,
      priority: 3,
    },
    {
      id: 'error',
      label: $localize`:@@lwConsoleBackupRestores-colError:Error`,
      value: (r) => r.error ?? '',
      priority: 3,
    },
  ];

  /** Restore tests: State · Volume · key generation · started · node · exit code; check + output in the detail. */
  readonly testColumns: FpcTableColumn<RestoreTest>[] = [
    {
      id: 'status',
      label: $localize`:@@lwConsoleBackupRestores-colStatus:Status`,
      type: 'state',
      state: (t) => ({ label: restoreTestLabel(t.status), tone: RESTORE_TEST_TONE[t.status] }),
    },
    {
      id: 'resource',
      label: $localize`:@@lwConsoleBackupRestores-colVolume:Volume`,
      value: (t) => t.resource,
      required: true,
      priority: 1,
      mono: true,
    },
    {
      id: 'keyGeneration',
      label: $localize`:@@lwConsoleBackupRestores-colKeyGeneration:Key generation`,
      value: (t) => t.keyGeneration,
      align: 'end',
      width: '8rem',
      priority: 3,
    },
    {
      id: 'started',
      label: $localize`:@@lwConsoleBackupRestores-colStarted:Started`,
      value: (t) => t.startedAt,
      priority: 1,
    },
    { id: 'node', label: $localize`:@@lwConsoleBackupRestores-colNode:Node`, value: (t) => t.node ?? '', priority: 3 },
    {
      id: 'exitCode',
      label: $localize`:@@lwConsoleBackupRestores-colExitCode:Exit code`,
      value: (t) => t.check?.exitCode ?? null,
      align: 'end',
      width: '7rem',
      priority: 2,
    },
    {
      id: 'error',
      label: $localize`:@@lwConsoleBackupRestores-colError:Error`,
      value: (t) => t.error ?? '',
      priority: 2,
    },
  ];

  readonly backupLink = (r: BackupRestore) => `/operate/backups/${encodeURIComponent(r.backupId)}`;
  readonly menu = (): FpcMenuItem[] => [
    { id: 'open-backup', label: this.openBackupLabel, icon: 'archive' },
    dlCopyIdItem(),
  ];

  ngOnInit(): void {
    const params = this.route.snapshot.queryParamMap;

    this.project.set(params.get('project'));

    if (params.get('tab') === 'tests') this.activeTab.set('tests');

    this.facade.loadRestores(this.project());

    let ticks = 0;

    interval(BACKUPS_POLL_MS)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        ticks++;

        if (this.busy() || ticks % BACKUPS_IDLE_POLL_TICKS === 0) this.facade.loadRestores(this.project(), true);
      });
  }

  onRestoreAction(restore: BackupRestore, action: string): void {
    if (action === 'open-backup') void this.router.navigate(['/operate/backups', restore.backupId]);
    else if (action === 'copy-id') fpcCopyText(restore.id);
  }

  onTestAction(test: RestoreTest, action: string): void {
    if (action === 'open-backup') void this.router.navigate(['/operate/backups', test.backupId]);
    else if (action === 'copy-id') fpcCopyText(test.id);
  }

  toggleTest(test: RestoreTest): void {
    this.expandedTest.update((id) => (id === test.id ? null : test.id));
  }

  refresh(): void {
    this.facade.loadRestores(this.project());
  }

  selectProject(project: string | null): void {
    this.project.set(project || null);
    this.facade.loadRestores(this.project());
    this.navigate({ project: project || null });
  }

  selectTab(tab: string | null): void {
    if (tab !== 'restores' && tab !== 'tests') return;

    this.activeTab.set(tab);
    this.navigate({ tab: tab === 'restores' ? null : tab });
  }

  private navigate(queryParams: Record<string, string | null>): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams,
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
