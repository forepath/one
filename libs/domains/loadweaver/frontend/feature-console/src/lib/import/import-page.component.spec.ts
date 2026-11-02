import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import {
  ImportService,
  type ImportDetail,
  type ImportSelectionView,
} from '@forepath/loadweaver/frontend/data-access-console';
import { of } from 'rxjs';

import { LoadweaverImportPageComponent } from './import-page.component';
import { LoadweaverImportsPageComponent } from './imports-page.component';

const detail: ImportDetail = {
  node: 'host1',
  lifecycle: 'pending',
  connected: true,
  discovery: {
    id: 'd1',
    source: 'join',
    receivedAt: '2026-10-20T10:00:00.000Z',
    requestedAt: null,
    report: {
      hostname: 'host1',
      docker: { available: true, version: '29.9.1' },
      listeners: [],
      interfaces: [],
      vpns: [{ interface: 'wg0', kind: 'wireguard', listenPort: 51820 }],
      composeProjects: [
        {
          name: 'shop',
          envFile: { path: '/srv/shop/.env', variables: [{ name: 'DB_PASSWORD', sensitive: true }] },
          configFiles: [{ path: '/srv/shop/compose.yaml' }],
        },
      ],
      former: null,
      warnings: [],
    },
  },
  items: [
    {
      id: 'compose:shop',
      kind: 'compose',
      name: 'shop',
      containers: ['a'.repeat(64)],
      services: ['web'],
      ports: [{ protocol: 'tcp', hostPort: 80, containerPort: 80, service: 'web' }],
      mounts: [
        {
          key: 'volume:shop_html',
          type: 'volume',
          source: '/var/lib/docker/volumes/shop_html/_data',
          destination: '/usr/share/nginx/html',
          service: 'web',
          sizeBytes: 2048,
        },
      ],
      stateful: true,
      managed: false,
    },
  ],
  projects: ['shop'],
  selection: null,
};

const view: ImportSelectionView = {
  id: 's1',
  status: 'draft',
  discoveryId: 'd1',
  selections: { items: [] },
  joinPlan: {
    node: 'host1',
    former: null,
    conflicts: [{ kind: 'tunnel', severity: 'resolved', subject: 'wg0', reason: 'pre-existing wireguard tunnel' }],
    errors: [],
    warnings: [],
    deployments: [{ item: 'compose:shop', choice: 'import', project: 'shop', name: 'shop' }],
    steps: [
      { id: 'components', kind: 'components', description: 'Install the node components' },
      { id: 'activate', kind: 'activate', description: 'Activate the node' },
    ],
    reservedPorts: { tcp: [], udp: [51820] },
    leftovers: [],
    wipeFormerIdentity: false,
  },
  planId: null,
  steps: {},
  released: [],
  error: null,
  createdAt: '2026-10-20T10:00:00.000Z',
  updatedAt: '2026-10-20T10:00:00.000Z',
};

describe('import wizard', () => {
  const service = {
    get: jest.fn(() => of(detail)),
    list: jest.fn(() => of([])),
    saveSelection: jest.fn(() => of(view)),
    createPlan: jest.fn(() => of({ id: 'p1' })),
    discover: jest.fn(() => of({ request: 'r' })),
    discard: jest.fn(() => of({ discarded: false, nodeLeft: true })),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    TestBed.configureTestingModule({
      imports: [LoadweaverImportPageComponent, LoadweaverImportsPageComponent],
      providers: [
        provideRouter([]),
        { provide: ImportService, useValue: service },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ node: 'host1' }) } } },
      ],
    });
  });

  it('shows the discovered items and builds the join plan from the selection', () => {
    const fixture = TestBed.createComponent(LoadweaverImportPageComponent);
    const component = fixture.componentInstance;

    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('[data-testid="import-items"]')?.textContent).toContain('shop');
    expect(element.textContent).toContain('wg0');
    expect(component.sensitiveVariables()).toEqual([{ project: 'shop', name: 'DB_PASSWORD' }]);

    component.update(detail.items[0], { choice: 'import', project: 'shop' });
    component.setHostname(detail.items[0], 80, ' shop.example.com ');
    component.setVariable('shop', 'DB_PASSWORD', 'pw');
    component.buildPlan();

    expect(service.saveSelection).toHaveBeenCalledWith('host1', {
      items: [
        {
          item: 'compose:shop',
          choice: 'import',
          project: 'shop',
          deployment: 'shop',
          http: { '80': 'shop.example.com' },
          variables: { DB_PASSWORD: 'pw' },
        },
      ],
    });

    fixture.detectChanges();
    expect(element.querySelector('[data-testid="import-steps"]')?.textContent).toContain('Activate the node');
    // 3.38: plan lane groups under list headers, secrets as labelled form fields, no raw section headings.
    expect(element.querySelectorAll('[data-testid="import-plan-lane"] fpc-list-header').length).toBeGreaterThan(1);
    expect(
      element.querySelector('fpc-form-field[forid="lw-import-var-0"], [data-testid="import-plan-lane"] fpc-form-field'),
    ).not.toBeNull();
    expect(element.querySelector('[data-testid="import-plan-lane"] h3')).toBeNull();
  });

  it('creates the plan and opens it', () => {
    const router = TestBed.inject(Router);
    const navigate = jest.spyOn(router, 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(LoadweaverImportPageComponent);

    fixture.detectChanges();
    fixture.componentInstance.createPlan();

    expect(service.createPlan).toHaveBeenCalledWith('host1');
    expect(navigate).toHaveBeenCalledWith(['/activity/plans', 'p1']);
  });

  it('lists hosts waiting for an import', () => {
    const fixture = TestBed.createComponent(LoadweaverImportsPageComponent);

    fixture.detectChanges();

    expect(service.list).toHaveBeenCalled();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('No host waits for an import');
  });
});
