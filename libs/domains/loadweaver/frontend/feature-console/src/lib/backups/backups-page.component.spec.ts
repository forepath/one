import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import {
  backupVolumes,
  ConsoleAccessFacade,
  ConsoleBackupsFacade,
  ConsoleLiveFacade,
  type AccessMe,
  type Backup,
  type BackupsStatus,
} from '@forepath/loadweaver/frontend/data-access-console';

import { accessStub, facadeStub, testBackup, testBackupDeletion } from '../testing';
import { LoadweaverBackupsPageComponent } from './backups-page.component';

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

  async function setup(me: AccessMe, backups: Backup[] = [latest, older], streams: Record<string, unknown> = {}) {
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
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LoadweaverBackupsPageComponent);
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const q = (id: string) => el().querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

  it('shows pins, the kit state, usage, targets and the catalog with a timeline', async () => {
    await setup({ userId: 'u2', clusterRole: 'cluster-admin', projects: {} });

    expect(facade['load']).toHaveBeenCalledWith(null);
    expect(live['loadTargets']).toHaveBeenCalled();
    expect(q('backups-pin')?.textContent).toContain('no external backup target');
    expect(q('backups-kit-warning')?.textContent).toContain('not recoverable');
    expect(q('backups-usage')?.textContent).toContain('300 B');
    expect(q('backups-targets')?.textContent).toContain('denied');
    expect(q('backups-keys')).not.toBeNull();
    expect(q('backups-platform')).not.toBeNull();
    expect(q('backups-new-target')).not.toBeNull();
    expect(q('backups-deletions')).not.toBeNull();
    expect(el().querySelector('#fpc-tab-deletions')?.textContent).toContain('1');

    const volume = q('backups-volume-shop/web/data');

    expect(volume?.querySelectorAll('[data-testid="backups-timeline"] a')).toHaveLength(2);
    expect(q('backups-row-b1')?.textContent).toContain('Restore test passed');
    expect(q('backups-row-b1')?.textContent).toContain('daily');
    expect(q('backups-row-b1')?.querySelector('.bi-lock-fill')).not.toBeNull();
    // A volume of the topology without backups is listed with "back up now".
    expect(q('backups-volume-shop/db/pg')?.textContent).toContain('No backups');
  });

  it('starts backups, restore tests and opens the restore wizard for operators', async () => {
    await setup({ userId: 'u2', clusterRole: null, projects: { shop: 'operator' } });

    (q('backups-now-shop/web/data')?.querySelector('button') as HTMLButtonElement).click();
    expect(facade['backupNow']).toHaveBeenCalledWith('shop/web/data');
    (q('backups-test-b1') as HTMLButtonElement).click();
    expect(facade['testNow']).toHaveBeenCalledWith('b1');
    (q('backups-restore-b1') as HTMLButtonElement).click();
    expect(fixture.componentInstance.restoreOpen()).toBe(true);
    expect(fixture.componentInstance.restoreFor()?.backup.id).toBe('b1');
    // Deletions are for admins; the key page for cluster admins.
    expect(q('backups-delete-b1')).toBeNull();
    expect(q('backups-keys')).toBeNull();
    expect(q('backups-platform')).toBeNull();
  });

  it('hides actions from viewers', async () => {
    await setup({ userId: 'u3', clusterRole: null, projects: { shop: 'viewer' } });

    expect(q('backups-now-shop/web/data')).toBeNull();
    expect(q('backups-restore-b1')).toBeNull();
    expect(q('backups-test-b1')).toBeNull();
    expect(q('backups-compare-b1')).not.toBeNull();
  });

  it('requests a deletion with a reason and explains the rule', async () => {
    await setup({ userId: 'u2', clusterRole: null, projects: { shop: 'admin' } });

    (q('backups-delete-b1') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(document.body.textContent).toContain('second admin');
    expect(document.body.textContent).toContain('72 h');
    fixture.componentInstance.deletionReason = 'GDPR erasure';
    fixture.componentInstance.requestDeletion();
    expect(facade['requestDeletion']).toHaveBeenCalledWith(['b1'], 'GDPR erasure');
  });

  it('compares a backup with another of the same volume, older first', async () => {
    await setup({ userId: 'u2', clusterRole: 'auditor', projects: {} });

    const navigate = jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    (q('backups-compare-b1') as HTMLButtonElement).click();
    expect(fixture.componentInstance.diffOther).toBe('b0');
    fixture.componentInstance.compare();
    expect(navigate).toHaveBeenCalledWith(['/backups/diff'], { queryParams: { from: 'b0', to: 'b1' } });
  });

  it('filters by project', async () => {
    await setup({ userId: 'u2', clusterRole: 'cluster-admin', projects: {} });
    jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    fixture.componentInstance.selectProject('blog');
    fixture.detectChanges();

    expect(facade['load']).toHaveBeenLastCalledWith('blog');
    expect(q('backups-volume-shop/web/data')).toBeNull();
  });
});
