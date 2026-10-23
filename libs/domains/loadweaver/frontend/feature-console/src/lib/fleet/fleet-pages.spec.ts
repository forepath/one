import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { AuthenticationFacade } from '@forepath/identity/frontend';
import {
  ConsoleFleetFacade,
  FleetService,
  type FleetCard,
  type FleetCluster,
  type FleetOperation,
} from '@forepath/loadweaver/frontend/data-access-console';
import { of, Subject } from 'rxjs';

import { facadeStub } from '../testing';
import { clusterUpdate, emptyClusterForm, LoadweaverFleetClustersPageComponent } from './fleet-clusters-page.component';
import { LoadweaverFleetComparePageComponent } from './fleet-compare-page.component';
import {
  buildOperation,
  defaultTargetVolume,
  emptyOperationForm,
  LoadweaverFleetOperationsPageComponent,
} from './fleet-operations-page.component';
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
    link: `/clusters/${id}/overview`,
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
          link: `/clusters/${B}/alerts/x1`,
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
    expect(el.querySelector('[data-testid="fleet-card-alpha"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="fleet-card-beta"] [data-testid="fleet-card-teardown"]')).not.toBeNull();
    expect(el.querySelectorAll('[data-testid="fleet-map-site"]')).toHaveLength(1);
    expect(el.textContent).toContain('Disk full');

    fixture.componentInstance.open(fixture.componentInstance.cards()[0]);
    expect(fleet['openCluster']).toHaveBeenCalledWith(A, '/overview');

    fixture.componentInstance.openItem(fixture.componentInstance.inbox()[0]);
    expect(fleet['openCluster']).toHaveBeenCalledWith(B, '/alerts/x1');

    // Approvals stay native: the cluster's own console, never the relay.
    const open = jest.spyOn(window, 'open').mockReturnValue(null);

    expect(el.querySelector('[data-testid="fleet-inbox-native"]')?.getAttribute('href')).toBe(
      'https://alpha.example.com/plans/p1',
    );
    fleet['openCluster'].mockClear();
    fixture.componentInstance.openItem(fixture.componentInstance.inbox()[1]);
    expect(open).toHaveBeenCalledWith('https://alpha.example.com/plans/p1', '_blank', 'noopener,noreferrer');
    expect(fleet['openCluster']).not.toHaveBeenCalled();
    fixture.destroy();
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
    expect(el.querySelector('[data-testid="fleet-cluster-edit-alpha"]')).toBeNull();
    viewer.fixture.destroy();
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
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="fleet-op-cancel-op1"]')).not.toBeNull();

    component.openWizard();
    component.form.sourceClusterId = A;
    component.form.sourceProject = 'shop';
    component.loadBackups();
    expect(service.sourceBackups).toHaveBeenCalledWith(A, 'shop');
    component.setBackup(0, { selected: true });
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
