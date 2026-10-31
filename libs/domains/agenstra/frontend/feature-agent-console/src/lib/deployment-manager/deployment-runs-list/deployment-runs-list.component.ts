import { Component, computed, DestroyRef, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import {
  DeploymentsFacade,
  DeploymentsService,
  type DeploymentRun,
} from '@forepath/agenstra/frontend/data-access-agent-console';
import {
  FpcAlertComponent,
  FpcButtonComponent,
  FpcConfirmDialogComponent,
  FpcDataTableComponent,
  FpcEmptyStateComponent,
  FpcTableCellDirective,
  fpcCopyText,
  fpcRunBulk,
  FPC_DEFAULT_PAGE_SIZE,
  type FpcMenuItem,
  type FpcTableColumn,
  FpcDatePipe,
} from '@forepath/shared/frontend/ui-components';
import { debounceTime, distinctUntilChanged, firstValueFrom } from 'rxjs';

import { AG_DL_CANCEL, agBulkSummary, agCopyIdItem, agOpenItem } from '../../shared/data-list';
import { deploymentIsActive, deploymentTableState } from '../deployment-labels';

interface RunsRequest {
  clientId: string;
  agentId: string;
  page: number;
  pageSize: number;
  search: string;
}

/**
 * Deployment runs rail as a data table (3.38 decision 7): State (readable status / conclusion) · Run · Branch ·
 * Commit (short SHA, allowed per D11) · Workflow · Created. Server paging without total (`limit = size + 1` →
 * `hasNext`), row click toggles the run details, ⋮ Open / Open in provider / Cancel run / Copy ID, bulk Cancel for
 * queued / running runs (fan-out over the single cancel endpoint, per-run result).
 */
@Component({
  selector: 'framework-deployment-runs-list',
  imports: [
    FpcDatePipe,
    FpcAlertComponent,
    FpcButtonComponent,
    FpcConfirmDialogComponent,
    FpcDataTableComponent,
    FpcEmptyStateComponent,
    FpcTableCellDirective,
  ],
  templateUrl: './deployment-runs-list.component.html',
  styleUrls: ['./deployment-runs-list.component.scss'],
  standalone: true,
})
export class DeploymentRunsListComponent {
  private readonly deploymentsFacade = inject(DeploymentsFacade);
  private readonly deploymentsService = inject(DeploymentsService);
  private readonly destroyRef = inject(DestroyRef);

  // Inputs
  clientId = input.required<string>();
  agentId = input.required<string>();
  selectedRunId = input<string | null>(null);

  // Outputs
  readonly runSelected = output<string | null>();

  // Table state (server paging: the API pages with limit / offset, no total)
  readonly searchRunsQuery = signal<string>('');
  readonly page = signal(1);
  readonly pageSize = signal(FPC_DEFAULT_PAGE_SIZE);
  readonly selectedIds = signal<readonly string[]>([]);
  readonly bulkBusy = signal(false);
  readonly bulkCancelConfirmOpen = signal(false);
  readonly bulkResult = signal<{ tone: 'success' | 'warning' | 'danger'; message: string } | null>(null);

  // State from facade
  readonly runs$ = this.deploymentsFacade.runs$;
  readonly loadingRuns$ = this.deploymentsFacade.loadingRuns$;
  readonly error$ = this.deploymentsFacade.error$;

  // Convert observables to signals
  readonly error = toSignal(this.error$, { initialValue: null });
  readonly loadingRuns = toSignal(this.loadingRuns$, { initialValue: false });
  readonly loadedRuns = toSignal(this.runs$, { initialValue: [] as DeploymentRun[] });

  /** The current page (one extra run is fetched to know whether a next page exists). */
  readonly pageRuns = computed(() => this.loadedRuns().slice(0, this.pageSize()));
  readonly hasNext = computed(() => this.loadedRuns().length > this.pageSize());

  readonly selectedRuns = computed(() => {
    const ids = new Set(this.selectedIds());

    return this.pageRuns().filter((run) => ids.has(run.id));
  });
  readonly cancellableSelected = computed(() => this.selectedRuns().filter((run) => deploymentIsActive(run)));

  // Filter out 404 errors (not found) since the empty state covers them
  readonly filteredError = computed(() => {
    const error = this.error();

    if (!error) {
      return null;
    }

    const lowerError = error.toLowerCase();

    if (lowerError.includes('not found') || lowerError.includes('404') || lowerError.includes('workflow_dispatch')) {
      return null;
    }

    return error;
  });

  private readonly request = computed<RunsRequest>(() => ({
    clientId: this.clientId(),
    agentId: this.agentId(),
    page: this.page(),
    pageSize: this.pageSize(),
    search: this.searchRunsQuery().trim(),
  }));

  protected readonly tableLabel = $localize`:@@featureDeploymentRunsList-title:Deployment runs`;
  protected readonly searchPlaceholder = $localize`:@@featureDeploymentRunsList-searchPlaceholder:Search deployment runs`;
  protected readonly cancelLabel = AG_DL_CANCEL;

  private readonly openInProviderLabel = $localize`:@@featureDeploymentRunsList-openInProvider:Open in provider`;
  private readonly cancelRunLabel = $localize`:@@featureDeploymentRunsList-cancelRun:Cancel run`;

  readonly columns: FpcTableColumn<DeploymentRun>[] = [
    {
      id: 'state',
      label: $localize`:@@featureDeploymentRunsList-colState:State`,
      type: 'state',
      state: (run) => deploymentTableState(run),
    },
    {
      id: 'name',
      label: $localize`:@@featureDeploymentRunsList-colRun:Run`,
      value: (run) => this.getRunDisplayName(run.runName),
      required: true,
      priority: 1,
      sortable: false,
    },
    {
      id: 'ref',
      label: $localize`:@@featureDeploymentRunsList-colBranch:Branch`,
      value: (run) => run.ref,
      mono: true,
      priority: 1,
      sortable: false,
    },
    {
      id: 'sha',
      label: $localize`:@@featureDeploymentRunsList-colCommit:Commit`,
      value: (run) => (run.sha ?? '').substring(0, 7),
      mono: true,
      priority: 3,
      sortable: false,
    },
    {
      id: 'workflow',
      label: $localize`:@@featureDeploymentRunsList-colWorkflow:Workflow`,
      value: (run) => run.workflowName ?? '',
      priority: 3,
      hidden: true,
      sortable: false,
    },
    {
      id: 'created',
      label: $localize`:@@featureDeploymentRunsList-colCreated:Created`,
      priority: 2,
    },
  ];

  readonly runRowMenu = (run: DeploymentRun): FpcMenuItem[] => {
    const items: FpcMenuItem[] = [agOpenItem()];

    if (run.htmlUrl) {
      items.push({ id: 'provider', label: this.openInProviderLabel, icon: 'github' });
    }

    if (deploymentIsActive(run)) {
      items.push({ id: 'cancel', label: this.cancelRunLabel, icon: 'stop-circle', danger: true });
    }

    items.push(agCopyIdItem());

    return items;
  };

  getRunDisplayName(runName: string | null | undefined): string {
    return runName || $localize`:@@featureDeploymentRunsList-untitledRun:Untitled run`;
  }

  constructor() {
    // One load per settled request (workspace / agent, page, page size, search; search keystrokes coalesce).
    toObservable(this.request)
      .pipe(
        debounceTime(250),
        distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((request) => this.load(request));
  }

  /** Reloads the current page (refresh, after a trigger or a cancel). */
  reload(): void {
    this.load(this.request());
  }

  private load({ clientId, agentId, page, pageSize, search }: RunsRequest): void {
    if (clientId && agentId) {
      this.deploymentsFacade.loadRuns(clientId, agentId, pageSize + 1, (page - 1) * pageSize, search || undefined);
    }
  }

  onRunClick(runId: string): void {
    // Toggle selection: if already selected, unselect it
    if (this.selectedRunId() === runId) {
      this.runSelected.emit(null);
    } else {
      this.runSelected.emit(runId);
    }
  }

  onRunAction(run: DeploymentRun, action: string): void {
    switch (action) {
      case 'open':
        if (this.selectedRunId() !== run.id) {
          this.runSelected.emit(run.id);
        }

        break;
      case 'provider':
        if (run.htmlUrl) {
          window.open(run.htmlUrl, '_blank', 'noopener');
        }

        break;
      case 'cancel':
        this.selectedIds.set([run.id]);
        this.bulkCancelConfirmOpen.set(true);
        break;
      case 'copy-id':
        fpcCopyText(run.id);
        break;
    }
  }

  /** Bulk Cancel: one cancel call per queued / running run (the server checks each), per-run result. */
  async onConfirmBulkCancel(): Promise<void> {
    this.bulkCancelConfirmOpen.set(false);
    const clientId = this.clientId();
    const agentId = this.agentId();
    const runs = this.cancellableSelected();

    if (!clientId || !agentId || runs.length === 0) {
      return;
    }

    this.bulkBusy.set(true);
    this.bulkResult.set(null);

    try {
      const result = await fpcRunBulk(runs, (run) =>
        firstValueFrom(this.deploymentsService.cancelRun(clientId, agentId, run.id)),
      );

      this.bulkResult.set(agBulkSummary(result, (run) => this.getRunDisplayName(run.runName)));
      this.selectedIds.set(result.failed.concat(result.denied).map((run) => run.id));
      this.reload();
    } finally {
      this.bulkBusy.set(false);
    }
  }
}
