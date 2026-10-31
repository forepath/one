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

  /** Switches the page tab (decision 4: one table at a time). */
  function show(tab: 'kinds' | 'restores' | 'cutovers' | 'copies' | 'dr'): void {
    fixture.componentInstance.tab.set(tab);
    fixture.detectChanges();
  }

  /** Opens a kind's row detail (its backups, pending retention, last run result). */
  function openKind(kind: string): void {
    const c = fixture.componentInstance;

    c.toggleKind(c.kinds().find((k) => k.kind === kind)!);
    fixture.detectChanges();
  }

  const kind = (name: string) => fixture.componentInstance.kinds().find((k) => k.kind === name)!;
  const restoreOf = (id: string) => fixture.componentInstance.restores().find((r) => r.id === id)!;
  const cutoverOf = (id: string) => fixture.componentInstance.cutovers().find((c) => c.id === id)!;
  const ids = (items: { id: string; disabled?: boolean }[]) => items.map((i) => i.id);

  it('shows pins, kinds with pending retention, the PITR window, restores, copies and the DR state', async () => {
    await setup(admin);

    expect(q('platform-pin')?.textContent).toContain('no external backup target');
    expect(q('platform-kinds')?.textContent).toContain('0 3 * * *');
    expect(q('platform-kinds')?.textContent).toContain('base_0001');
    expect(
      q('platform-kinds')?.querySelector('fpc-badge[aria-label="Shorter retention waits for approval"]'),
    ).not.toBeNull();
    openKind('postgres');
    expect(q('platform-retention-postgres')?.textContent).toContain('second admin');
    expect(q('platform-retention-postgres')?.querySelector('a')?.getAttribute('href')).toBe(
      '/operate/backups/deletions',
    );
    expect(q('platform-backups-postgres')?.textContent).toContain('offsite');
    openKind('etcd');
    expect(q('platform-retention-etcd')).toBeNull();

    show('restores');
    expect(q('platform-window')?.textContent).toContain('loadweaver');
    expect(
      [...(q('platform-restores')?.querySelectorAll('[data-testid="fpc-data-table-state"]') ?? [])].map((e) =>
        e.getAttribute('aria-label'),
      ),
    ).toContain('Ready');

    show('copies');
    expect(q('platform-copies')?.textContent).toContain('3.0 MiB');
    expect(q('platform-verified-offsite')?.textContent).toContain('dr/envelope-0042.json');

    show('dr');
    expect(q('platform-dr-kit')?.textContent).toContain('Kit confirmed');
    expect((q('platform-dr-command')?.querySelector('textarea') as HTMLTextAreaElement).value).toContain(
      '--dr-info loadweaver-dr-info-<cluster>.json',
    );
  });

  it('puts the time zone in the header context, tabs with one table each, states as icon badges', async () => {
    await setup(admin);

    expect(q('platform-time-zone')?.closest('fpc-page-header')).not.toBeNull();
    expect(q('platform-tabs')).not.toBeNull();
    expect(q('platform-kinds')?.querySelector('[data-testid="fpc-data-table-state"]')).not.toBeNull();
    expect(q('platform-restores')).toBeNull();
    expect(document.body.querySelector('fpc-status-badge')).toBeNull();
    expect(document.body.querySelector('h3.h6')).toBeNull();
  });

  it('shows the open cut-over with its data-loss warnings, steps and actions', async () => {
    await setup(admin);

    const c = fixture.componentInstance;

    show('cutovers');
    // The open cut-over opens itself.
    const warnings = q('platform-cutover-warnings-c1');

    expect(warnings?.textContent).toContain('Data written after this point is lost');
    expect(warnings?.textContent).toContain('Data written after 2026-10-19T07:00:00Z is lost');
    expect(warnings?.textContent).toContain('final base backup');
    expect(q('platform-cutover-c1')?.textContent).toContain('Take a final base backup');
    expect(ids(c.cutoverMenu(cutoverOf('c1')))).toEqual(['cancel', 'approve', 'copy-id']);
    // No other restore can be planned while a cut-over is open.
    expect(c.restoreMenu(restoreOf('r1')).find((i) => i.id === 'plan')?.disabled).toBe(true);
  });

  it('backs up a kind now, requests and discards restores and copies now', async () => {
    await setup(admin, []);

    const c = fixture.componentInstance;

    c.onKindAction(kind('etcd'), 'run');
    await settle();
    expect(service['runPlatformBackup']).toHaveBeenCalledWith('etcd');
    openKind('etcd');
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

    expect(c.restoreMenu(restoreOf('r2')).find((i) => i.id === 'discard')?.danger).toBe(true);
    c.onRestoreAction(restoreOf('r2'), 'discard');
    fixture.detectChanges();
    // Nothing happens before the confirmation.
    expect(service['discardPlatformRestore']).not.toHaveBeenCalled();
    expect(c.discardFor()?.id).toBe('r2');
    expect(q('platform-discard-warning')?.textContent).toContain('is removed');
    await c.discard();
    expect(service['discardPlatformRestore']).toHaveBeenCalledWith('r2');

    show('copies');
    await c.runCopies();
    fixture.detectChanges();
    expect(q('platform-copy-results')?.textContent).toContain('bucket not reachable');
  });

  it('bulk: backs up the selected kinds and discards the selected restores, per-item results', async () => {
    await setup(admin, []);

    const c = fixture.componentInstance;

    c.selectedKinds.set(['postgres', 'etcd']);
    expect(c.canRunSelection()).toBe(true);
    await c.runSelected();
    expect(service['runPlatformBackup']).toHaveBeenCalledWith('postgres');
    expect(service['runPlatformBackup']).toHaveBeenCalledWith('etcd');
    expect(c.bulkResult()?.tone).toBe('success');

    service['discardPlatformRestore'].mockReturnValueOnce(throwError(() => ({ status: 403 })));
    c.selectedRestores.set(['r2']);
    expect(c.canDiscardSelection()).toBe(true);
    await c.discardSelected();
    expect(service['discardPlatformRestore']).toHaveBeenCalledWith('r2');
    expect(c.bulkResult()?.message).toContain('not allowed');
  });

  it('plans a cut-over after a confirmation that repeats the data loss', async () => {
    await setup(admin, []);

    const c = fixture.componentInstance;

    expect(c.restoreMenu(restoreOf('r1')).find((i) => i.id === 'plan')?.disabled).toBe(false);
    c.onRestoreAction(restoreOf('r1'), 'plan');
    fixture.detectChanges();
    expect(c.planFor()?.id).toBe('r1');
    expect(q('platform-plan-warning')?.textContent).toContain('is lost');
    await c.plan();
    expect(service['planPlatformCutover']).toHaveBeenCalledWith('r1');
  });

  it('approves and cancels; shows the 403 for the requester', async () => {
    await setup({ userId: 'u1', clusterRole: 'cluster-admin', projects: {} });

    const c = fixture.componentInstance;

    show('cutovers');
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
    c.onCutoverAction(cutoverOf('c1'), 'approve');
    fixture.detectChanges();
    expect(q('platform-approve-warning')?.textContent).toContain('Data written after 2026-10-19T07:00:00Z is lost');
    await c.approve();
    fixture.detectChanges();
    expect(service['actOnPlatformCutover']).toHaveBeenCalledWith('c1', 'approve');
    expect(q('platform-action-error')?.textContent).toContain('a second cluster admin has to approve');

    c.onCutoverAction(cutoverOf('c1'), 'cancel');
    fixture.detectChanges();
    expect(service['actOnPlatformCutover']).not.toHaveBeenLastCalledWith('c1', 'cancel');
    expect(q('platform-cancel-warning')?.textContent).toContain('keeps its current database');
    await c.cancelCutover();
    expect(service['actOnPlatformCutover']).toHaveBeenLastCalledWith('c1', 'cancel');
  });

  it('downloads the DR info and fills the cluster into the restore command', async () => {
    await setup(admin);

    const anchorClick = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    show('dr');
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

    const c = fixture.componentInstance;

    expect(q('platform-kinds')).not.toBeNull();
    expect(c.kindMenu(kind('postgres'))).toEqual([]);
    expect(ids(c.restoreMenu(restoreOf('r1')))).toEqual(['copy-id']);
    expect(ids(c.cutoverMenu(cutoverOf('c1')))).toEqual(['copy-id']);
    show('restores');
    expect(q('platform-restore-open')).toBeNull();
    show('copies');
    expect(q('platform-copies-run')).toBeNull();
    show('dr');
    expect(q('platform-dr-info')).not.toBeNull();
  });

  it('is routed before the backups master-detail shell (its `:id` child)', () => {
    const paths: string[] = [];
    const walk = (routes: Route[]) =>
      routes.forEach((r) => {
        if (r.path !== undefined) paths.push(r.path);

        if (r.children) walk(r.children);
      });

    walk(loadweaverConsoleRoutes);
    expect(paths).toContain('backups/platform');
    expect(paths.indexOf('backups/platform')).toBeLessThan(paths.indexOf('backups'));
    expect(paths.indexOf('backups')).toBeLessThan(paths.indexOf(':id', paths.indexOf('backups')));
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
