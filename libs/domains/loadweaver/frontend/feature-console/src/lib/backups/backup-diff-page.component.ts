import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { ConsoleBackupsFacade } from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcDataTableComponent,
  FpcEmptyStateComponent,
  FpcPageHeaderComponent,
  FpcSummaryBarComponent,
  FpcSummaryCardComponent,
  FpcTableCellDirective,
  type FpcTableColumn,
  type FpcTableState,
} from '@forepath/shared/frontend/ui-components';

import { formatBytes } from '../overview/console-format';
import { sizeDelta } from './backup-format';
import { filterBySearch } from '../list-search';

/** One changed path of the comparison (one table, grouped by the kind of change). */
export interface BackupDiffRow {
  kind: 'added' | 'removed' | 'changed';
  path: string;
  directory: boolean;
  before: number | null;
  after: number | null;
}

/** Changed files between two backups of the same volume (`?from=&to=`): added, removed and changed, with sizes. */
@Component({
  selector: 'loadweaver-backup-diff-page',
  imports: [
    CommonModule,
    RouterModule,
    FpcAlertComponent,
    FpcEmptyStateComponent,
    FpcPageHeaderComponent,
    FpcBadgeComponent,
    FpcDataTableComponent,
    FpcTableCellDirective,
    FpcSummaryBarComponent,
    FpcSummaryCardComponent,
  ],
  templateUrl: './backup-diff-page.component.html',
  standalone: true,
})
export class LoadweaverBackupDiffPageComponent implements OnInit {
  private readonly facade = inject(ConsoleBackupsFacade);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  readonly diff = toSignal(this.facade.diff$, { initialValue: null });

  readonly result = computed(() => this.diff()?.result ?? null);
  readonly loading = computed(() => !!this.diff()?.loading);
  readonly error = computed(() => this.diff()?.error ?? null);
  readonly addedBytes = computed(() => (this.result()?.diff.added ?? []).reduce((s, a) => s + (a.size ?? 0), 0));
  readonly removedBytes = computed(() => (this.result()?.diff.removed ?? []).reduce((s, r) => s + (r.size ?? 0), 0));

  readonly bytes = formatBytes;
  readonly delta = sizeDelta;

  readonly title = $localize`:@@lwConsoleBackupDiff-title:Compare backups`;
  readonly backLabel = $localize`:@@lwConsoleBackupDiff-back:Backups`;
  readonly addedTitle = $localize`:@@lwConsoleBackupDiff-added:Added`;
  readonly removedTitle = $localize`:@@lwConsoleBackupDiff-removed:Removed`;
  readonly changedTitle = $localize`:@@lwConsoleBackupDiff-changed:Changed`;
  readonly searchLabel = $localize`:@@lwConsoleBackupDiff-search:Search paths`;
  readonly noneTitle = $localize`:@@lwConsoleBackupDiff-none:No files`;

  /** 3.38 D1 + decision 4: one table of the changed paths, grouped by added | removed | changed, one search. */
  readonly search = signal('');
  readonly rows = computed<BackupDiffRow[]>(() => {
    const diff = this.result()?.diff;

    if (!diff) return [];

    return [
      ...diff.added.map((a) => ({
        kind: 'added' as const,
        path: a.path,
        directory: a.directory,
        before: null,
        after: a.size,
      })),
      ...diff.removed.map((d) => ({
        kind: 'removed' as const,
        path: d.path,
        directory: d.directory,
        before: d.size,
        after: null,
      })),
      ...diff.changed.map((c) => ({
        kind: 'changed' as const,
        path: c.path,
        directory: false,
        before: c.before,
        after: c.after,
      })),
    ];
  });
  readonly visibleRows = computed(() => filterBySearch(this.rows(), this.search(), (row) => [row.path]));
  private readonly kindStates: Record<BackupDiffRow['kind'], FpcTableState> = {
    added: { label: this.addedTitle, tone: 'success', icon: 'plus-circle' },
    removed: { label: this.removedTitle, tone: 'danger', icon: 'dash-circle' },
    changed: { label: this.changedTitle, tone: 'info', icon: 'pencil' },
  };
  readonly columns: FpcTableColumn<BackupDiffRow>[] = [
    {
      id: 'kind',
      label: $localize`:@@lwConsoleBackupDiff-colChange:Change`,
      type: 'state',
      state: (row) => this.kindStates[row.kind],
    },
    {
      id: 'path',
      label: $localize`:@@lwConsoleBackupDiff-colPath:Path`,
      value: (row) => row.path + (row.directory ? '/' : ''),
      required: true,
      priority: 1,
      mono: true,
    },
    {
      id: 'before',
      label: $localize`:@@lwConsoleBackupDiff-colBefore:Before`,
      value: (row) => row.before,
      align: 'end',
      width: '8rem',
      priority: 2,
    },
    {
      id: 'after',
      label: $localize`:@@lwConsoleBackupDiff-colAfter:After`,
      value: (row) => row.after,
      align: 'end',
      width: '8rem',
      priority: 2,
    },
    {
      id: 'delta',
      label: $localize`:@@lwConsoleBackupDiff-sizeChange:Size change`,
      value: (row) => (row.kind === 'changed' ? this.delta(row.before, row.after) : null),
      align: 'end',
      width: '8rem',
      priority: 1,
    },
  ];
  readonly rowId = (row: BackupDiffRow) => `${row.kind}:${row.path}`;
  readonly groupOf = (row: BackupDiffRow) => row.kind;
  readonly groupLabel = (kind: string) => this.kindStates[kind as BackupDiffRow['kind']]?.label ?? kind;
  readonly sizeChangeTitle = $localize`:@@lwConsoleBackupDiff-sizeChange:Size change`;
  readonly loadingLabel = $localize`:@@lwConsoleBackupDiff-loading:Comparing the backups`;

  ngOnInit(): void {
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const from = params.get('from');
      const to = params.get('to');

      if (from && to) this.facade.compare(from, to);
    });
  }

  signed(value: number | null): string {
    if (value === null) return '–';

    return `${value > 0 ? '+' : value < 0 ? '−' : '±'}${formatBytes(Math.abs(value))}`;
  }
}
