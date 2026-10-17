import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { ConsoleBackupsFacade } from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcButtonComponent,
  FpcEmptyStateComponent,
  FpcPageHeaderComponent,
  FpcPanelComponent,
  FpcSpinnerComponent,
  FpcSummaryBarComponent,
  FpcSummaryCardComponent,
} from '@forepath/shared/frontend/ui-components';

import { formatBytes } from '../overview/console-format';
import { sizeDelta } from './backup-format';

/** Changed files between two backups of the same volume (`?from=&to=`): added, removed and changed, with sizes. */
@Component({
  selector: 'loadweaver-backup-diff-page',
  imports: [
    CommonModule,
    RouterModule,
    FpcAlertComponent,
    FpcButtonComponent,
    FpcEmptyStateComponent,
    FpcPageHeaderComponent,
    FpcPanelComponent,
    FpcSpinnerComponent,
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
  readonly sizeChangeTitle = $localize`:@@lwConsoleBackupDiff-sizeChange:Size change`;

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
