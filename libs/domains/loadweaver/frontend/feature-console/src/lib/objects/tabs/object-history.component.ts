import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  ConsoleAuditService,
  PlansService,
  type AuditEntry,
  type Plan,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcButtonComponent,
  FpcEmptyStateComponent,
  FpcDataTableComponent,
  fpcCopyText,
  FpcTableCellDirective,
  type FpcMenuItem,
  type FpcTableColumn,
  FpcSectionRowComponent,
  FpcTabComponent,
  FpcTabGroupComponent,
} from '@forepath/shared/frontend/ui-components';
import { forkJoin, of, catchError } from 'rxjs';

import { apiErrorMessage } from '../../workspace/workspace-draft.store';
import { auditActorLabel } from '../../audit/audit-page.component';
import { planStatusLabel, planSummary, PLAN_STATUS_BADGE_TONE, PLAN_STATUS_ICON } from '../../plans/plan-format';
import { dlCopyIdItem, dlOpenItem } from '../../section/data-list';
import { LoadweaverLaneComponent } from '../../section/lane.component';
import { objectHistoryTarget, plansTouching, type ObjectHistoryTarget } from '../object-history';
import type { ResourceObjectRef } from '../resources-context.service';

/**
 * Task history of an object (3.37): the plans that change it and its audit entries, as two lanes; "Open all" (icon
 * button in the lane header, 3.38) goes to Activity › Plans / Audit with the same filter.
 */
@Component({
  selector: 'loadweaver-object-history',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FpcTabComponent,
    FpcTabGroupComponent,
    DatePipe,
    RouterLink,
    FpcAlertComponent,
    FpcButtonComponent,
    FpcEmptyStateComponent,
    FpcDataTableComponent,
    FpcTableCellDirective,
    FpcSectionRowComponent,
    LoadweaverLaneComponent,
  ],
  host: { class: 'd-flex flex-column flex-grow-1 min-h-0' },
  template: `
    @if (error(); as message) {
      <fpc-alert [flush]="true" variant="danger" [message]="message" />
    }
    <fpc-tab-group
      class="fpc-lane-tabs"
      [activeId]="lane()"
      (activeIdChange)="lane.set($any($event))"
      [ariaLabel]="tasksTitle"
    >
      <fpc-tab id="tasks" [label]="tasksTitle" />
      <fpc-tab id="events" [label]="eventsTitle" />
    </fpc-tab-group>
    <fpc-section-row class="flex-grow-1 min-h-0">
      <loadweaver-lane [title]="tasksTitle" [flush]="true" [off]="lane() !== 'tasks'" data-testid="history-plans">
        <fpc-button
          lwLaneActions
          variant="dark"
          size="sm"
          iconOnly
          routerLink="/activity/plans"
          [queryParams]="plansParams()"
          [ariaLabel]="openAllPlansLabel"
          [title]="openAllPlansLabel"
          data-testid="history-plans-open-all"
        >
          <i class="bi bi-box-arrow-up-right" aria-hidden="true"></i>
        </fpc-button>
        <!-- State · Plan (link) · created; ⋮ Open / Copy ID (3.38 D1). -->
        <fpc-data-table
          class="flex-grow-1 min-h-0"
          [ariaLabel]="tasksTitle"
          [columns]="planColumns"
          [rows]="plans()"
          [rowLink]="planLink"
          [searchable]="false"
          [loading]="loading() && plans().length === 0"
          paging="client"
          persistKey="lw-object-history-plans"
          [rowMenu]="planMenu"
          (rowAction)="onPlanAction($event.row, $event.item.id)"
          emptyIcon="clock-history"
          data-testid="history-plans-table"
        >
          <span fpcDataTableEmpty>
            <fpc-empty-state icon="clock-history" size="sm" [title]="noTasksLabel" />
          </span>
          <ng-template fpcTableCell="created" let-row>{{ row.createdAt | date: 'short' }}</ng-template>
        </fpc-data-table>
      </loadweaver-lane>
      <loadweaver-lane [title]="eventsTitle" [flush]="true" [off]="lane() !== 'events'" data-testid="history-audit">
        <fpc-button
          lwLaneActions
          variant="dark"
          size="sm"
          iconOnly
          routerLink="/activity/audit"
          [queryParams]="auditParams()"
          [ariaLabel]="openAllEventsLabel"
          [title]="openAllEventsLabel"
          data-testid="history-audit-open-all"
        >
          <i class="bi bi-box-arrow-up-right" aria-hidden="true"></i>
        </fpc-button>
        <!-- Time · Action · Target · Actor (3.38 D1; feed → table). -->
        <fpc-data-table
          class="flex-grow-1 min-h-0"
          [ariaLabel]="eventsTitle"
          [columns]="eventColumns"
          [rows]="entries()"
          [rowId]="eventId"
          [searchable]="false"
          [loading]="loading() && entries().length === 0"
          paging="client"
          persistKey="lw-object-history-events"
          emptyIcon="journal-text"
          data-testid="history-audit-table"
        >
          <span fpcDataTableEmpty>
            <fpc-empty-state icon="journal-text" size="sm" [title]="noEventsLabel" />
          </span>
          <ng-template fpcTableCell="at" let-row>{{ row.at | date: 'short' }}</ng-template>
        </fpc-data-table>
      </loadweaver-lane>
    </fpc-section-row>
  `,
})
export class LoadweaverObjectHistoryComponent {
  /** Phones (3.37 P7): the lane shown (a tab switch replaces the side-by-side lanes). */
  readonly lane = signal<'tasks' | 'events'>('tasks');
  private readonly audit = inject(ConsoleAuditService);
  private readonly plansApi = inject(PlansService);

  readonly ref = input.required<ResourceObjectRef>();
  /** The real resource kind (`VirtualMachine` for `virtualmachine`). */
  readonly resourceKind = input('');

  readonly plans = signal<Plan[]>([]);
  readonly entries = signal<AuditEntry[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly target = signal<ObjectHistoryTarget | null>(null);

  private readonly router = inject(Router);

  /** 3.38 D1: State · Plan (link) · created. */
  readonly planColumns: FpcTableColumn<Plan>[] = [
    {
      id: 'status',
      label: $localize`:@@lwConsolePlans-colStatus:Status`,
      type: 'state',
      state: (plan) => ({
        label: planStatusLabel(plan.status),
        tone: PLAN_STATUS_BADGE_TONE[plan.status],
        icon: PLAN_STATUS_ICON[plan.status].replace(/^bi-/, ''),
      }),
    },
    {
      id: 'summary',
      label: $localize`:@@lwConsolePlans-colPlan:Plan`,
      value: (plan) => planSummary(plan),
      required: true,
      priority: 1,
    },
    {
      id: 'created',
      label: $localize`:@@lwConsolePlans-colCreated:Created`,
      value: (plan) => plan.createdAt,
      priority: 1,
    },
  ];
  /** Audit events, newest first (server order). */
  readonly eventColumns: FpcTableColumn<AuditEntry>[] = [
    {
      id: 'at',
      label: $localize`:@@lwConsoleAudit-colTime:Time`,
      value: (e) => e.at,
      required: true,
      priority: 1,
    },
    { id: 'action', label: $localize`:@@lwConsoleAudit-colAction:Action`, value: (e) => e.action, priority: 1 },
    { id: 'target', label: $localize`:@@lwConsoleAudit-colTarget:Target`, value: (e) => e.target, mono: true },
    {
      id: 'actor',
      label: $localize`:@@lwConsoleAudit-colActor:Actor`,
      value: (e) => auditActorLabel(e),
    },
  ];
  readonly eventId = (entry: AuditEntry) => String(entry.seq);
  readonly planLink = (plan: Plan): string => `/activity/plans/${encodeURIComponent(plan.id)}`;
  readonly planMenu = (): FpcMenuItem[] => [dlOpenItem(), dlCopyIdItem()];

  onPlanAction(plan: Plan, action: string): void {
    if (action === 'open') void this.router.navigateByUrl(this.planLink(plan));
    else if (action === 'copy-id') fpcCopyText(plan.id);
  }

  readonly tasksTitle = $localize`:@@lwConsoleHistory-tasks:Plans touching this object`;
  readonly eventsTitle = $localize`:@@lwConsoleHistory-events:Events`;
  readonly openAllPlansLabel = $localize`:@@lwConsoleHistory-openAllPlans:Open all plans`;
  readonly openAllEventsLabel = $localize`:@@lwConsoleHistory-openAllEvents:Open all audit events`;
  readonly noTasksLabel = $localize`:@@lwConsoleHistory-noTasks:No plans changed this yet`;
  readonly noEventsLabel = $localize`:@@lwConsoleHistory-noEvents:No events yet`;
  readonly loadingLabel = $localize`:@@lwConsoleHistory-loading:Loading the history`;

  constructor() {
    effect(() => {
      const target = objectHistoryTarget(this.ref(), this.resourceKind());

      untracked(() => this.load(target));
    });
  }

  plansParams(): Record<string, string> {
    const project = this.target()?.project;

    return project ? { project } : {};
  }

  auditParams(): Record<string, string> {
    const audit = this.target()?.audit ?? {};

    return Object.fromEntries(
      Object.entries({ target: audit.target, text: audit.text, project: audit.project }).filter(
        (entry): entry is [string, string] => !!entry[1],
      ),
    );
  }

  private load(target: ObjectHistoryTarget): void {
    this.target.set(target);
    this.loading.set(true);
    this.error.set(null);

    const fail = (error: unknown) => {
      this.error.set(apiErrorMessage(error));

      return of(null);
    };

    forkJoin({
      plans: this.plansApi
        .list({ limit: 200, ...(target.project ? { project: target.project } : {}) })
        .pipe(catchError(fail)),
      audit: this.audit.list(target.audit).pipe(catchError(fail)),
    }).subscribe(({ plans, audit }) => {
      this.plans.set(plansTouching(plans ?? [], target));
      this.entries.set(audit?.entries ?? []);
      this.loading.set(false);
    });
  }
}
