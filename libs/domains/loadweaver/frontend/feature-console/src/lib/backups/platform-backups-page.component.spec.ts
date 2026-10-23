import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, type Route } from '@angular/router';
import {
  BackupsService,
  ConsoleAccessFacade,
  type AccessMe,
  type PlatformBackupStatus,
  type PlatformCutover,
  type PlatformRestore,
} from '@forepath/loadweaver/frontend/data-access-console';
import { of, throwError } from 'rxjs';

import { loadweaverConsoleRoutes } from '../loadweaver-console.routes';
import { accessStub } from '../testing';
import { localDateTimeToIso } from './platform-backup-format';
import { LoadweaverPlatformBackupsPageComponent } from './platform-backups-page.component';

const restore = (overrides: Partial<PlatformRestore> = {}): PlatformRestore => ({
  id: 'r1',
  kind: 'postgres',
  state: 'ready',
  node: 'n1',
  scope: 'loadweaver-pitr-1',
  sourceScope: 'loadweaver',
  targetTime: '2026-10-19T08:00:00.000Z',
  error: null,
  requestedBy: 'u1',
  createdAt: '2026-10-19T09:00:00.000Z',
  readyAt: '2026-10-19T09:05:00.000Z',
  finishedAt: null,
  endpoint: { host: '10.0.0.1', port: 5433, patroniPort: 8009 },
  ...overrides,
});

const cutover = (overrides: Partial<PlatformCutover> = {}): PlatformCutover => ({
  id: 'c1',
  restoreId: 'r2',
  state: 'planned',
  node: 'n1',
  scope: 'loadweaver-pitr-2',
  previousScope: 'loadweaver',
  targetTime: '2026-10-19T07:00:00.000Z',
  plan: {
    steps: ['Take a final base backup', 'Switch the services'],
    warnings: ['Data written after 2026-10-19T07:00:00Z is lost'],
    members: ['n1', 'n2'],
    dataLossAfter: '2026-10-19T07:00:00.000Z',
  },
  requestedBy: 'u1',
  approvedBy: null,
  approvedAt: null,
  finalBackup: null,
  error: null,
  createdAt: '2026-10-19T09:10:00.000Z',
  switchedAt: null,
  finishedAt: null,
  ...overrides,
});

function platformStatus(overrides: Partial<PlatformBackupStatus> = {}): PlatformBackupStatus {
  const kind = { enabled: true, schedule: '0 3 * * *', keep: 7 };

  return {
    enabled: true,
    gateway: true,
    settings: { enabled: true, timeZone: 'Europe/Berlin', postgres: kind, opensearch: kind, etcd: kind },
    kinds: [
      {
        kind: 'postgres',
        enabled: true,
        schedule: '0 3 * * *',
        keep: 3,
        effectiveKeep: 7,
        retentionRequest: {
          id: 'd1',
          keep: 3,
          state: 'pending',
          requestedBy: 'u1',
          approvedBy: null,
          notBefore: '2026-10-21T09:00:00.000Z',
        },
        lastStartedAt: '2026-10-19T03:00:00.000Z',
        lastFinishedAt: '2026-10-19T03:01:00.000Z',
        lastStatus: 'succeeded',
        lastError: null,
        lastBackup: 'base_0001',
        running: false,
        backups: [
          {
            id: 'p1',
            name: 'base_0001',
            status: 'succeeded',
            bytes: 2048,
            startedAt: '2026-10-19T03:00:00.000Z',
            finishedAt: '2026-10-19T03:01:00.000Z',
            targets: [{ target: 'offsite', copiedAt: '2026-10-19T03:05:00.000Z', lockedUntil: '2099-01-01T00:00:00Z' }],
          },
        ],
      },
      {
        kind: 'etcd',
        enabled: true,
        schedule: '0 * * * *',
        keep: 24,
        effectiveKeep: 24,
        retentionRequest: null,
        lastStartedAt: null,
        lastFinishedAt: null,
        lastStatus: null,
        lastError: null,
        lastBackup: null,
        running: false,
        backups: [],
      },
    ],
    postgresWindow: { from: '2026-10-12T03:00:00.000Z', to: '2026-10-19T09:00:00.000Z' },
    postgresScope: 'loadweaver',
    restores: [restore(), restore({ id: 'r2', createdAt: '2026-10-19T08:30:00.000Z' })],
    copies: [
      {
        target: 'offsite',
        type: 's3',
        declared: true,
        objectLock: { mode: 'COMPLIANCE', days: 30 },
        lastStartedAt: '2026-10-19T03:05:00.000Z',
        lastFinishedAt: '2026-10-19T03:06:00.000Z',
        lastStatus: 'succeeded',
        lastError: null,
        objects: 12,
        bytes: 3 * 1024 * 1024,
        verifiedEnvelope: 'dr/envelope-0042.json',
        verifiedAt: '2026-10-19T03:06:00.000Z',
      },
    ],
    pins: ["control-plane backups don't survive the loss of the cluster: no external backup target"],
    deletionDelayHours: 48,
    ...overrides,
  };
}

describe('LoadweaverPlatformBackupsPageComponent', () => {
  let fixture: ComponentFixture<LoadweaverPlatformBackupsPageComponent>;
  let service: Record<string, jest.Mock>;

  async function setup(me: AccessMe, cutovers: PlatformCutover[] = [cutover()]) {
    service = {
      platformStatus: jest.fn(() => of(platformStatus())),
      platformCutovers: jest.fn(() => of(cutovers)),
      status: jest.fn(() => of({ keys: { generation: 2, kitConfirmed: true, escrowed: false } })),
      runPlatformBackup: jest.fn(() =>
        of({ kind: 'etcd', status: 'succeeded', backup: 'etcd-1.db', bytes: 10, error: null, deleted: [] }),
      ),
      requestPlatformRestore: jest.fn(() => of(restore({ id: 'r3', state: 'requested' }))),
      discardPlatformRestore: jest.fn(() => of(restore({ state: 'discarded' }))),
      planPlatformCutover: jest.fn(() => of(cutover())),
      actOnPlatformCutover: jest.fn(() => of(cutover())),
      runPlatformCopies: jest.fn(() =>
        of([{ target: 'offsite', status: 'failed', copied: 1, pruned: 0, error: 'bucket not reachable' }]),
      ),
      drInfo: jest.fn(() => of({ format: 'loadweaver-dr-info', version: 1, clusterId: 'prod', targets: [], keys: [] })),
      downloadEtcdSnapshot: jest.fn(() => of(new Blob(['x']))),
    };
    Object.assign(window.URL, { createObjectURL: jest.fn(() => 'blob:x'), revokeObjectURL: jest.fn() });

    await TestBed.configureTestingModule({
      imports: [LoadweaverPlatformBackupsPageComponent],
      providers: [
        provideRouter([]),
        { provide: BackupsService, useValue: service },
        { provide: ConsoleAccessFacade, useValue: accessStub(me) },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LoadweaverPlatformBackupsPageComponent);
    fixture.detectChanges();
    await settle();
  }

  /** Lets the (synchronous) requests' promises resolve; `whenStable` would wait for the poll interval. */
  async function settle() {
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
  }

  const admin: AccessMe = { userId: 'u2', clusterRole: 'cluster-admin', projects: {} };
  const q = (id: string) => document.body.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  const click = (id: string) => (q(id)?.querySelector('button') as HTMLButtonElement).click();

  it('shows pins, kinds with pending retention, the PITR window, restores, copies and the DR state', async () => {
    await setup(admin);

    expect(q('platform-pin')?.textContent).toContain('no external backup target');
    expect(q('platform-kind-postgres')?.textContent).toContain('0 3 * * *');
    expect(q('platform-retention-postgres')?.textContent).toContain('second admin');
    expect(q('platform-retention-postgres')?.querySelector('a')?.getAttribute('href')).toBe('/backups/deletions');
    expect(q('platform-retention-etcd')).toBeNull();
    expect(q('platform-backups-postgres')?.textContent).toContain('offsite');
    expect(q('platform-last-postgres')?.textContent).toContain('base_0001');
    expect(q('platform-window')?.textContent).toContain('loadweaver');
    expect(q('platform-restore-r1')?.textContent).toContain('Ready');
    expect(q('platform-copy-offsite')?.textContent).toContain('3.0 MiB');
    expect(q('platform-verified-offsite')?.textContent).toContain('dr/envelope-0042.json');
    expect(q('platform-dr-kit')?.textContent).toContain('Kit confirmed');
    expect((q('platform-dr-command')?.querySelector('textarea') as HTMLTextAreaElement).value).toContain(
      '--dr-info loadweaver-dr-info-<cluster>.json',
    );
  });

  it('shows the open cut-over with its data-loss warnings, steps and actions', async () => {
    await setup(admin);

    const warnings = q('platform-cutover-warnings-c1');

    expect(warnings?.textContent).toContain('Data written after this point is lost');
    expect(warnings?.textContent).toContain('Data written after 2026-10-19T07:00:00Z is lost');
    expect(warnings?.textContent).toContain('final base backup');
    expect(q('platform-cutover-c1')?.textContent).toContain('Take a final base backup');
    expect(q('platform-approve-c1')).not.toBeNull();
    expect(q('platform-cancel-c1')).not.toBeNull();
    // The restore with an open cut-over can't be planned or discarded again; others can't plan meanwhile.
    expect(q('platform-plan-r1')?.querySelector('button')?.disabled).toBe(true);
  });

  it('backs up a kind now, requests and discards restores and copies now', async () => {
    await setup(admin, []);

    const c = fixture.componentInstance;

    click('platform-run-etcd');
    await settle();
    expect(service['runPlatformBackup']).toHaveBeenCalledWith('etcd');
    expect(q('platform-run-result-etcd')?.textContent).toContain('etcd-1.db');

    c.openRestore();
    c.restoreTargetTime = '2026-10-19T09:30';
    c.restoreNode = ' n2 ';
    await c.requestRestore();
    expect(service['requestPlatformRestore']).toHaveBeenCalledWith({
      targetTime: localDateTimeToIso('2026-10-19T09:30'),
      node: 'n2',
    });
    expect(c.restoreOpen()).toBe(false);
    c.openRestore();
    await c.requestRestore();
    expect(service['requestPlatformRestore']).toHaveBeenLastCalledWith({});

    click('platform-discard-r2');
    fixture.detectChanges();
    // Nothing happens before the confirmation.
    expect(service['discardPlatformRestore']).not.toHaveBeenCalled();
    expect(c.discardFor()?.id).toBe('r2');
    expect(q('platform-discard-warning')?.textContent).toContain('is removed');
    await c.discard();
    expect(service['discardPlatformRestore']).toHaveBeenCalledWith('r2');

    await c.runCopies();
    fixture.detectChanges();
    expect(q('platform-copy-results')?.textContent).toContain('bucket not reachable');
  });

  it('plans a cut-over after a confirmation that repeats the data loss', async () => {
    await setup(admin, []);

    const c = fixture.componentInstance;

    click('platform-plan-r1');
    fixture.detectChanges();
    expect(c.planFor()?.id).toBe('r1');
    expect(q('platform-plan-warning')?.textContent).toContain('is lost');
    await c.plan();
    expect(service['planPlatformCutover']).toHaveBeenCalledWith('r1');
  });

  it('approves and cancels; shows the 403 for the requester', async () => {
    await setup({ userId: 'u1', clusterRole: 'cluster-admin', projects: {} });

    const c = fixture.componentInstance;

    expect(q('platform-cutover-c1')?.textContent).toContain('second cluster admin');
    service['actOnPlatformCutover'].mockReturnValueOnce(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 403,
            error: { statusCode: 403, message: 'a second cluster admin has to approve' },
          }),
      ),
    );
    click('platform-approve-c1');
    fixture.detectChanges();
    expect(q('platform-approve-warning')?.textContent).toContain('Data written after 2026-10-19T07:00:00Z is lost');
    await c.approve();
    fixture.detectChanges();
    expect(service['actOnPlatformCutover']).toHaveBeenCalledWith('c1', 'approve');
    expect(q('platform-action-error')?.textContent).toContain('a second cluster admin has to approve');

    click('platform-cancel-c1');
    fixture.detectChanges();
    expect(service['actOnPlatformCutover']).not.toHaveBeenLastCalledWith('c1', 'cancel');
    expect(q('platform-cancel-warning')?.textContent).toContain('keeps its current database');
    await c.cancelCutover();
    expect(service['actOnPlatformCutover']).toHaveBeenLastCalledWith('c1', 'cancel');
  });

  it('downloads the DR info and fills the cluster into the restore command', async () => {
    await setup(admin);

    const anchorClick = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    await fixture.componentInstance.downloadDrInfo();
    fixture.detectChanges();
    expect(service['drInfo']).toHaveBeenCalled();
    expect(anchorClick).toHaveBeenCalled();
    expect((q('platform-dr-command')?.querySelector('textarea') as HTMLTextAreaElement).value).toContain(
      '--dr-info loadweaver-dr-info-prod.json',
    );
    anchorClick.mockRestore();
  });

  it('is read-only for other cluster roles', async () => {
    await setup({ userId: 'u3', clusterRole: 'auditor', projects: {} });

    expect(q('platform-kind-postgres')).not.toBeNull();
    expect(q('platform-run-postgres')).toBeNull();
    expect(q('platform-restore-open')).toBeNull();
    expect(q('platform-plan-r1')).toBeNull();
    expect(q('platform-approve-c1')).toBeNull();
    expect(q('platform-copies-run')).toBeNull();
    expect(q('platform-dr-info')).not.toBeNull();
  });

  it('is routed before the backup detail route', () => {
    const paths: string[] = [];
    const walk = (routes: Route[]) =>
      routes.forEach((r) => {
        if (r.path !== undefined) paths.push(r.path);

        if (r.children) walk(r.children);
      });

    walk(loadweaverConsoleRoutes);
    expect(paths).toContain('backups/platform');
    expect(paths.indexOf('backups/platform')).toBeLessThan(paths.indexOf('backups/:id'));
  });
});

describe('localDateTimeToIso', () => {
  it('keeps the local wall time and adds the offset', () => {
    const iso = localDateTimeToIso('2026-10-19T09:30');

    expect(iso).toMatch(/^2026-10-19T09:30:00[+-]\d{2}:\d{2}$/);
    expect(new Date(iso as string).getTime()).toBe(new Date('2026-10-19T09:30').getTime());
    expect(localDateTimeToIso('')).toBeNull();
    expect(localDateTimeToIso('nope')).toBeNull();
  });
});
