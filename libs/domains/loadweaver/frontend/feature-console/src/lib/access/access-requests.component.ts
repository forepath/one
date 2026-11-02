import { CommonModule } from '@angular/common';
import { Component, computed, inject, Injector, input, model, output, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AccessManagementService, type CrossProjectRequest } from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcBadgeComponent,
  FpcButtonComponent,
  fpcCopyText,
  FpcDataTableComponent,
  FpcEmptyStateComponent,
  fpcRunBulk,
  FpcTableCellDirective,
  type FpcMenuItem,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';
import { firstValueFrom } from 'rxjs';

import { filterBySearch } from '../list-search';
import { dlBulkSummary } from '../section/data-list';

/**
 * Cross-project requests towards a project (3.17): policies of other projects reaching its groups, from pending plans
 * and applied policies. Operators and admins of the project accept exactly the version listed (spec hash; copied from
 * ⋮, not shown as data — 3.38 D11).
 */
@Component({
  selector: 'loadweaver-access-requests',
  imports: [
    CommonModule,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcDataTableComponent,
    FpcEmptyStateComponent,
    FpcTableCellDirective,
  ],
  templateUrl: './access-requests.component.html',
  standalone: true,
  // A flex column that fills its parent, so the table / empty state stretches like a page-level one.
  host: { class: 'd-flex flex-column flex-grow-1 min-h-0' },
})
export class LoadweaverAccessRequestsComponent {
  private readonly injector = inject(Injector);
  private readonly router = inject(Router);

  readonly requests = input<CrossProjectRequest[]>([]);
  /** The caller may accept (operator or admin of the accepting project). */
  readonly mayAccept = input(false);
  readonly changing = input(false);
  /** The table search (client-side over project, policy). */
  readonly search = model('');
  readonly searchLabel = input<string | null>(null);
  /** One request to accept (the page confirms it). */
  readonly accept = output<CrossProjectRequest>();
  /** Bulk Accept finished: the per-request result summary. */
  readonly bulkDone = output<{ tone: 'success' | 'warning' | 'danger'; message: string }>();

  readonly visible = computed(() =>
    filterBySearch(this.requests(), this.search(), (r) => [r.project, r.policy, this.stateLabel(r)]),
  );
  readonly selected = signal<readonly string[]>([]);

  readonly requestsLabel = $localize`:@@lwConsoleAccess-requests:Requests from other projects`;
  readonly openPlanLabel = $localize`:@@lwConsoleAccess-requestOpenPlan:Open plan`;
  readonly acceptLabel = $localize`:@@lwConsoleAccess-accept:Accept`;
  readonly copyVersionLabel = $localize`:@@lwConsoleAccess-copyVersion:Copy version`;

  /** 3.38 D1: State · requesting project · policy · source. */
  readonly columns: FpcTableColumn<CrossProjectRequest>[] = [
    {
      id: 'state',
      label: $localize`:@@lwConsoleAccess-colState:State`,
      type: 'state',
      state: (r) => ({ label: this.stateLabel(r), tone: r.accepted ? 'success' : 'warning' }),
    },
    {
      id: 'project',
      label: $localize`:@@lwConsoleAccess-colFromProject:From project`,
      value: (r) => r.project,
      required: true,
      priority: 1,
    },
    {
      id: 'policy',
      label: $localize`:@@lwConsoleAccess-colPolicy:Policy`,
      value: (r) => r.policy,
      mono: true,
      priority: 1,
    },
    { id: 'source', label: $localize`:@@lwConsoleAccess-colSource:Source` },
  ];

  private readonly selectedRequests = computed(() => {
    const ids = new Set(this.selected());

    return this.requests().filter((r) => ids.has(this.key(r)));
  });
  readonly canAcceptSelection = computed(
    () => this.mayAccept() && this.selectedRequests().length > 0 && this.selectedRequests().every((r) => !r.accepted),
  );

  readonly key = (request: CrossProjectRequest): string =>
    `${request.project}/${request.policy}/${request.specHash}/${request.planId ?? ''}`;
  /** The pending plan proposing it (applied policies have none). */
  readonly planLink = (request: CrossProjectRequest): string | null =>
    request.planId ? `/activity/plans/${encodeURIComponent(request.planId)}` : null;
  readonly rowMenu = (request: CrossProjectRequest): FpcMenuItem[] => [
    ...(request.planId ? [{ id: 'open-plan', label: this.openPlanLabel, icon: 'box-arrow-in-right' }] : []),
    ...(this.mayAccept() && !request.accepted ? [{ id: 'accept', label: this.acceptLabel, icon: 'check-lg' }] : []),
    { id: 'copy-version', label: this.copyVersionLabel, icon: 'clipboard', dividerBefore: true },
  ];

  stateLabel(request: CrossProjectRequest): string {
    return request.accepted
      ? $localize`:@@lwConsoleAccess-requestAccepted:Accepted`
      : $localize`:@@lwConsoleAccess-requestOpen:Waiting`;
  }

  onRowAction(request: CrossProjectRequest, action: string): void {
    const plan = this.planLink(request);

    if (action === 'accept') this.accept.emit(request);
    else if (action === 'open-plan' && plan) void this.router.navigateByUrl(plan);
    else if (action === 'copy-version') fpcCopyText(request.specHash);
  }

  /** Bulk Accept: one call per request (same endpoint + authorization as the single accept), per-request result. */
  async acceptSelected(): Promise<void> {
    const requests = this.selectedRequests().filter((r) => !r.accepted);

    if (requests.length === 0) return;

    const api = this.injector.get(AccessManagementService);
    const result = await fpcRunBulk(requests, (r) =>
      firstValueFrom(api.accept(r.peer, { project: r.project, policy: r.policy, specHash: r.specHash })),
    );

    this.selected.set([]);
    this.bulkDone.emit(dlBulkSummary(result, (r) => `${r.project} → ${r.policy}`));
  }
}
