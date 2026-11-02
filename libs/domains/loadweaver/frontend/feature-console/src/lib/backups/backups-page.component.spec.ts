import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import {
  backupVolumes,
  ConsoleAccessFacade,
  ConsoleBackupsFacade,
  ConsoleLiveFacade,
  type AccessMe,
  type Backup,
  BackupsService,
  type BackupsStatus,
} from '@forepath/loadweaver/frontend/data-access-console';

import { LW_SECTION_SCOPE } from '../section/section-scope';
import { of, throwError } from 'rxjs';

import { accessStub, facadeStub, testBackup, testBackupDeletion } from '../testing';
import { catalogVolumeInResource } from './backup-format';
import { LoadweaverBackupsPageComponent } from './backups-page.component';
import { LoadweaverBackupsOverviewComponent } from './backups-overview.component';
import { LoadweaverBackupsSummaryComponent } from './backups-summary.component';

const status: BackupsStatus = {
  keys: { generation: 1, kitConfirmed: false, escrowed: false },
  pins: ["backups don't survive the loss of the cluster: no external backup target holds a copy"],
  repositories: [],
  targets: [{ target: 'offsite', scope: 'project-shop', at: '2026-10-01T10:02:00.000Z', ok: false, error: 'denied' }],
  usage: [{ project: 'shop', bytes: 3000, uploadedBytes: 300, backups: 2 }],
  deletionDelayHours: 72,
};

const older = testBackup({ id: 'b0', startedAt: '2026-09-30T10:00:00.000Z', bytes: 500 });
const latest = testBackup({
  id: 'b1',
  lockedUntil: '2099-01-01T00:00:00.000Z',
  restoreTest: { id: 't1', status: 'passed', finishedAt: '2026-10-01T11:00:00.000Z' },
});

describe('LoadweaverBackupsPageComponent', () => {
  let fixture: ComponentFixture<LoadweaverBackupsPageComponent>;
  let facade: ReturnType<typeof facadeStub>;
  let live: ReturnType<typeof facadeStub>;

  async function setup(
    me: AccessMe,
    backups: Backup[] = [latest, older],
    streams: Record<string, unknown> = {},
    scope: Record<string, string> | null = null,
  ) {
    facade = facadeStub(
      {
        status$: status,
        volumes$: backupVolumes(backups),
        openDeletions$: [testBackupDeletion()],
        loaded$: true,
        loading$: false,
        error$: null,
        busy$: false,
        backingUp$: [],
        testing$: [],
        actionError$: null,
        requestingDeletion$: false,
        deletionRequestError$: null,
        requestedDeletion$: null,
        planningRestore$: false,
        restorePlanError$: null,
        ...streams,
      },
      [
        'load',
        'backupNow',
        'testNow',
        'requestDeletion',
        'clearDeletionRequest',
        'planRestore',
        'clearRestorePlanError',
      ],
    );
    live = facadeStub(
      {
        volumes$: [
          { id: 'shop/web/data', project: 'shop', deployment: 'web', name: 'data' },
          { id: 'shop/db/pg', project: 'shop', deployment: 'db', name: 'pg' },
          { id: 'shop/lw-vm/vm1.root', project: 'shop', deployment: 'lw-vm', name: 'vm1.root' },
        ],
      },
      ['loadTargets'],
    );

    await TestBed.configureTestingModule({
      imports: [LoadweaverBackupsPageComponent],
      providers: [
        provideRouter([]),
        { provide: ConsoleBackupsFacade, useValue: facade },
        { provide: ConsoleAccessFacade, useValue: accessStub(me) },
        { provide: ConsoleLiveFacade, useValue: live },
        { provide: BackupsService, useValue: { backupNow: jest.fn(), restoreTest: jest.fn() } },
        ...(scope ? [{ provide: LW_SECTION_SCOPE, useValue: { params: signal(scope) } }] : []),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LoadweaverBackupsPageComponent);
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const q = (id: string) => el().querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

  /** Opens a volume's row detail (timeline + backups table). */
  function open(volume: string): void {
    const component = fixture.componentInstance;

    component.toggle(component.catalog().find((v) => v.resource === volume)!);
    fixture.detectChanges();
  }

  it('shows the volumes as a table; a volume opens its timeline and backups; policies in the strip', async () => {
    await setup({ userId: 'u2', clusterRole: 'cluster-admin', projects: {} });

    expect(facade['load']).toHaveBeenCalledWith(null);
    expect(live['loadTargets']).toHaveBeenCalled();
    // Header, pins and KPIs are the shell's summary; usage / targets the empty detail lane (3.38).
    expect(el().querySelector('fpc-page-header')).toBeNull();
    expect(q('backups-pin')).toBeNull();
    expect(q('backups-policies')).not.toBeNull();
    // Creating policies: the top-bar "+" only (2026-10-29).
    expect(q('backups-new-policy')).toBeNull();
    expect(q('backups-catalog')?.textContent).toContain('shop/web/data');
    // A volume of the topology without backups is listed (state "No backups").
    expect(q('backups-catalog')?.textContent).toContain('shop/db/pg');
    expect(
      [...el().querySelectorAll('[data-testid="fpc-data-table-state"]')].map((s) => s.getAttribute('aria-label')),
    ).toContain('No backups');

    open('shop/web/data');
    const volume = q('backups-volume-shop/web/data');

    expect(q('backups-timeline')?.querySelectorAll('a')).toHaveLength(2);
    expect(volume?.textContent).toContain('Restore test passed');
    expect(volume?.textContent).toContain('daily');
    expect(volume?.querySelector('fpc-badge[aria-label="Immutable"]')).not.toBeNull();
    expect(volume?.querySelector('a.fpc-data-table__link')?.getAttribute('href')).toContain('/operate/backups/b1');
    // No raw backup ids as data (D11).
    expect(volume?.textContent).not.toContain('6f0c1b0e');
  });

  it('starts backups, restore tests and opens the restore wizard for operators', async () => {
    await setup({ userId: 'u2', clusterRole: null, projects: { shop: 'operator' } });

    const component = fixture.componentInstance;
    const web = component.catalog().find((v) => v.resource === 'shop/web/data')!;

    expect(component.volumeMenu(web).map((i) => i.id)).toEqual(['backup-now', 'copy-resource']);
    component.onVolumeAction(web, 'backup-now');
    expect(facade['backupNow']).toHaveBeenCalledWith('shop/web/data');
    expect(component.backupMenu(latest).map((i) => i.id)).toEqual(['open', 'compare', 'restore', 'test', 'copy-id']);
    component.onBackupAction(latest, 'test');
    expect(facade['testNow']).toHaveBeenCalledWith('b1');
    component.onBackupAction(latest, 'restore');
    expect(component.restoreOpen()).toBe(true);
    expect(component.restoreFor()?.backup.id).toBe('b1');
    // Deletions are for admins; the key page for cluster admins.
    expect(component.backupMenu(latest).some((i) => i.id === 'delete')).toBe(false);
    expect(q('backups-keys')).toBeNull();
    expect(q('backups-platform')).toBeNull();
  });

  it('hides actions from viewers', async () => {
    await setup({ userId: 'u3', clusterRole: null, projects: { shop: 'viewer' } });

    const component = fixture.componentInstance;

    expect(component.volumeMenu(component.catalog()[0]).map((i) => i.id)).toEqual(['copy-resource']);
    expect(component.backupMenu(latest).map((i) => i.id)).toEqual(['open', 'compare', 'copy-id']);
    component.selectedVolumes.set(['shop/web/data']);
    expect(component.canBackupSelection()).toBe(false);
  });

  it('requests a deletion with a reason and explains the rule', async () => {
    await setup({ userId: 'u2', clusterRole: null, projects: { shop: 'admin' } });

    fixture.componentInstance.onBackupAction(latest, 'delete');
    fixture.detectChanges();

    expect(document.body.textContent).toContain('second admin');
    expect(document.body.textContent).toContain('72 h');
    fixture.componentInstance.deletionReason = 'GDPR erasure';
    fixture.componentInstance.requestDeletion();
    expect(facade['requestDeletion']).toHaveBeenCalledWith(['b1'], 'GDPR erasure');
  });

  it('bulk: one deletion request for the selected backups; restore tests per backup with per-item results', async () => {
    await setup({ userId: 'u2', clusterRole: null, projects: { shop: 'admin' } });

    const component = fixture.componentInstance;
    const service = TestBed.inject(BackupsService);
    const restoreTest = (service.restoreTest as jest.Mock)
      .mockImplementationOnce(() => of({}))
      .mockImplementationOnce(() => throwError(() => ({ status: 403, error: { message: 'Not yours' } })));

    open('shop/web/data');
    component.selectedBackups.set(['b1', 'b0']);
    expect(component.canDeleteSelection()).toBe(true);
    expect(component.canTestSelection()).toBe(true);

    component.deleteSelected();
    component.deletionReason = 'Old data';
    component.requestDeletion();
    expect(facade['requestDeletion']).toHaveBeenCalledWith(['b1', 'b0'], 'Old data');

    await component.testSelected();
    expect(restoreTest).toHaveBeenCalledTimes(2);
    expect(component.bulkResult()?.tone).toBe('warning');
    expect(component.bulkResult()?.message).toContain('1 not allowed');
  });

  it('bulk Back up now: one call per selected volume', async () => {
    await setup({ userId: 'u2', clusterRole: null, projects: { shop: 'operator' } });

    const component = fixture.componentInstance;
    const backupNow = (TestBed.inject(BackupsService).backupNow as jest.Mock).mockImplementation(() => of(latest));

    component.selectedVolumes.set(['shop/web/data', 'shop/db/pg']);
    expect(component.canBackupSelection()).toBe(true);
    await component.backupSelected();
    expect(backupNow).toHaveBeenCalledWith('shop/web/data');
    expect(backupNow).toHaveBeenCalledWith('shop/db/pg');
    expect(component.bulkResult()?.tone).toBe('success');
  });

  it('compares a backup with another of the same volume, older first', async () => {
    await setup({ userId: 'u2', clusterRole: 'auditor', projects: {} });

    const navigate = jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    fixture.componentInstance.onBackupAction(latest, 'compare');
    expect(fixture.componentInstance.diffOther).toBe('b0');
    fixture.componentInstance.compare();
    expect(navigate).toHaveBeenCalledWith(['/operate/backups/diff'], { queryParams: { from: 'b0', to: 'b1' } });
  });

  it('searches the catalog volumes', async () => {
    await setup({ userId: 'u2', clusterRole: null, projects: { shop: 'admin' } });

    fixture.componentInstance.search.set('db/pg');
    fixture.detectChanges();
    expect(q('backups-catalog')?.textContent).not.toContain('shop/web/data');
    expect(q('backups-catalog')?.textContent).toContain('shop/db/pg');

    fixture.componentInstance.search.set('no-such-volume');
    fixture.detectChanges();
    expect(q('fpc-data-table-no-matches')).not.toBeNull();
  });

  it('embedded in a deployment / VM tab: only its volumes, no project filter, no URL write', async () => {
    const navigate = jest.fn().mockResolvedValue(true);

    await setup(
      { userId: 'u2', clusterRole: 'cluster-admin', projects: {} },
      [latest, older],
      {},
      {
        project: 'shop',
        resource: 'db',
      },
    );
    jest.spyOn(TestBed.inject(Router), 'navigate').mockImplementation(navigate);

    expect(facade['load']).toHaveBeenCalledWith('shop');
    expect(fixture.componentInstance.catalog().map((v) => v.resource)).toEqual(['shop/db/pg']);
    expect(el().querySelector('.fpc-list-toolbar__toggle')).toBeNull();
    expect(el().querySelector('loadweaver-saved-views')).toBeNull();

    fixture.componentInstance.selectProject('shop');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('matches catalog volumes to an object tab resource', () => {
    expect(catalogVolumeInResource({ deployment: 'web', volume: 'data' }, 'web')).toBe(true);
    expect(catalogVolumeInResource({ deployment: 'web', volume: 'data' }, 'data')).toBe(true);
    expect(catalogVolumeInResource({ deployment: 'web', volume: 'data' }, 'web/data')).toBe(true);
    expect(catalogVolumeInResource({ deployment: 'lw-vm', volume: 'vm1.root' }, 'lw-vm/vm1')).toBe(true);
    expect(catalogVolumeInResource({ deployment: 'lw-vm', volume: 'vm10.root' }, 'lw-vm/vm1')).toBe(false);
    expect(catalogVolumeInResource({ deployment: 'db', volume: 'pg' }, 'web')).toBe(false);
  });

  it('filters by project', async () => {
    await setup({ userId: 'u2', clusterRole: 'cluster-admin', projects: {} });
    jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    fixture.componentInstance.selectProject('blog');
    fixture.detectChanges();

    expect(facade['load']).toHaveBeenLastCalledWith('blog');
    expect(q('backups-catalog')?.textContent).not.toContain('shop/web/data');
  });
});

describe('LoadweaverBackupsSummaryComponent / LoadweaverBackupsOverviewComponent', () => {
  async function setup<T>(component: new (...args: never[]) => T, query: Record<string, string> = {}) {
    await TestBed.configureTestingModule({
      imports: [component],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            queryParamMap: of(convertToParamMap(query)),
            snapshot: { queryParamMap: convertToParamMap(query) },
          },
        },
        {
          provide: ConsoleBackupsFacade,
          useValue: facadeStub({ status$: status, openDeletions$: [testBackupDeletion()] }, []),
        },
        {
          provide: ConsoleAccessFacade,
          useValue: accessStub({ userId: 'u', clusterRole: 'cluster-admin', projects: {} }),
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(component);

    fixture.detectChanges();

    return fixture.nativeElement as HTMLElement;
  }

  it('summary: header, pins, kit warning and the KPI bar (target copies, deletions)', async () => {
    const el = await setup(LoadweaverBackupsSummaryComponent);

    expect(el.querySelector('fpc-page-header')?.textContent).toContain('Backups');
    expect(el.querySelector('[data-testid="backups-pin"]')?.textContent).toContain('no external backup target');
    expect(el.querySelector('[data-testid="backups-kit-warning"]')?.textContent).toContain('not recoverable');
    expect(el.querySelector('[data-testid="backups-summary-targets"]')?.textContent).toContain('0 / 1');
    expect(el.querySelector('[data-testid="backups-summary"]')?.textContent).toContain('Not confirmed');
  });

  it('overview: usage per project and target copies as lanes', async () => {
    const el = await setup(LoadweaverBackupsOverviewComponent, { project: 'shop' });

    expect(el.querySelector('[data-testid="backups-usage"]')?.textContent).toContain('300 B');
    expect(el.querySelector('[data-testid="backups-targets"]')?.textContent).toContain('denied');
    expect(el.querySelector('[data-testid="backups-new-target"]')).toBeNull();
  });
});
