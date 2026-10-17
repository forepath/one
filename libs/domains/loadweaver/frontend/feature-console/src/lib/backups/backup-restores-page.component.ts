import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import {
  ConsoleAccessFacade,
  ConsoleBackupsFacade,
  type BackupRestore,
  type RestoreTest,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcEmptyStateComponent,
  FpcListComponent,
  FpcListItemComponent,
  FpcPageHeaderComponent,
  FpcSpinnerComponent,
  FpcTabComponent,
  FpcTabGroupComponent,
} from '@forepath/shared/frontend/ui-components';
import { interval } from 'rxjs';

import { formatBytes } from '../overview/console-format';
import {
  BACKUPS_IDLE_POLL_TICKS,
  BACKUPS_POLL_MS,
  RESTORE_STATUS_TONE,
  RESTORE_TEST_TONE,
  restoreStatusLabel,
  restoreTestLabel,
} from './backup-format';

export type RestoresTab = 'restores' | 'tests';

/**
 * Restores (`Restore` resources, executed once per generation) with live progress, and restore tests (automated and
 * "restore test now") with their check hook's result. Polls every 5 s while something runs.
 */
@Component({
  selector: 'loadweaver-backup-restores-page',
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcEmptyStateComponent,
    FpcListComponent,
    FpcListItemComponent,
    FpcPageHeaderComponent,
    FpcSpinnerComponent,
    FpcTabComponent,
    FpcTabGroupComponent,
  ],
  templateUrl: './backup-restores-page.component.html',
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
  readonly loaded = toSignal(this.facade.restoresLoaded$, { initialValue: false });
  readonly loading = toSignal(this.facade.restoresLoading$, { initialValue: false });
  readonly error = toSignal(this.facade.restoresError$, { initialValue: null });
  readonly busy = toSignal(this.facade.restoresBusy$, { initialValue: false });
  readonly accessProjects = toSignal(this.access.projects$, { initialValue: [] as string[] });

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

  readonly title = $localize`:@@lwConsoleBackupRestores-title:Restores`;
  readonly backLabel = $localize`:@@lwConsoleBackupRestores-back:Backups`;
  readonly refreshLabel = $localize`:@@lwConsoleBackupRestores-refresh:Refresh`;
  readonly allProjectsLabel = $localize`:@@lwConsoleBackupRestores-allProjects:All projects`;
  readonly tabRestores = $localize`:@@lwConsoleBackupRestores-tabRestores:Restores`;
  readonly tabTests = $localize`:@@lwConsoleBackupRestores-tabTests:Restore tests`;

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
