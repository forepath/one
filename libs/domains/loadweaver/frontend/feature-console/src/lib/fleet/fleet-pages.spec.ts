import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { AuthenticationFacade } from '@forepath/identity/frontend';
import {
  ConsoleFleetFacade,
  type FleetGrant,
  FleetService,
  type FleetCard,
  type FleetAuditEntry,
  type FleetCluster,
  type FleetOperation,
} from '@forepath/loadweaver/frontend/data-access-console';
import { of, Subject, throwError } from 'rxjs';

import { facadeStub } from '../testing';
import { clusterUpdate, emptyClusterForm, LoadweaverFleetClustersPageComponent } from './fleet-clusters-page.component';
import { LoadweaverFleetClusterDetailPageComponent } from './fleet-cluster-detail-page.component';
import { LoadweaverFleetComparePageComponent } from './fleet-compare-page.component';
import {
  buildOperation,
  defaultTargetVolume,
  emptyOperationForm,
  LoadweaverFleetOperationsPageComponent,
} from './fleet-operations-page.component';
import { LoadweaverFleetAuditPageComponent } from './fleet-audit-page.component';
import { LoadweaverFleetOverviewPageComponent } from './fleet-overview-page.component';

const A = '6f1c1b0e-0000-4000-8000-00000000000a';
const B = '6f1c1b0e-0000-4000-8000-00000000000b';

function cluster(id: string, name: string, overrides: Partial<FleetCluster> = {}): FleetCluster {
  return {
    id,
    name,
    description: null,
    endpoint: `https://${name}.example.com`,
    hasCustomCa: false,
    credentialHint: 'wxyz',
    reference: null,
    state: 'active',
    readOnlyUntil: null,
    readOnlyReason: null,
    health: { state: 'healthy', checkedAt: null, latencyMs: 3, version: '1.4.0', clusterId: null, error: null },
    access: { clusterRole: 'admin', projects: {}, readOnly: false },
    createdAt: '2026-10-20T10:00:00.000Z',
    updatedAt: '2026-10-20T10:00:00.000Z',
    ...overrides,
  };
}

function card(id: string, name: string, overrides: Partial<FleetCard> = {}): FleetCard {
  return {
    id,
    name,
    reference: null,
    state: 'active',
    readOnlyUntil: null,
    connection: { state: 'healthy', checkedAt: null, latencyMs: 1, version: '1.4.0', clusterId: null, error: null },
    health: { state: 'healthy', message: 'All good' },
    sites: 2,
    nodes: { total: 3, up: 3 },
    deployments: 4,
    capacity: { cpu: { used: 4, total: 8, percent: 50 }, memory: { used: 1, total: 4, reserve: 0, percent: 25 } },
    version: '1.4.0',
    latestAvailable: null,
    upgradeAvailable: false,
    activeRollout: null,
    openAlerts: 0,
    pendingPlans: 1,
    inbox: { critical: 0, warning: 1, info: 0 },
    link: `/clusters/${id}`,
    limited: false,
    errors: [],
    fetchedAt: null,
    ...overrides,
  };
}

function fleetStub(streams: Record<string, unknown> = {}) {
  return Object.assign(
    facadeStub(
      {
        clusters$: [],
        clustersLoaded$: true,
        clustersLoading$: false,
        clustersError$: null,
        saving$: false,
        saveError$: null,
        testing$: false,
        testResult$: null,
        testError$: null,
        polling$: [],
        pollError$: null,
        cards$: [],
        cardsLoading$: false,
        cardsError$: null,
        inbox$: [],
        inboxError$: null,
        sites$: null,
        sitesError$: null,
        summary$: {
          clusters: 0,
          healthy: 0,
          unhealthy: 0,
          critical: 0,
          attention: 0,
          upgrades: 0,
          pendingPlans: 0,
          openAlerts: 0,
          teardown: 0,
        },
        comparison$: null,
        comparisonLoading$: false,
        comparisonError$: null,
        operations$: [],
        operationsLoading$: false,
        operationsError$: null,
        operationSaving$: false,
        operationError$: null,
        cancelling$: [],
        hasActiveOperations$: false,
        ...streams,
      },
      [
        'loadClusters',
        'loadOverview',
        'openCluster',
        'createCluster',
        'updateCluster',
        'deleteCluster',
        'testConnection',
        'resetClusterForm',
        'pollCluster',
        'compare',
        'clearComparison',
        'loadOperations',
        'createOperation',
        'resetOperationForm',
        'cancelOperation',
      ],
    ),
    {
      clusterSaved$: new Subject(),
      clusterDeleted$: new Subject(),
      operationCreated$: new Subject<{ operation: FleetOperation }>(),
    },
  );
}

const auth = (admin: boolean) =>
  facadeStub({ canAccessUserManager$: admin, authenticationType$: 'users' }, ['checkAuthentication']);

describe('fleet overview page', () => {
  it('renders a card per cluster with teardown badge and opens a cluster through the relay', async () => {
    const fleet = fleetStub({
      cards$: [
        card(A, 'alpha'),
        card(B, 'beta', { state: 'teardown', readOnlyUntil: '2026-11-01T00:00:00.000Z', reference: 'decabill:s:i' }),
      ],
      inbox$: [
        {
          clusterId: B,
          clusterName: 'beta',
          kind: 'alert',
          severity: 'critical',
          title: 'Disk full',
          link: `/clusters/${B}/observe/alerts/x1`,
          project: null,
          since: null,
        },
        {
          clusterId: A,
          clusterName: 'alpha',
          kind: 'approval',
          severity: 'warning',
          title: 'Plan waits for approval',
          link: `/clusters/${A}/plans/p1`,
          nativeUrl: 'https://alpha.example.com/plans/p1',
          project: 'shop',
          since: null,
        },
      ],
      sites$: {
        withoutLocation: 1,
        sites: [
          { clusterId: A, clusterName: 'alpha', site: 'fra1', latitude: 50.1, longitude: 8.7, label: 'Frankfurt' },
        ],
      },
    });

    await TestBed.configureTestingModule({
      imports: [LoadweaverFleetOverviewPageComponent],
      providers: [provideRouter([]), { provide: ConsoleFleetFacade, useValue: fleet }],
    }).compileComponents();

    const fixture = TestBed.createComponent(LoadweaverFleetOverviewPageComponent);

    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;

    expect(fleet['loadOverview']).toHaveBeenCalled();
    expect(el.querySelector('[data-testid="fleet-cards"]')?.textContent).toContain('alpha');
    expect(el.querySelector('[data-testid="fleet-cards"] [data-testid="fleet-card-teardown"]')).not.toBeNull();
    expect(el.querySelectorAll('[data-testid="fleet-map-site"]')).toHaveLength(1);
    expect(el.textContent).toContain('Disk full');

    fixture.componentInstance.open(fixture.componentInstance.cards()[0]);
    expect(fleet['openCluster']).toHaveBeenCalledWith(A, '/');

    fixture.componentInstance.openItem(fixture.componentInstance.inbox()[0]);
    expect(fleet['openCluster']).toHaveBeenCalledWith(B, '/observe/alerts/x1');

    // Approvals stay native: the cluster's own console, never the relay.
    const open = jest.spyOn(window, 'open').mockReturnValue(null);

    expect(el.querySelector('[data-testid="fleet-inbox-native"]')?.getAttribute('href')).toBe(
      'https://alpha.example.com/plans/p1',
    );
    fleet['openCluster'].mockClear();
    fixture.componentInstance.openItem(fixture.componentInstance.inbox()[1]);
    expect(open).toHaveBeenCalledWith('https://alpha.example.com/plans/p1', '_blank', 'noopener,noreferrer');
    expect(fleet['openCluster']).not.toHaveBeenCalled();

    // Trust problems (2026-10-29) open the fleet's cluster page (Establish trust), not the cluster.
    const navigate = jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    fixture.componentInstance.openItem({
      clusterId: A,
      clusterName: 'alpha',
      kind: 'trust',
      severity: 'warning',
      title: "Cluster alpha doesn't trust this fleet yet",
      link: `/fleet/clusters/${A}`,
      nativeUrl: null,
      project: null,
      since: null,
    });
    expect(navigate).toHaveBeenCalledWith(['/fleet/clusters', A]);
    expect(fleet['openCluster']).not.toHaveBeenCalled();
    expect(
      fixture.componentInstance.inboxTitleText({
        kind: 'trust',
        title: "Cluster alpha doesn't trust this fleet yet",
        link: '',
      }),
    ).toBe("Cluster alpha doesn't trust this fleet yet");

    // Lanes (3.38): Clusters | Needs attention | Sites, the search in the clusters lane, no sticky wrapper.
    expect(el.querySelectorAll('[data-testid="fleet-overview-lanes"] fpc-board-lane')).toHaveLength(3);
    expect(el.querySelector('fpc-tab-group.fpc-lane-tabs')).not.toBeNull();
    expect(el.querySelector('[style*="z-index"]')).toBeNull();
    expect(el.querySelector('[data-testid="fleet-cards"] fpc-search-field')).not.toBeNull();
    expect(fixture.componentInstance.cardMenu(fixture.componentInstance.cards()[0]).map((i) => i.id)).toEqual([
      'open',
      'details',
    ]);
    // No totals counter in the lane headers (decision 8).
    expect(el.querySelector('fpc-board-lane fpc-lane-header')?.textContent).not.toContain('2');
    fixture.componentInstance.search.set('BETA');
    fixture.detectChanges();
    expect(fixture.componentInstance.filteredCards().map((c) => c.name)).toEqual(['beta']);
    fixture.componentInstance.search.set('nothing');
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="fpc-data-table-no-matches"]')).not.toBeNull();
    fixture.destroy();
  });
});

describe('fleet overview page: unreachable / read-only clusters (3.43, 2026-10-31)', () => {
  it('marks paused clusters, read-only in the connection column, and counts "as of" an earlier snapshot', async () => {
    const readOnly = {
      state: 'read-only' as const,
      reason: 'members down',
      freeze: null,
      takenOverAt: null,
      checkedAt: '2026-10-31T10:00:00Z',
    };
    const fleet = fleetStub({
      cards$: [
        card(A, 'alpha', { availability: readOnly }),
        card(B, 'beta', {
          connection: {
            state: 'unreachable',
            checkedAt: null,
            latencyMs: null,
            version: null,
            clusterId: null,
            error: 'ECONNREFUSED',
          },
          asOf: '2026-10-31T09:00:00Z',
          capacity: null,
          openAlerts: 2,
        }),
        card('6f1c1b0e-0000-4000-8000-0000000000c3', 'gamma'),
      ],
    });

    await TestBed.configureTestingModule({
      imports: [LoadweaverFleetOverviewPageComponent],
      providers: [provideRouter([]), { provide: ConsoleFleetFacade, useValue: fleet }],
    }).compileComponents();

    const fixture = TestBed.createComponent(LoadweaverFleetOverviewPageComponent);

    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const component = fixture.componentInstance;

    // Paused: alpha (read-only) and beta (unreachable, derived from the connection of an older fleet).
    expect(el.querySelectorAll('[data-testid="fleet-card-paused"]')).toHaveLength(2);
    // Health, nodes and alerts of beta carry the snapshot time.
    expect(el.querySelectorAll('[data-testid="fleet-card-as-of"]')).toHaveLength(3);
    expect(component.asOfTitle('2026-10-31T09:00:00Z')).toMatch(/^As of /);

    const state = component.cardColumns.find((c) => c.id === 'connection')?.state;

    expect(state?.(component.cards()[0])).toMatchObject({ label: 'Read-only', tone: 'warning' });
    expect(state?.(component.cards()[1])).toMatchObject({ label: 'Unreachable', tone: 'danger' });
    expect(state?.(component.cards()[2])).toMatchObject({ label: 'Connected', tone: 'success' });
  });
});

describe('fleet clusters page', () => {
  async function create(admin = true, clusters = [cluster(A, 'alpha', { hasCustomCa: true })]) {
    const fleet = fleetStub({ clusters$: clusters });

    await TestBed.configureTestingModule({
      imports: [LoadweaverFleetClustersPageComponent],
      providers: [
        provideRouter([]),
        { provide: ConsoleFleetFacade, useValue: fleet },
        { provide: AuthenticationFacade, useValue: auth(admin) },
        { provide: FleetService, useValue: { pollCluster: jest.fn(), deleteCluster: jest.fn() } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(LoadweaverFleetClustersPageComponent);

    fixture.detectChanges();

    return { fixture, fleet, component: fixture.componentInstance };
  }

  it('requires the credential again when endpoint or CA change', () => {
    const base = cluster(A, 'alpha');
    const form = { ...emptyClusterForm(), description: '', endpoint: base.endpoint };

    expect(clusterUpdate(base, { ...form, description: 'Prod' })).toEqual({
      update: { description: 'Prod' },
      credentialRequired: false,
    });
    expect(clusterUpdate(base, { ...form, endpoint: 'https://new.example.com' }).credentialRequired).toBe(true);
    expect(clusterUpdate(base, { ...form, removeCa: true })).toEqual({
      update: { caCertificate: '' },
      credentialRequired: true,
    });
  });

  it('registers with the write-only credential and the connection test', async () => {
    const { component, fleet, fixture } = await create();

    component.openRegister();
    component.form = {
      ...emptyClusterForm(),
      name: 'beta',
      endpoint: ' https://beta.example.com ',
      credential: 'lwp_' + 'x'.repeat(20),
    };
    component.save();
    expect(fleet['createCluster']).toHaveBeenCalledWith({
      name: 'beta',
      endpoint: 'https://beta.example.com',
      credential: 'lwp_' + 'x'.repeat(20),
      test: true,
    });
    fixture.destroy();
  });

  it('refuses an endpoint change without the credential, sends it with', async () => {
    const { component, fleet, fixture } = await create();
    const alpha = component.clusters()[0];

    component.openEdit(alpha);
    component.form.endpoint = 'https://moved.example.com';
    expect(component.credentialRequired()).toBe(true);
    component.save();
    expect(fleet['updateCluster']).not.toHaveBeenCalled();
    expect(component.formError()).toContain('service credential again');

    component.form.credential = 'y'.repeat(20);
    component.save();
    expect(fleet['updateCluster']).toHaveBeenCalledWith(A, {
      endpoint: 'https://moved.example.com',
      credential: 'y'.repeat(20),
    });

    // The credential field is never prefilled.
    component.openEdit(alpha);
    expect(component.form.credential).toBe('');
    fixture.destroy();
  });

  it('renders a data table (its strip = the page search), row actions in ⋮ and filters rows', async () => {
    const { fixture, component } = await create(true, [
      cluster(A, 'alpha', { hasCustomCa: true }),
      cluster(B, 'beta', { endpoint: 'https://beta.example.com' }),
    ]);
    const el = fixture.nativeElement as HTMLElement;
    const alpha = component.clusters()[0];

    expect(component.rowMenu(alpha).map((i) => i.id)).toEqual(['open', 'poll', 'edit', 'delete', 'copy-id']);
    expect(el.querySelector('[data-testid="fleet-clusters-table"] a.fpc-data-table__link')?.getAttribute('href')).toBe(
      `/fleet/clusters/${A}`,
    );
    expect(
      el.querySelector('[data-testid="fleet-clusters-table"] [data-testid="fpc-data-table-state"]'),
    ).not.toBeNull();
    expect(el.querySelector('fpc-list-header')).toBeNull();
    expect(el.querySelector('fpc-page-header')?.nextElementSibling?.tagName.toLowerCase()).toBe('fpc-data-table');
    expect(el.querySelector('fpc-data-table fpc-list-toolbar fpc-search-field')).not.toBeNull();
    expect(el.querySelector('table.fpc-table--sticky-head')).toBeNull();

    component.search.set('BETA.example');
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="fleet-cluster-alpha"]')).toBeNull();
    expect(el.querySelector('[data-testid="fleet-cluster-beta"]')).not.toBeNull();
    expect(el.querySelector('fpc-list-header')).toBeNull();

    component.search.set('nothing-like-this');
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="fpc-data-table-no-matches"]')).not.toBeNull();
    fixture.destroy();
  });

  it('deletes after confirmation; non-admins get no register / edit / delete', async () => {
    const { component, fleet, fixture } = await create();

    component.askDelete(component.clusters()[0]);
    component.confirmDelete();
    expect(fleet['deleteCluster']).toHaveBeenCalledWith(A);
    fixture.destroy();

    TestBed.resetTestingModule();

    const viewer = await create(false);
    const el = viewer.fixture.nativeElement as HTMLElement;

    expect(el.querySelector('[data-testid="fleet-clusters-register"]')).toBeNull();
    expect(viewer.component.rowMenu(viewer.component.clusters()[0]).map((i) => i.id)).toEqual([
      'open',
      'poll',
      'copy-id',
    ]);
    viewer.fixture.destroy();
  });

  it('bulk: checks the selected clusters and removes them (admins), per-cluster results', async () => {
    const { component, fixture } = await create(true, [cluster(A, 'alpha'), cluster(B, 'beta')]);
    const service = TestBed.inject(FleetService);

    (service.pollCluster as jest.Mock).mockImplementation(() => of({}));
    (service.deleteCluster as jest.Mock)
      .mockReturnValueOnce(of(undefined))
      .mockReturnValueOnce(throwError(() => ({ status: 403 })));
    component.selected.set([A, B]);
    await component.pollSelected();
    expect(service.pollCluster).toHaveBeenCalledTimes(2);
    expect(component.bulkResult()?.tone).toBe('success');
    component.selected.set([A, B]);
    await component.deleteSelected();
    expect(service.deleteCluster).toHaveBeenCalledWith(B);
    expect(component.bulkResult()?.message).toContain('not allowed');
    fixture.destroy();
  });
});

describe('fleet operations page', () => {
  it('builds the restore / clone request from the wizard', () => {
    const backup = (id: string, resource: string) => ({
      backup: { id, project: 'shop', resource, status: 'succeeded', bytes: 1, startedAt: '', finishedAt: null },
      selected: true,
      volume: defaultTargetVolume(resource),
    });
    const form = {
      ...emptyOperationForm(),
      sourceClusterId: A,
      targetClusterId: B,
      targetProject: 'shop',
      targetDeployment: 'store',
    };

    expect(defaultTargetVolume('volume/shop/db-data')).toBe('db-data');
    expect('error' in buildOperation(form, [])).toBe(true);
    expect(buildOperation(form, [backup('b1', 'volume/shop/db-data')])).toEqual({
      operation: {
        kind: 'cross-cluster-restore',
        sourceClusterId: A,
        targetClusterId: B,
        backups: [{ backupId: 'b1', volume: 'db-data' }],
        target: { project: 'shop', deployment: 'store' },
        mode: 'replace',
        apply: false,
      },
    });
    expect('error' in buildOperation({ ...form, kind: 'clone' }, [backup('b1', 'volume/shop/db')])).toBe(true);

    const clone = buildOperation(
      { ...form, kind: 'clone', cloneProject: 'shop', cloneDeployment: 'store', apply: true },
      [backup('b1', 'volume/shop/db')],
    );

    expect(clone).toMatchObject({ operation: { clone: { project: 'shop', deployment: 'store' }, apply: true } });
  });

  it('loads source backups through the relay, submits and cancels with confirmation', async () => {
    const running: FleetOperation = {
      id: 'op1',
      kind: 'clone',
      status: 'running',
      sourceClusterId: A,
      targetClusterId: B,
      params: {},
      steps: [
        { key: 'transfer', status: 'running', startedAt: null, finishedAt: null, detail: {}, error: null, attempts: 1 },
      ],
      error: null,
      createdBy: null,
      createdAt: '2026-10-20T10:00:00.000Z',
      updatedAt: '2026-10-20T10:00:00.000Z',
    };
    const fleet = fleetStub({ clusters$: [cluster(A, 'alpha'), cluster(B, 'beta')], operations$: [running] });
    const service = {
      sourceBackups: jest.fn().mockReturnValue(
        of([
          {
            id: 'b1',
            project: 'shop',
            resource: 'volume/shop/db',
            status: 'succeeded',
            bytes: 10,
            startedAt: '',
            finishedAt: null,
          },
        ]),
      ),
    };

    await TestBed.configureTestingModule({
      imports: [LoadweaverFleetOperationsPageComponent],
      providers: [
        provideRouter([]),
        { provide: ConsoleFleetFacade, useValue: fleet },
        { provide: FleetService, useValue: service },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(LoadweaverFleetOperationsPageComponent);
    const component = fixture.componentInstance;

    fixture.detectChanges();
    expect(fleet['loadOperations']).toHaveBeenCalledWith(null);
    const el = fixture.nativeElement as HTMLElement;

    const op1 = component.operations().find((op) => op.id === 'op1')!;

    expect(component.rowMenu(op1).map((i) => i.id)).toEqual(['cancel', 'copy-id']);
    expect(el.querySelector('fpc-list-header')).toBeNull();
    // Steps as a nested table in the row detail (decision 2).
    component.toggle(op1);
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="fleet-op-steps"] [data-testid="fpc-data-table-state"]')).not.toBeNull();
    component.toggle(op1);
    // Bulk Cancel: one call per running operation, per-item results.
    (service as unknown as { cancelOperation: jest.Mock }).cancelOperation = jest.fn(() =>
      throwError(() => ({ status: 403 })),
    );
    component.selected.set(['op1']);
    expect(component.canCancelSelection()).toBe(true);
    await component.cancelSelected();
    expect((service as unknown as { cancelOperation: jest.Mock }).cancelOperation).toHaveBeenCalledWith('op1');
    expect(component.bulkResult()?.message).toContain('not allowed');
    component.search.set('nothing');
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="fpc-data-table-no-matches"]')).not.toBeNull();
    component.search.set('');
    fixture.detectChanges();

    component.openWizard();
    component.form.sourceClusterId = A;
    component.form.sourceProject = 'shop';
    component.loadBackups();
    expect(service.sourceBackups).toHaveBeenCalledWith(A, 'shop');
    fixture.detectChanges();
    // Wizard (3.38): sections are list headers, the backups a data table (no raw table, no h6).
    expect(document.querySelector('fpc-data-table[data-testid="fleet-op-backups"]')).not.toBeNull();
    expect(document.querySelector('fpc-modal h6')).toBeNull();
    component.setBackupFor(component.backups()[0], { selected: true });
    component.form.targetClusterId = B;
    component.form.targetProject = 'shop';
    component.form.targetDeployment = 'store';
    component.submit();
    expect(fleet['createOperation']).toHaveBeenCalledWith(
      expect.objectContaining({ backups: [{ backupId: 'b1', volume: 'db' }], targetClusterId: B }),
    );

    fleet.operationCreated$.next({ operation: running });
    expect(component.wizardOpen()).toBe(false);

    component.askCancel(running);
    component.confirmCancel();
    expect(fleet['cancelOperation']).toHaveBeenCalledWith('op1');
    fixture.destroy();
  });
});

describe('fleet compare page', () => {
  it('compares the clusters from the URL and writes a new selection back', async () => {
    const fleet = fleetStub({ clusters$: [cluster(A, 'alpha'), cluster(B, 'beta')] });

    await TestBed.configureTestingModule({
      imports: [LoadweaverFleetComparePageComponent],
      providers: [
        provideRouter([]),
        { provide: ConsoleFleetFacade, useValue: fleet },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap({ clusters: `${A},${B},nope` }) } },
        },
      ],
    }).compileComponents();

    const navigate = jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(LoadweaverFleetComparePageComponent);
    const component = fixture.componentInstance;

    fixture.detectChanges();
    expect(fleet['compare']).toHaveBeenCalledWith([A, B]);

    component.toggle(B, false);
    expect(component.canCompare()).toBe(false);
    component.toggle(B, true);
    component.compare();
    expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { clusters: `${A},${B}` } }));
    fixture.destroy();
  });
});

describe('fleet cluster detail page: approvals through the fleet (3.24)', () => {
  const identity = {
    issuer: 'fleet-1',
    keys: [
      {
        kid: 'k1',
        state: 'active' as const,
        publicKey: '-----BEGIN PUBLIC KEY-----\nabc\n-----END PUBLIC KEY-----',
        fingerprint: 'SHA256:abc',
        createdAt: '2026-10-26T12:00:00.000Z',
        activatedAt: '2026-10-26T12:00:00.000Z',
        retiredAt: null,
      },
    ],
  };

  async function setup(
    admin: boolean,
    status: 'verified' | 'untrusted',
    grants: FleetGrant[] = [],
    over: Partial<FleetCluster['health']> = {},
  ) {
    const fleet = Object.assign(
      fleetStub({
        clusters$: [
          cluster(A, 'alpha', {
            health: {
              state: 'healthy',
              checkedAt: null,
              latencyMs: 3,
              version: '1.4.0',
              clusterId: 'uid',
              error: null,
              identity: status,
              identityReason: status === 'untrusted' ? 'fleet fleet-1 is not trusted by this cluster' : null,
              ...over,
            },
          }),
        ],
        grants$: grants,
        grantsLoading$: false,
        grantsError$: null,
        grantSaving$: false,
        grantError$: null,
        cloudStatus$: {},
        cloudErrors$: {},
      }),
      { grantSaved$: new Subject(), loadGrants: jest.fn(), loadCloudStatus: jest.fn() },
    );
    const service = {
      identity: jest.fn(() => of(identity)),
      createNextIdentityKey: jest.fn(() =>
        of({ ...identity, keys: [...identity.keys, { ...identity.keys[0], kid: 'k2', state: 'next' as const }] }),
      ),
      activateIdentityKey: jest.fn(() => of(identity)),
      users: jest.fn(() => of([])),
      deleteGrant: jest
        .fn()
        .mockReturnValueOnce(of(undefined))
        .mockReturnValueOnce(throwError(() => ({ status: 403 }))),
    };

    await TestBed.configureTestingModule({
      imports: [LoadweaverFleetClusterDetailPageComponent],
      providers: [
        provideRouter([]),
        { provide: ConsoleFleetFacade, useValue: fleet },
        { provide: FleetService, useValue: service },
        { provide: AuthenticationFacade, useValue: auth(admin) },
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ id: A })) } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(LoadweaverFleetClusterDetailPageComponent);

    fixture.detectChanges();

    return { fixture, service, el: fixture.nativeElement as HTMLElement };
  }

  it('shows whether approvals work through the fleet and the fleet identity for admins, with rotation', async () => {
    const { fixture, service, el } = await setup(true, 'untrusted');

    expect(el.querySelector('[data-testid="fleet-cluster-identity"]')?.textContent).toContain('Not trusted');
    expect(el.querySelector('[data-testid="fleet-cluster-trust-reason"]')?.textContent).toContain(
      "doesn't trust this fleet yet",
    );
    // 2026-10-29: no reference to a cluster console that fleet mode doesn't have; the action is here.
    expect(el.querySelector('[data-testid="fleet-cluster-identity"]')?.textContent).not.toContain('own console');
    expect(el.querySelector('[data-testid="fleet-cluster-trust-open"]')).not.toBeNull();
    // LW-13 / D11: no raw ids as text — the issuer via Copy, key id / fingerprint / public key in the key's ⋮.
    const writeText = jest.fn().mockResolvedValue(undefined);

    Object.defineProperty(globalThis.navigator, 'clipboard', { configurable: true, value: { writeText } });
    expect(el.querySelector('[data-testid="fleet-identity-issuer"]')?.textContent).not.toContain('fleet-1');
    expect(el.querySelector('[data-testid="fleet-identity-keys"]')?.textContent).not.toContain('SHA256:abc');
    expect(el.querySelector('[data-testid="fleet-identity-keys"]')?.textContent).toContain('Active key');
    (el.querySelector('[data-testid="fleet-identity-issuer"] button') as HTMLButtonElement).click();
    expect(writeText).toHaveBeenCalledWith('fleet-1');
    const firstKey = fixture.componentInstance.liveKeys()[0];

    fixture.componentInstance.onKeyAction(firstKey, 'copy-fingerprint');
    expect(writeText).toHaveBeenCalledWith(firstKey.fingerprint);
    expect(fixture.componentInstance.keyMenu().map((item) => item.id)).toEqual([
      'copy-id',
      'copy-fingerprint',
      'copy-public-key',
    ]);
    // 3.38: back link left in the breadcrumbs, facts as a key-value list, lane actions dark, no raw list-group.
    expect(el.querySelector('[fpcPageHeaderBreadcrumbs][data-testid="fleet-cluster-back"]')).not.toBeNull();
    expect(el.querySelector('fpc-key-value-list[data-testid="fleet-cluster-facts"]')?.textContent).toContain('1.4.0');
    expect(el.querySelector('dl.row')).toBeNull();
    expect(el.querySelector('[data-testid="fleet-cluster-poll"] button')?.className).toContain('btn-dark');
    expect(el.querySelector('.list-group-item:not(fpc-list-item)')).toBeNull();
    expect(el.querySelector('[lwLaneToolbar] [data-testid="fleet-identity-issuer"]')).not.toBeNull();

    fixture.componentInstance.createNextKey();
    fixture.detectChanges();
    expect(service.createNextIdentityKey).toHaveBeenCalled();
    const next = fixture.componentInstance.liveKeys().find((k) => k.kid === 'k2')!;

    expect(fixture.componentInstance.keyInline(next).map((i) => i.id)).toEqual(['activate']);
    fixture.componentInstance.onKeyAction(next, 'activate');
    expect(service.activateIdentityKey).toHaveBeenCalledWith('k2');
    fixture.destroy();
  });

  it('establishes trust from the modal: the token is sent once and forgotten, refusals stay honest (2026-10-29)', async () => {
    const { fixture, service } = await setup(true, 'untrusted');
    const component = fixture.componentInstance;
    const attempt = (state: string, reason: string | null = null) => ({
      attempt: { state, at: '2026-10-29T10:00:00.000Z', via: 'one-time-token', by: 'u1', reason, credentialHint: '…x' },
      cluster: {},
    });

    (service as Record<string, jest.Mock>)['establishTrust'] = jest
      .fn()
      .mockReturnValueOnce(
        of(attempt('forbidden', 'the one-time token may not manage trusted fleets: cluster admins only')),
      )
      .mockReturnValueOnce(of(attempt('established')));

    component.openTrust();
    component.trustToken = ' lwp_admin-once ';
    component.establishTrust();
    expect((service as Record<string, jest.Mock>)['establishTrust']).toHaveBeenCalledWith(A, 'lwp_admin-once');
    expect(component.trustToken).toBe('');
    expect(component.trustOpen()).toBe(true);
    expect(component.trustError()).toContain('refused the one-time token');

    // Without a token: the connection's own credential.
    component.establishTrust();
    expect((service as Record<string, jest.Mock>)['establishTrust']).toHaveBeenLastCalledWith(A, undefined);
    expect(component.trustOpen()).toBe(false);
    expect(component.trustResult()).toEqual({ tone: 'success', message: 'Trust established' });
    fixture.destroy();
  });

  it('bulk Remove of grants: one call per grant, per-grant results', async () => {
    const grant = (id: string, userId: string): FleetGrant => ({
      id,
      clusterId: A,
      userId,
      role: 'viewer',
      project: null,
      createdBy: null,
      createdAt: '2026-10-01T10:00:00.000Z',
    });
    const { fixture, service } = await setup(true, 'verified', [grant('g1', 'u1'), grant('g2', 'u2')]);
    const component = fixture.componentInstance;

    expect(component.grantMenu().map((i) => i.id)).toEqual(['edit', 'remove']);
    component.selectedGrants.set(['g1', 'g2']);
    await component.revokeSelected();
    expect(service.deleteGrant).toHaveBeenCalledWith(A, 'g1');
    expect(service.deleteGrant).toHaveBeenCalledWith(A, 'g2');
    expect(component.bulkResult()?.message).toContain('not allowed');
    fixture.destroy();
  });

  it('one trust state, facts as rows (2026-10-29): registered, but the credential carries no identities', async () => {
    const { fixture, el } = await setup(true, 'untrusted', [], {
      checkedAt: '2026-10-29T16:31:00.000Z',
      identityReason: 'only PATs with fleet:on-behalf-of or the cluster API key send fleet identities',
      trust: {
        state: 'established',
        at: '2026-10-29T15:50:00.000Z',
        via: 'service-credential',
        by: 'u-admin',
        reason: null,
      },
    });
    const facts = el.querySelector('[data-testid="fleet-cluster-facts"]')?.textContent ?? '';

    // Never "Trust established" next to "Not trusted"; registering again wouldn't help, so no action.
    expect(el.querySelector('[data-testid="fleet-cluster-identity"]')?.getAttribute('data-state')).toBe(
      'not-in-effect',
    );
    expect(facts).not.toContain('Not trusted');
    expect(el.querySelector('[data-testid="fleet-cluster-trust-reason"]')?.textContent).toContain('fleet:on-behalf-of');
    expect(el.querySelector('[data-testid="fleet-cluster-trust-open"]')).toBeNull();
    // Last attempt / Attempted by as their own rows: a badge, the shared date format, the user; no "·" joins.
    expect(facts).toContain('Last attempt');
    expect(facts).toContain('Attempted by');
    expect(el.querySelector('[data-testid="fleet-cluster-trust-attempt"] fpc-badge')?.textContent).toContain(
      'Trust established',
    );
    expect(el.querySelector('[data-testid="fleet-cluster-trust-attempt"]')?.textContent).toContain('Oct 29, 2026');
    expect(el.querySelector('[data-testid="fleet-cluster-trust-by"]')?.textContent?.trim()).toBe('u-admin');
    expect(facts).not.toContain('·');
    expect(el.querySelector('[data-testid="fleet-identity-keys"]')?.textContent).not.toContain('·');
    fixture.destroy();
  });

  it('an attempt the cluster contradicts since: Not trusted, the attempt marked as past; automatic attempts', async () => {
    const { fixture, el } = await setup(true, 'untrusted', [], {
      checkedAt: '2026-10-29T16:31:00.000Z',
      identityCheckedAt: '2026-10-29T16:31:00.000Z',
      trust: {
        state: 'established',
        at: '2026-10-29T15:50:00.000Z',
        via: 'service-credential',
        by: null,
        reason: null,
      },
    });

    expect(el.querySelector('[data-testid="fleet-cluster-identity"]')?.textContent).toContain('Not trusted');
    expect(el.querySelector('[data-testid="fleet-cluster-trust-superseded"]')?.textContent).toContain(
      'Since then: Not trusted',
    );
    expect(el.querySelector('[data-testid="fleet-cluster-trust-by"]')?.textContent).toContain('automatically');
    expect(el.querySelector('[data-testid="fleet-cluster-trust-open"]')).not.toBeNull();
    fixture.destroy();
  });

  it('hides the fleet identity from non-admins', async () => {
    const { fixture, service, el } = await setup(false, 'verified');

    expect(el.querySelector('[data-testid="fleet-cluster-identity"]')?.textContent).toContain('Trusted');
    expect(el.querySelector('[data-testid="fleet-cluster-identity"]')?.textContent).toContain('saved views work');
    expect(el.querySelector('[data-testid="fleet-cluster-trust-open"]')).toBeNull();
    expect(el.querySelector('[data-testid="fleet-identity"]')).toBeNull();
    expect(service.identity).not.toHaveBeenCalled();
    fixture.destroy();
  });
});

describe('fleet audit page', () => {
  function entry(seq: string, action: string): FleetAuditEntry {
    return {
      seq,
      at: '2026-10-20T10:00:00.000Z',
      actorType: 'user',
      actorId: 'u1',
      action,
      clusterId: A,
      target: `cluster/${seq}`,
      details: { reason: 'test-' + seq },
    };
  }

  it('renders the entries as a data table with an expandable detail row and a lead search over the page', async () => {
    const fleet = facadeStub(
      {
        clusters$: [cluster(A, 'alpha')],
        auditEntries$: [entry('2', 'relay.request'), entry('1', 'grant.put')],
        auditPage$: 0,
        auditHasNext$: true,
        auditHasPrevious$: false,
        auditLoading$: false,
        auditError$: null,
      },
      ['loadClusters', 'searchAudit', 'nextAuditPage', 'previousAuditPage'],
    );

    await TestBed.configureTestingModule({
      imports: [LoadweaverFleetAuditPageComponent],
      providers: [
        provideRouter([]),
        { provide: ConsoleFleetFacade, useValue: fleet },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({}) } } },
      ],
    }).compileComponents();
    jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    const fixture = TestBed.createComponent(LoadweaverFleetAuditPageComponent);
    const component = fixture.componentInstance;
    const el = fixture.nativeElement as HTMLElement;

    fixture.detectChanges();
    expect(fleet['searchAudit']).toHaveBeenCalledWith({}, 25);
    expect(el.querySelector('fpc-data-table[data-testid="fleet-audit-table"]')).not.toBeNull();
    expect(el.querySelectorAll('tr.fpc-data-table__row')).toHaveLength(2);
    // One strip: the table's own search; the built-in pager (server, cursor) pages older / newer.
    expect(el.querySelectorAll('fpc-search-field')).toHaveLength(1);
    expect(el.querySelector('[data-testid="fpc-data-table-pager"]')).not.toBeNull();
    component.onPage(2);
    expect(fleet['nextAuditPage']).toHaveBeenCalled();
    expect(component.rowMenu().map((i) => i.id)).toEqual(['copy-id']);

    component.toggle(component.entries()[0]);
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="fleet-audit-details"]')?.textContent).toContain('test-2');

    component.query.set('grant');
    fixture.detectChanges();
    expect(el.querySelectorAll('tr.fpc-data-table__row')).toHaveLength(1);
    component.query.set('nothing');
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="fpc-data-table-no-matches"]')).not.toBeNull();
    fixture.destroy();
  });
});
