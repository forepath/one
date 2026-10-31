import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, effect, inject, input, LOCALE_ID, untracked, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { RouterModule } from '@angular/router';
import {
  ConsoleAccessFacade,
  ConsoleOverviewFacade,
  type ActivityItem,
  type InboxItem,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcDataTableComponent,
  FpcEmptyStateComponent,
  FpcTableCellDirective,
  type FpcTableColumn,
  FpcSectionRowComponent,
  FpcSummaryBarComponent,
  FpcSummaryCardComponent,
  FpcTabComponent,
  FpcTabGroupComponent,
} from '@forepath/shared/frontend/ui-components';
import { interval } from 'rxjs';

import { severityLabel } from '../../alerts/alert-format';
import { filterBySearch } from '../../list-search';
import { activityKindLabel, activityLink, activityText, inboxItemTitle } from '../../overview/activity-format';
import { formatBytes, formatShare, readOnlyAsOf } from '../../overview/console-format';
import { LoadweaverLaneComponent } from '../../section/lane.component';

const REFRESH_MS = 30_000;

/**
 * Summary of a scope (3.37; the former overview, 3.25): the summary bar and two searchable lanes (3.38; the health
 * headline lives in the object header) —
 * Needs attention (critical first, oldest first, each with where it's resolved) | Activity. The Cluster's Summary tab
 * shows the whole cluster, a Project's Summary tab that project.
 */
@Component({
  selector: 'loadweaver-scope-summary',
  imports: [
    FpcTabComponent,
    FpcTabGroupComponent,
    CommonModule,
    RouterModule,
    FpcAlertComponent,
    FpcDataTableComponent,
    FpcEmptyStateComponent,
    FpcTableCellDirective,
    FpcSectionRowComponent,
    FpcSummaryBarComponent,
    LoadweaverLaneComponent,
    FpcSummaryCardComponent,
  ],
  templateUrl: './scope-summary.component.html',
  host: { class: 'd-flex flex-column flex-grow-1 min-h-0' },
  standalone: true,
})
export class LoadweaverScopeSummaryComponent {
  /** Phones (3.37 P7): the lane shown (a tab switch replaces the side-by-side lanes). */
  readonly lane = signal<'inbox' | 'activity'>('inbox');
  /** The project to summarize; null = the whole cluster (what the caller sees of it). */
  readonly project = input<string | null>(null);
  private readonly facade = inject(ConsoleOverviewFacade);
  private readonly access = inject(ConsoleAccessFacade);
  private readonly destroyRef = inject(DestroyRef);
  private readonly locale = inject(LOCALE_ID);

  readonly overview = toSignal(this.facade.overview$, { initialValue: null });
  readonly loading = toSignal(this.facade.loading$, { initialValue: false });
  readonly error = toSignal(this.facade.error$, { initialValue: null });
  readonly seesInfrastructure = toSignal(this.access.seesInfrastructure$, { initialValue: false });

  /** Lane searches (client-side over the loaded overview). */
  readonly inboxSearch = signal('');
  readonly activitySearch = signal('');
  readonly inbox = computed(() =>
    filterBySearch(this.overview()?.inbox ?? [], this.inboxSearch(), (i) => [
      i.title,
      inboxItemTitle(i),
      i.project,
      inboxKindLabel(i.kind),
      severityLabel(i.severity),
    ]),
  );
  readonly activity = computed(() =>
    filterBySearch(this.overview()?.activity ?? [], this.activitySearch(), (a) => [
      activityText(a, this.locale),
      activityKindLabel(a.kind),
      a.message,
      a.entity,
      a.project,
    ]),
  );

  /** 3.38 D1: State (severity) · Issue (link) · kind · project · since. */
  readonly inboxColumns: FpcTableColumn<InboxItem>[] = [
    {
      id: 'severity',
      label: $localize`:@@lwConsoleOverview-colSeverity:Severity`,
      type: 'state',
      state: (item) => ({
        label: severityLabel(item.severity),
        tone: this.severityTone(item),
        icon: this.severityIcon(item).replace(/^bi-/, ''),
      }),
    },
    {
      id: 'title',
      label: $localize`:@@lwConsoleOverview-colIssue:Issue`,
      value: (item) => inboxItemTitle(item),
      required: true,
      priority: 1,
    },
    { id: 'kind', label: $localize`:@@lwConsoleOverview-colKind:Kind`, value: (item) => inboxKindLabel(item.kind) },
    { id: 'project', label: $localize`:@@lwConsoleOverview-colProject:Project`, value: (item) => item.project ?? '' },
    {
      id: 'since',
      label: $localize`:@@lwConsoleOverview-colSince:Since`,
      value: (item) => item.since ?? '',
      priority: 1,
    },
  ];
  readonly inboxId = (item: InboxItem) => `${item.link} ${item.title}`;
  readonly inboxTitleText = inboxItemTitle;
  readonly inboxLink = (item: InboxItem) => item.link;
  /** 3.38 D1: time · message · kind · project (newest first, server order). */
  readonly activityColumns: FpcTableColumn<ActivityItem>[] = [
    {
      id: 'time',
      label: $localize`:@@lwConsoleOverview-colTime:Time`,
      value: (a) => a.time,
      priority: 1,
    },
    {
      id: 'message',
      label: $localize`:@@lwConsoleOverview-colMessage:Activity`,
      // Readable text and names, no raw ids / `kind/name` refs (D7 / D11, LW-03 / LW-04).
      value: (a) => activityText(a, this.locale),
      required: true,
      priority: 1,
    },
    { id: 'kind', label: $localize`:@@lwConsoleOverview-colKind:Kind`, value: (a) => activityKindLabel(a.kind) },
    { id: 'project', label: $localize`:@@lwConsoleOverview-colProject:Project`, value: (a) => a.project ?? '' },
  ];
  readonly activityId = (a: ActivityItem) => `${a.time} ${a.entity} ${a.message}`;
  /** Plan events open their plan, health events the entity's health. */
  readonly activityLink = (a: ActivityItem) => activityLink(a);
  readonly formatBytes = formatBytes;
  readonly formatShare = formatShare;
  readonly asOf = (iso: string | null) => readOnlyAsOf(iso, this.locale);

  readonly inboxTitle = $localize`:@@lwConsoleOverview-inbox:Needs attention`;
  readonly activityTitle = $localize`:@@lwConsoleOverview-activity:Recent activity`;
  readonly inboxSearchLabel = $localize`:@@lwConsoleOverview-inboxSearch:Search issues`;
  readonly activitySearchLabel = $localize`:@@lwConsoleOverview-activitySearch:Search activity`;
  readonly loadingLabel = $localize`:@@lwConsoleOverview-loading:Loading the summary`;

  constructor() {
    effect(() => {
      const project = this.project();

      untracked(() => this.facade.load(project ?? undefined));
    });
    interval(REFRESH_MS)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.facade.load(this.project() ?? undefined, true));
  }

  /** Severity colour of the leading icon (status circles are for health only, 3.38 R10). */
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

/** An inbox item's kind, readable (3.38 D9; unknown kinds as they are). */
export function inboxKindLabel(kind: string): string {
  switch (kind) {
    case 'rollback-failed':
      return $localize`:@@lwConsoleOverview-kindRollbackFailed:Rollback failed`;
    case 'health':
      return $localize`:@@lwConsoleOverview-kindHealth:Health`;
    case 'approval':
      return $localize`:@@lwConsoleOverview-kindApproval:Approval`;
    case 'pins':
      return $localize`:@@lwConsoleOverview-kindPins:Pinned versions`;
    case 'drift':
      return $localize`:@@lwConsoleOverview-kindDrift:Drift`;
    case 'alert':
      return $localize`:@@lwConsoleOverview-kindAlert:Alert`;
    case 'certificate':
      return $localize`:@@lwConsoleOverview-kindCertificate:Certificate`;
    case 'cross-project-request':
      return $localize`:@@lwConsoleOverview-kindCrossProject:Cross-project request`;
    case 'git-ahead':
      return $localize`:@@lwConsoleOverview-kindGitAhead:Git ahead`;
    case 'git-push-rejected':
      return $localize`:@@lwConsoleOverview-kindGitRejected:Git push rejected`;
    case 'git-error':
      return $localize`:@@lwConsoleOverview-kindGitError:Git error`;
    case 'master-key':
      return $localize`:@@lwConsoleOverview-kindMasterKey:Master key`;
    case 'database':
      return $localize`:@@lwConsoleOverview-kindDatabase:Database`;
    default:
      return kind;
  }
}
