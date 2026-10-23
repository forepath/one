import { TestBed } from '@angular/core/testing';
import {
  LoadweaverClusterService,
  type LoadweaverClusterInfo,
} from '@forepath/decabill/frontend/data-access-billing-console';
import { of, throwError } from 'rxjs';

import {
  LoadweaverClusterTabComponent,
  loadweaverHealthColor,
  loadweaverHealthLabel,
} from './loadweaver-cluster-tab.component';

const cluster: LoadweaverClusterInfo = {
  itemId: 'item-1',
  consoleUrl: 'https://lw-a1b2.spirde.com',
  apiUrl: 'https://lw-a1b2.spirde.com/api',
  installerUrl: 'https://lw-a1b2.spirde.com/api/install/install.sh',
  health: 'healthy',
  checkedAt: '2026-10-20T12:00:00.000Z',
  initialVersion: '1.4.0',
  links: {
    platformBackups: 'https://lw-a1b2.spirde.com/backups/platform',
    recoveryKit: 'https://lw-a1b2.spirde.com/backups/keys',
    nodes: 'https://lw-a1b2.spirde.com/nodes',
  },
  adminClaim: { status: 'claimed', token: null },
  teardown: { graceDays: 7, deletionNotBefore: '2026-11-08T00:00:00.000Z' },
};
const token = `lwc_${'x'.repeat(43)}`;

describe('LoadweaverClusterTabComponent', () => {
  const getCluster = jest.fn();

  beforeEach(async () => {
    getCluster.mockReset();
    await TestBed.configureTestingModule({
      imports: [LoadweaverClusterTabComponent],
      providers: [{ provide: LoadweaverClusterService, useValue: { getCluster } }],
    }).compileComponents();
  });

  function create(adminMode = false) {
    const fixture = TestBed.createComponent(LoadweaverClusterTabComponent);

    fixture.componentInstance.subscriptionId = 'sub-1';
    fixture.componentInstance.itemId = 'item-1';
    fixture.componentInstance.adminMode = adminMode;
    fixture.componentInstance.ngOnChanges();
    fixture.detectChanges();

    return fixture;
  }

  it('shows endpoint, installer line and the scheduled deletion', () => {
    getCluster.mockReturnValue(of(cluster));

    const fixture = create(true);
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(getCluster).toHaveBeenCalledWith('sub-1', 'item-1', true);
    expect(text).toContain('https://lw-a1b2.spirde.com');
    expect(text).toContain('LOADWEAVER_JOIN_TOKEN=<token>');
    expect(text).toContain('Cluster deletion scheduled');
    expect(fixture.componentInstance.healthLabel()).toBe('Healthy');
  });

  it('shows the admin claim token with instructions until the cluster is claimed', () => {
    getCluster.mockReturnValue(of({ ...cluster, adminClaim: { status: 'pending', token } }));

    const el = create().nativeElement as HTMLElement;

    expect(el.querySelector('[data-testid="loadweaver-admin-claim"]')?.textContent).toContain(token);
    expect(el.textContent).toContain('Claim your cluster');
  });

  it('hides the claim once claimed and never shows a token in the admin view', () => {
    getCluster.mockReturnValue(of(cluster));
    expect((create().nativeElement as HTMLElement).querySelector('[data-testid="loadweaver-admin-claim"]')).toBeNull();

    getCluster.mockReturnValue(of({ ...cluster, adminClaim: { status: 'pending', token: null } }));

    const el = create(true).nativeElement as HTMLElement;

    expect(el.querySelector('[data-testid="loadweaver-admin-claim"]')).toBeNull();
    expect(el.querySelector('[data-testid="loadweaver-admin-claim-pending"]')).not.toBeNull();
  });

  it('shows an error when the status cannot be loaded', () => {
    getCluster.mockReturnValue(throwError(() => new Error('boom')));

    const fixture = create();

    expect(fixture.componentInstance.error()).toBe('The cluster status could not be loaded.');
  });

  it('maps every health state to a label and colour', () => {
    expect(loadweaverHealthLabel('unreachable')).toBe('Unreachable');
    expect(loadweaverHealthColor('healthy')).toBe('success');
    expect(loadweaverHealthColor('degraded')).toBe('warning');
    expect(loadweaverHealthColor('failed')).toBe('danger');
    expect(loadweaverHealthColor(undefined)).toBe('secondary');
  });
});
