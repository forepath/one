import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import {
  ConsoleAccessFacade,
  ConsoleOverviewFacade,
  type InboxItem,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcCollapsibleFilterPanelComponent,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcListComponent,
  FpcListItemComponent,
  FpcPageHeaderComponent,
  FpcPanelComponent,
  FpcPanelGridComponent,
  FpcSpinnerComponent,
  FpcStatusBadgeComponent,
  FpcSummaryBarComponent,
  FpcSummaryCardComponent,
} from '@forepath/shared/frontend/ui-components';
import { interval } from 'rxjs';

import { formatBytes, formatShare, HEALTH_ICON, HEALTH_TONE, healthLabel } from './console-format';

const REFRESH_MS = 30_000;

/**
 * The overview (3.25): headline from the health tree, the needs-attention inbox (critical first, oldest first, each
 * with where it's resolved), the summary and recent activity — the whole cluster for cluster roles, a project's for
 * members (who pick the project).
 */
@Component({
  selector: 'loadweaver-overview-page',
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    FpcAlertComponent,
    FpcCollapsibleFilterPanelComponent,
    FpcEmptyStateComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcListComponent,
    FpcListItemComponent,
    FpcPageHeaderComponent,
    FpcPanelComponent,
    FpcPanelGridComponent,
    FpcSpinnerComponent,
    FpcStatusBadgeComponent,
    FpcSummaryBarComponent,
    FpcSummaryCardComponent,
  ],
  templateUrl: './overview-page.component.html',
  standalone: true,
})
export class LoadweaverOverviewPageComponent implements OnInit {
  private readonly facade = inject(ConsoleOverviewFacade);
  private readonly access = inject(ConsoleAccessFacade);
  private readonly destroyRef = inject(DestroyRef);

  readonly overview = toSignal(this.facade.overview$, { initialValue: null });
  readonly loading = toSignal(this.facade.loading$, { initialValue: false });
  readonly error = toSignal(this.facade.error$, { initialValue: null });
  readonly projects = toSignal(this.access.projects$, { initialValue: [] as string[] });
  readonly seesInfrastructure = toSignal(this.access.seesInfrastructure$, { initialValue: false });

  readonly healthTone = HEALTH_TONE;
  readonly healthIcon = HEALTH_ICON;
  readonly healthLabel = healthLabel;
  readonly formatBytes = formatBytes;
  readonly formatShare = formatShare;

  readonly title = $localize`:@@lwConsoleOverview-title:Overview`;
  readonly projectLabel = $localize`:@@lwConsoleOverview-project:Project`;
  readonly allProjects = $localize`:@@lwConsoleOverview-allProjects:Whole cluster`;
  readonly filtersLabel = $localize`:@@lwConsoleOverview-filters:Filters`;

  project = '';
  readonly filtersOpen = signal(false);

  ngOnInit(): void {
    this.facade.load();
    interval(REFRESH_MS)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.facade.load(this.project || undefined, true));
  }

  onProjectChange(project: string): void {
    this.project = project;
    this.facade.load(project || undefined);
  }

  severityTone(item: InboxItem): 'danger' | 'warning' | 'info' {
    return item.severity === 'critical' ? 'danger' : item.severity === 'warning' ? 'warning' : 'info';
  }

  /** Git items (default branch ahead, rejected push, connection error) link to the plan or the connection. */
  isGitItem(item: InboxItem): boolean {
    return item.kind === 'git-ahead' || item.kind === 'git-push-rejected' || item.kind === 'git-error';
  }

  severityIcon(item: InboxItem): string {
    return item.severity === 'critical'
      ? 'bi-exclamation-octagon'
      : item.severity === 'warning'
        ? 'bi-exclamation-triangle'
        : 'bi-info-circle';
  }
}
