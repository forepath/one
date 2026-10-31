import { Component, computed, effect, inject, OnInit, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import {
  apiErrorMessage,
  ConsoleAccessFacade,
  ConsoleEndpointService,
  ConsoleGitFacade,
  ConsoleResourcesFacade,
  type ConsoleResource,
  type GitConnection,
  IntegrationsService,
  NodesService,
  type SiemDeliveryStatus,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcDataTableComponent,
  FpcEmptyStateComponent,
  type FpcMenuItem,
  FpcPageHeaderComponent,
  FpcTableCellDirective,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';

import { ResourceModalService } from '../objects/resource-modal.service';
import { mayDraftResource } from '../workspace/workspace-actions';
import {
  filterIntegrationRows,
  type IntegrationArea,
  type IntegrationEnvStatusLike,
  integrationRows,
  type IntegrationRow,
  type IntegrationState,
} from './integrations-format';

/** The outcome of the last "Test connection" per row. */
interface TestOutcome {
  ok: boolean;
  message: string;
  durationMs: number;
}

/**
 * Setup (3.41, first rail tile, `/setup`): every external provider of the cluster — Git, DNS, failover IPs, backup targets, SIEM,
 * ACME, registry mirrors, release source, BGP / RPKI, posture, webhooks — in one grouped list with its state. Edit
 * opens the existing resource modal (the resource, or the Cluster on the right step), dedicated pages are linked, and
 * DNS providers, backup targets, failover-IP providers and SIEM targets can be tested. Env-configured integrations
 * (SMTP, KMS, sign-in, plugins, …) are shown read-only to cluster admins. Same role rules as everywhere: edit / create
 * like drafting the resource, tests infra operator or cluster admin (SIEM: cluster admin). Works the same through a
 * fleet (relayed routes; the cluster decides).
 */
@Component({
  selector: 'loadweaver-integrations-page',
  standalone: true,
  imports: [
    FpcAlertComponent,
    FpcDataTableComponent,
    FpcEmptyStateComponent,
    FpcPageHeaderComponent,
    FpcTableCellDirective,
  ],
  templateUrl: './integrations-page.component.html',
  host: { class: 'd-flex flex-column flex-grow-1 min-h-0' },
})
export class LoadweaverIntegrationsPageComponent implements OnInit {
  private readonly accessFacade = inject(ConsoleAccessFacade);
  private readonly resourcesFacade = inject(ConsoleResourcesFacade);
  private readonly gitFacade = inject(ConsoleGitFacade);
  private readonly integrations = inject(IntegrationsService);
  private readonly nodes = inject(NodesService);
  private readonly endpoints = inject(ConsoleEndpointService);
  private readonly modal = inject(ResourceModalService);
  private readonly router = inject(Router);

  readonly me = toSignal(this.accessFacade.me$, { initialValue: null });
  private readonly resources = toSignal(this.resourcesFacade.resources$, { initialValue: [] as ConsoleResource[] });
  private readonly gitConnections = toSignal(this.gitFacade.connections$, { initialValue: [] as GitConnection[] });
  private readonly siem = signal<SiemDeliveryStatus[]>([]);
  private readonly env = signal<IntegrationEnvStatusLike[]>([]);

  readonly isClusterAdmin = computed(() => this.me()?.clusterRole === 'cluster-admin');
  readonly infra = computed(() => this.isClusterAdmin() || this.me()?.clusterRole === 'infra-operator');
  private readonly access = computed(() => ({
    clusterRole: this.me()?.clusterRole ?? null,
    projects: this.me()?.projects ?? {},
    fleetMode: this.endpoints.fleetMode,
  }));

  readonly query = signal('');
  readonly tests = signal<ReadonlyMap<string, TestOutcome>>(new Map());
  readonly testing = signal<string | null>(null);
  readonly lastTest = signal<{ row: IntegrationRow; outcome: TestOutcome } | null>(null);

  readonly rows = computed(() =>
    integrationRows({
      resources: this.resources(),
      gitConnections: this.gitConnections(),
      siem: this.siem(),
      env: this.isClusterAdmin() ? this.env() : [],
    }).filter((row) => row.id !== 'webhooks' || this.isClusterAdmin()),
  );
  readonly visibleRows = computed(() => filterIntegrationRows(this.rows(), this.query(), (a) => this.areaLabel(a)));

  readonly title = $localize`:@@lwConsoleIntegrations-title:Setup`;
  readonly searchLabel = $localize`:@@lwConsoleIntegrations-search:Search integrations`;
  readonly editLabel = $localize`:@@lwConsoleIntegrations-edit:Edit`;
  readonly createLabel = $localize`:@@lwConsoleIntegrations-create:Set up`;
  readonly openLabel = $localize`:@@lwConsoleIntegrations-open:Open`;
  readonly testLabel = $localize`:@@lwConsoleIntegrations-test:Test connection`;
  readonly testFailedLabel = $localize`:@@lwConsoleIntegrations-testFailed:The test couldn't be run.`;
  private readonly areaLabels: Record<IntegrationArea, string> = {
    source: $localize`:@@lwConsoleIntegrations-areaSource:Source control`,
    dns: $localize`:@@lwConsoleIntegrations-areaDns:DNS`,
    addresses: $localize`:@@lwConsoleIntegrations-areaAddresses:Public addresses`,
    backups: $localize`:@@lwConsoleIntegrations-areaBackups:Backups`,
    observability: $localize`:@@lwConsoleIntegrations-areaObservability:Alerts and log forwarding`,
    certificates: $localize`:@@lwConsoleIntegrations-areaCertificates:Certificates`,
    registry: $localize`:@@lwConsoleIntegrations-areaRegistry:Container registry`,
    updates: $localize`:@@lwConsoleIntegrations-areaUpdates:Updates`,
    routing: $localize`:@@lwConsoleIntegrations-areaRouting:Routing (BGP)`,
    security: $localize`:@@lwConsoleIntegrations-areaSecurity:Device security`,
    environment: $localize`:@@lwConsoleIntegrations-areaEnvironment:Set in the environment (read-only)`,
  };
  private readonly stateLabels: Record<IntegrationState, string> = {
    configured: $localize`:@@lwConsoleIntegrations-stateConfigured:Configured`,
    error: $localize`:@@lwConsoleIntegrations-stateError:Failing`,
    off: $localize`:@@lwConsoleIntegrations-stateOff:Not set up`,
    env: $localize`:@@lwConsoleIntegrations-stateEnv:From the environment`,
  };
  private readonly testOkLabel = $localize`:@@lwConsoleIntegrations-stateTestOk:Test passed`;
  private readonly testFailLabel = $localize`:@@lwConsoleIntegrations-stateTestFail:Test failed`;

  readonly areaLabel = (area: IntegrationArea): string => this.areaLabels[area];
  readonly groupBy = (row: IntegrationRow): string => row.area;
  readonly groupLabel = (area: string): string => this.areaLabels[area as IntegrationArea] ?? area;
  readonly rowId = (row: IntegrationRow): string => row.id;

  readonly columns: FpcTableColumn<IntegrationRow>[] = [
    {
      id: 'state',
      label: $localize`:@@lwConsoleIntegrations-colState:State`,
      type: 'state',
      state: (row) => this.stateOf(row),
    },
    {
      id: 'name',
      label: $localize`:@@lwConsoleIntegrations-colName:Integration`,
      value: (row) => row.name,
      required: true,
      priority: 1,
    },
    { id: 'type', label: $localize`:@@lwConsoleIntegrations-colType:Type`, value: (row) => row.type, mono: true },
    {
      id: 'details',
      label: $localize`:@@lwConsoleIntegrations-colDetails:Details`,
      value: (row) => row.error || row.details,
      priority: 1,
    },
  ];

  readonly rowMenu = (row: IntegrationRow): FpcMenuItem[] => [
    ...(row.edit && mayDraftResource(row.edit.key, this.access())
      ? [{ id: 'edit', label: this.editLabel, icon: 'pencil' }]
      : []),
    ...(row.create && mayDraftResource({ kind: row.create, project: null }, this.access())
      ? [{ id: 'create', label: this.createLabel, icon: 'plus-lg' }]
      : []),
    ...(row.test && this.mayTest(row)
      ? [{ id: 'test', label: this.testLabel, icon: 'plug', disabled: this.testing() !== null }]
      : []),
    ...(row.link ? [{ id: 'open', label: this.openLabel, icon: 'box-arrow-up-right' }] : []),
  ];

  constructor() {
    // Cluster roles read the delivery status; cluster admins the env-configured integrations.
    effect(() => {
      if (!this.me()?.clusterRole) return;

      untracked(() =>
        this.nodes.siem().subscribe({ next: (status) => this.siem.set(status), error: () => this.siem.set([]) }),
      );
    });
    effect(() => {
      if (!this.isClusterAdmin()) return;

      untracked(() =>
        this.integrations.status().subscribe({ next: (env) => this.env.set(env), error: () => this.env.set([]) }),
      );
    });
  }

  ngOnInit(): void {
    this.accessFacade.load();
    this.resourcesFacade.load();
    this.gitFacade.load();
  }

  reload(): void {
    this.resourcesFacade.load();
    this.gitFacade.load();

    if (this.me()?.clusterRole)
      this.nodes.siem().subscribe({ next: (status) => this.siem.set(status), error: () => undefined });
  }

  /** Tests: infra operators and cluster admins; SIEM targets (a Cluster part) cluster admins only. */
  mayTest(row: IntegrationRow): boolean {
    if (!row.test) return false;

    return row.test?.kind === 'SiemTarget' ? this.isClusterAdmin() : this.infra();
  }

  /** Clicking / Enter on a row: its main action (Edit, else Set up, else Open) — the one the caller may use; else none. */
  onRowActivate(row: IntegrationRow): void {
    const main = this.rowMenu(row).find((item) => ['edit', 'create', 'open'].includes(item.id) && !item.disabled);

    if (main) this.onRowAction(row, main.id);
  }

  onRowAction(row: IntegrationRow, action: string): void {
    switch (action) {
      case 'edit':
        if (row.edit) this.modal.openEdit(row.edit.key, row.edit.step);
        break;
      case 'create':
        if (row.create) this.modal.openCreate(row.create, null);
        break;
      case 'test':
        this.runTest(row);
        break;
      case 'open':
        if (row.link) void this.router.navigateByUrl(row.link);
        break;
    }
  }

  runTest(row: IntegrationRow): void {
    const test = row.test;

    if (!test || this.testing()) return;

    this.testing.set(row.id);
    this.integrations.test(test.kind, test.name).subscribe({
      next: (result) => this.recordTest(row, { ok: result.ok, message: result.message, durationMs: result.durationMs }),
      error: (error: unknown) =>
        this.recordTest(row, { ok: false, message: apiErrorMessage(error, this.testFailedLabel), durationMs: 0 }),
    });
  }

  private recordTest(row: IntegrationRow, outcome: TestOutcome): void {
    const next = new Map(this.tests());

    next.set(row.id, outcome);
    this.tests.set(next);
    this.lastTest.set({ row, outcome });
    this.testing.set(null);
  }

  /** State badge: a test result wins over the configured state until the page is left. */
  private stateOf(row: IntegrationRow): { label: string; tone: 'success' | 'danger' | 'neutral' | 'info' } {
    const tested = this.tests().get(row.id);

    if (tested)
      return { label: tested.ok ? this.testOkLabel : this.testFailLabel, tone: tested.ok ? 'success' : 'danger' };

    switch (row.state) {
      case 'configured':
        return { label: this.stateLabels.configured, tone: 'success' };
      case 'error':
        return { label: this.stateLabels.error, tone: 'danger' };
      case 'env':
        return { label: this.stateLabels.env, tone: 'info' };
      default:
        return { label: this.stateLabels.off, tone: 'neutral' };
    }
  }
}
