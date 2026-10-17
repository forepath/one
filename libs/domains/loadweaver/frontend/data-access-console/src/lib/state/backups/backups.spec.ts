import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { Store } from '@ngrx/store';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { parse } from 'yaml';
import { firstValueFrom, of, throwError, toArray } from 'rxjs';

import { BackupsService } from '../../services/backups.service';
import { PlansService } from '../../services/plans.service';
import type { Backup, BackupDeletion, BackupsStatus, RestoreTest } from '../../types/backups.types';
import type { Plan } from '../../types/plans.types';
import {
  backupDeletionAction,
  backupDeletionActionFailure,
  backupDeletionActionSuccess,
  backupNow,
  backupNowFailure,
  backupNowSuccess,
  loadBackup,
  loadBackupDiff,
  loadBackupDiffSuccess,
  loadBackupFiles,
  loadBackupFilesSuccess,
  loadBackups,
  loadBackupsFailure,
  loadBackupsSuccess,
  loadBackupSuccess,
  loadRestores,
  loadRestoresSuccess,
  planRestore,
  planRestoreFailure,
  planRestoreSuccess,
  requestBackupDeletion,
  requestBackupDeletionFailure,
  requestBackupDeletionSuccess,
  startRestoreTest,
  startRestoreTestSuccess,
} from './backups.actions';
import {
  backupDeletionActions$,
  backupNow$,
  loadBackup$,
  loadBackupDiff$,
  loadBackups$,
  loadRestores$,
  openRestorePlan$,
  planRestore$,
  reloadBackupsAfterChange$,
} from './backups.effects';
import { ConsoleBackupsFacade } from './backups.facade';
import { consoleBackupsReducer, initialConsoleBackupsState } from './backups.reducer';
import {
  backupTimeline,
  backupVolumes,
  selectBackupsBusy,
  selectOpenDeletions,
  selectRestoresBusy,
} from './backups.selectors';

function backup(overrides: Partial<Backup> = {}): Backup {
  return {
    id: 'b1',
    scope: 'project-shop',
    project: 'shop',
    resource: 'shop/web/data',
    policy: 'nightly',
    node: 'n1',
    status: 'succeeded',
    snapshotId: 'k1',
    keyGeneration: 1,
    bytes: 1000,
    uploadedBytes: 100,
    files: 10,
    targets: [{ target: 'garage', copiedAt: '2026-10-01T10:00:00.000Z', lockedUntil: null }],
    keep: ['latest'],
    hooks: true,
    encrypted: true,
    lockedUntil: null,
    error: null,
    startedAt: '2026-10-01T10:00:00.000Z',
    finishedAt: '2026-10-01T10:01:00.000Z',
    deletedAt: null,
    restoreTest: null,
    ...overrides,
  };
}

function deletion(overrides: Partial<BackupDeletion> = {}): BackupDeletion {
  return {
    id: 'd1',
    kind: 'backups',
    scope: 'project-shop',
    backupIds: ['b1'],
    retention: null,
    reason: 'GDPR',
    state: 'pending',
    requestedBy: 'u1',
    approvedBy: null,
    approvedAt: null,
    notBefore: '2026-10-04T10:00:00.000Z',
    executedAt: null,
    createdAt: '2026-10-01T10:00:00.000Z',
    ...overrides,
  };
}

function test(overrides: Partial<RestoreTest> = {}): RestoreTest {
  return {
    id: 't1',
    backupId: 'b1',
    project: 'shop',
    resource: 'shop/web/data',
    node: 'n1',
    status: 'running',
    keyGeneration: 1,
    check: null,
    error: null,
    startedAt: '2026-10-02T10:00:00.000Z',
    finishedAt: null,
    ...overrides,
  };
}

const status: BackupsStatus = {
  keys: { generation: 1, kitConfirmed: false, escrowed: false },
  pins: ['backups not recoverable'],
  repositories: [],
  targets: [],
  usage: [{ project: 'shop', bytes: 1000, uploadedBytes: 100, backups: 1 }],
  deletionDelayHours: 72,
};

const loaded = (overrides: Partial<Parameters<typeof loadBackupsSuccess>[0]> = {}) =>
  loadBackupsSuccess({ status, backups: [backup()], deletions: [deletion()], ...overrides });

describe('console backups state', () => {
  it('loads the catalog per project and keeps deletions when they fail alone', () => {
    const first = consoleBackupsReducer(initialConsoleBackupsState, loadBackups({ project: null }));
    const done = consoleBackupsReducer(first, loaded());
    const again = consoleBackupsReducer(done, loaded({ deletions: null }));
    const other = consoleBackupsReducer(done, loadBackups({ project: 'blog' }));
    const silent = consoleBackupsReducer(done, loadBackups({ project: null, silent: true }));

    expect(first).toMatchObject({ project: null, loading: true });
    expect(done).toMatchObject({ loaded: true, loading: false, status });
    expect(again.deletions).toHaveLength(1);
    expect(other.backups).toEqual([]);
    expect(silent).toMatchObject({ loading: false, backups: done.backups });
    expect(consoleBackupsReducer(first, loadBackupsFailure({ error: 'no access' }))).toMatchObject({
      loading: false,
      error: 'no access',
    });
  });

  it('groups backups by volume, newest first, with a timeline oldest first', () => {
    const volumes = backupVolumes([
      backup({ id: 'b1', startedAt: '2026-10-01T10:00:00.000Z', bytes: 1000 }),
      backup({ id: 'b2', startedAt: '2026-10-02T10:00:00.000Z', status: 'failed', bytes: 0, uploadedBytes: 0 }),
      backup({ id: 'b3', resource: 'shop/db/pg', startedAt: '2026-10-02T10:00:00.000Z', status: 'running' }),
      backup({ id: 'b4', startedAt: '2026-09-30T10:00:00.000Z', deletedAt: '2026-10-01T00:00:00.000Z' }),
    ]);

    expect(volumes.map((v) => [v.resource, v.deployment, v.volume, v.backups.map((b) => b.id)])).toEqual([
      ['shop/db/pg', 'db', 'pg', ['b3']],
      ['shop/web/data', 'web', 'data', ['b2', 'b1', 'b4']],
    ]);
    expect(volumes[0].running).toBe(true);
    expect(volumes[1]).toMatchObject({ running: false, storedBytes: 100 });
    expect(volumes[1].latest?.id).toBe('b2');
    expect(volumes[1].lastSucceeded?.id).toBe('b1');
    expect(backupTimeline(volumes[1].backups).map((p) => [p.backup.id, p.height])).toEqual([
      ['b4', 100],
      ['b1', 100],
      ['b2', 8],
    ]);
  });

  it('is busy while backups or restore tests run', () => {
    const idle = consoleBackupsReducer(initialConsoleBackupsState, loaded());
    const running = consoleBackupsReducer(idle, loaded({ backups: [backup({ status: 'running' })] }));
    const testing = consoleBackupsReducer(idle, startRestoreTest({ id: 'b1' }));

    expect(selectBackupsBusy({ consoleBackups: idle })).toBe(false);
    expect(selectBackupsBusy({ consoleBackups: running })).toBe(true);
    expect(selectBackupsBusy({ consoleBackups: testing })).toBe(true);
    expect(selectOpenDeletions({ consoleBackups: idle }).map((d) => d.id)).toEqual(['d1']);
  });

  it('tracks back up now and restore tests', () => {
    const listed = consoleBackupsReducer(initialConsoleBackupsState, loaded());
    const started = consoleBackupsReducer(listed, backupNow({ volume: 'shop/web/data' }));
    const done = consoleBackupsReducer(started, backupNowSuccess({ backup: backup({ id: 'b9', status: 'running' }) }));
    const failed = consoleBackupsReducer(started, backupNowFailure({ volume: 'shop/web/data', error: 'running' }));
    const tested = consoleBackupsReducer(
      consoleBackupsReducer(listed, startRestoreTest({ id: 'b1' })),
      startRestoreTestSuccess({ test: test() }),
    );

    expect(started.backingUp).toEqual(['shop/web/data']);
    expect(done.backingUp).toEqual([]);
    expect(done.backups.map((b) => b.id)).toEqual(['b9', 'b1']);
    expect(failed).toMatchObject({ backingUp: [], actionError: 'running' });
    expect(tested.testing).toEqual([]);
    expect(tested.backups[0].restoreTest).toEqual({ id: 't1', status: 'running', finishedAt: null });
    expect(tested.restoreTests.map((t) => t.id)).toEqual(['t1']);
  });

  it('opens a backup with its volume, browses and compares', () => {
    const listed = consoleBackupsReducer(initialConsoleBackupsState, loaded());
    const opened = consoleBackupsReducer(listed, loadBackup({ id: 'b1' }));
    const done = consoleBackupsReducer(
      opened,
      loadBackupSuccess({ backup: backup({ files: 11 }), volumeBackups: [backup(), backup({ id: 'b0' })] }),
    );
    const browsing = consoleBackupsReducer(done, loadBackupFiles({ id: 'b1', path: 'uploads' }));
    const listedFiles = consoleBackupsReducer(
      browsing,
      loadBackupFilesSuccess({
        id: 'b1',
        path: 'uploads',
        entries: [{ name: 'a.txt', directory: false, mode: '-rw-r--r--', size: 3, modified: 'x', object: 'o' }],
      }),
    );
    const stale = consoleBackupsReducer(
      consoleBackupsReducer(listedFiles, loadBackupFiles({ id: 'b1', path: '' })),
      loadBackupFilesSuccess({ id: 'b1', path: 'uploads', entries: [] }),
    );
    const comparing = consoleBackupsReducer(done, loadBackupDiff({ from: 'b0', to: 'b1' }));
    const compared = consoleBackupsReducer(
      comparing,
      loadBackupDiffSuccess({
        from: backup({ id: 'b0' }),
        to: backup(),
        diff: { added: [], removed: [], changed: [], stats: null },
      }),
    );

    expect(opened).toMatchObject({ selectedId: 'b1', selectedLoading: true, selected: { id: 'b1' } });
    expect(done.selected?.files).toBe(11);
    expect(done.volumeBackups).toHaveLength(2);
    expect(listedFiles.files).toMatchObject({ path: 'uploads', loading: false });
    expect(listedFiles.files?.entries).toHaveLength(1);
    expect(stale.files).toMatchObject({ path: '', loading: true, entries: [] });
    expect(comparing.diff).toMatchObject({ from: 'b0', to: 'b1', loading: true });
    expect(compared.diff?.result?.from.id).toBe('b0');
  });

  it('tracks deletion requests and approvals', () => {
    const listed = consoleBackupsReducer(initialConsoleBackupsState, loaded({ deletions: [] }));
    const requesting = consoleBackupsReducer(listed, requestBackupDeletion({ backupIds: ['b1'], reason: 'GDPR' }));
    const requested = consoleBackupsReducer(requesting, requestBackupDeletionSuccess({ deletion: deletion() }));
    const refused = consoleBackupsReducer(requesting, requestBackupDeletionFailure({ error: 'only admins' }));
    const approving = consoleBackupsReducer(requested, backupDeletionAction({ id: 'd1', action: 'approve' }));
    const approved = consoleBackupsReducer(
      approving,
      backupDeletionActionSuccess({ action: 'approve', deletion: deletion({ state: 'approved', approvedBy: 'u2' }) }),
    );
    const own = consoleBackupsReducer(
      approving,
      backupDeletionActionFailure({ id: 'd1', action: 'approve', error: 'a second admin must approve' }),
    );

    expect(requesting.requestingDeletion).toBe(true);
    expect(requested).toMatchObject({ requestingDeletion: false, requestedDeletion: { id: 'd1' } });
    expect(requested.deletions).toHaveLength(1);
    expect(refused.deletionRequestError).toBe('only admins');
    expect(approving.deletionActing).toEqual({ id: 'd1', action: 'approve' });
    expect(approved.deletions?.[0]).toMatchObject({ state: 'approved', approvedBy: 'u2' });
    expect(own).toMatchObject({ deletionActing: null, deletionActionError: 'a second admin must approve' });
  });

  it('tracks restores and the restore plan', () => {
    const loadedRestores = consoleBackupsReducer(
      initialConsoleBackupsState,
      loadRestoresSuccess({
        restores: [
          {
            id: 'r1',
            project: 'shop',
            name: 'restore-x',
            generation: 1,
            backupId: 'b1',
            volume: 'shop/web/data',
            kind: 'volume',
            status: 'running',
            node: 'n1',
            progress: { phase: 'restoring', bytes: 10, files: 1 },
            error: null,
            startedAt: null,
            finishedAt: null,
          },
        ],
        tests: null,
      }),
    );
    const planning = consoleBackupsReducer(
      initialConsoleBackupsState,
      planRestore({
        request: { backup: { id: 'b1', project: 'shop' }, deployment: 'web', volume: 'data', mode: 'replace' },
      }),
    );

    expect(selectRestoresBusy({ consoleBackups: loadedRestores })).toBe(true);
    expect(loadedRestores.restoresLoaded).toBe(true);
    expect(planning.planningRestore).toBe(true);
    expect(consoleBackupsReducer(planning, planRestoreFailure({ error: 'invalid' }))).toMatchObject({
      planningRestore: false,
      restorePlanError: 'invalid',
    });
  });
});

describe('console backups effects', () => {
  it('loads status, catalog and deletions; deletions may fail alone', async () => {
    const service = {
      status: jest.fn().mockReturnValue(of(status)),
      catalog: jest.fn().mockReturnValue(of([backup()])),
      deletions: jest.fn().mockReturnValue(throwError(() => new Error('forbidden'))),
    };

    TestBed.configureTestingModule({ providers: [provideMockActions(() => of(loadBackups({ project: 'shop' })))] });

    expect(await firstValueFrom(loadBackups$(TestBed.inject(Actions), service as unknown as BackupsService))).toEqual(
      loadBackupsSuccess({ status, backups: [backup()], deletions: null }),
    );
    expect(service.catalog).toHaveBeenCalledWith({ project: 'shop', limit: 1000 });
  });

  it('reports a failing catalog', async () => {
    const service = {
      status: jest.fn().mockReturnValue(of(status)),
      catalog: jest
        .fn()
        .mockReturnValue(
          throwError(() => new HttpErrorResponse({ status: 404, error: { message: 'project not found' } })),
        ),
      deletions: jest.fn().mockReturnValue(of([])),
    };

    TestBed.configureTestingModule({ providers: [provideMockActions(() => of(loadBackups({ project: 'x' })))] });

    expect(await firstValueFrom(loadBackups$(TestBed.inject(Actions), service as unknown as BackupsService))).toEqual(
      loadBackupsFailure({ error: 'project not found' }),
    );
  });

  it('opens a backup with the other backups of its volume', async () => {
    const service = {
      get: jest.fn().mockReturnValue(of(backup())),
      catalog: jest.fn().mockReturnValue(throwError(() => new Error('down'))),
    };

    TestBed.configureTestingModule({ providers: [provideMockActions(() => of(loadBackup({ id: 'b1' })))] });

    expect(await firstValueFrom(loadBackup$(TestBed.inject(Actions), service as unknown as BackupsService))).toEqual(
      loadBackupSuccess({ backup: backup(), volumeBackups: [backup()] }),
    );
    expect(service.catalog).toHaveBeenCalledWith({ resource: 'shop/web/data', project: 'shop', limit: 1000 });
  });

  it('compares two backups and loads restores', async () => {
    const diff = { added: [{ path: 'a', size: 1, directory: false }], removed: [], changed: [], stats: null };
    const service = {
      get: jest.fn((id: string) => of(backup({ id }))),
      diff: jest.fn().mockReturnValue(of(diff)),
      restores: jest.fn().mockReturnValue(of([])),
      restoreTests: jest.fn().mockReturnValue(of([test()])),
    };

    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() => of(loadBackupDiff({ from: 'b0', to: 'b1' }), loadRestores({ project: 'shop' }))),
      ],
    });

    expect(
      await firstValueFrom(loadBackupDiff$(TestBed.inject(Actions), service as unknown as BackupsService)),
    ).toEqual(loadBackupDiffSuccess({ from: backup({ id: 'b0' }), to: backup({ id: 'b1' }), diff }));
    expect(await firstValueFrom(loadRestores$(TestBed.inject(Actions), service as unknown as BackupsService))).toEqual(
      loadRestoresSuccess({ restores: [], tests: [test()] }),
    );
    expect(service.restores).toHaveBeenCalledWith('shop');
  });

  it('starts backups and reports conflicts', async () => {
    const service = {
      backupNow: jest
        .fn()
        .mockReturnValueOnce(of(backup({ status: 'running' })))
        .mockReturnValueOnce(
          throwError(
            () => new HttpErrorResponse({ status: 409, error: { message: 'a backup of this volume is running' } }),
          ),
        ),
    };

    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() => of(backupNow({ volume: 'shop/web/data' }), backupNow({ volume: 'shop/web/data' }))),
      ],
    });

    expect(
      await firstValueFrom(backupNow$(TestBed.inject(Actions), service as unknown as BackupsService).pipe(toArray())),
    ).toEqual([
      backupNowSuccess({ backup: backup({ status: 'running' }) }),
      backupNowFailure({ volume: 'shop/web/data', error: 'a backup of this volume is running' }),
    ]);
  });

  it('shows why an approval was refused', async () => {
    const service = {
      actOnDeletion: jest.fn().mockReturnValue(
        throwError(
          () =>
            new HttpErrorResponse({
              status: 403,
              error: { message: 'the requester cannot approve their own request' },
            }),
        ),
      ),
    };

    TestBed.configureTestingModule({
      providers: [provideMockActions(() => of(backupDeletionAction({ id: 'd1', action: 'approve' })))],
    });

    expect(
      await firstValueFrom(backupDeletionActions$(TestBed.inject(Actions), service as unknown as BackupsService)),
    ).toEqual(
      backupDeletionActionFailure({
        id: 'd1',
        action: 'approve',
        error: 'the requester cannot approve their own request',
      }),
    );
  });

  it('reloads the shown catalog after changes', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideMockStore({ initialState: { consoleBackups: { ...initialConsoleBackupsState, project: 'shop' } } }),
        provideMockActions(() =>
          of(backupNowSuccess({ backup: backup() }), requestBackupDeletionSuccess({ deletion: deletion() })),
        ),
      ],
    });

    expect(
      await firstValueFrom(
        reloadBackupsAfterChange$(TestBed.inject(Actions), TestBed.inject(MockStore) as Store).pipe(toArray()),
      ),
    ).toEqual([loadBackups({ project: 'shop', silent: true }), loadBackups({ project: 'shop', silent: true })]);
  });

  it('plans a restore as a Restore resource and opens the plan', async () => {
    const plans = { create: jest.fn().mockReturnValue(of({ id: 'p1' } as Plan)) };
    const router = { navigate: jest.fn().mockResolvedValue(true) };

    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() =>
          of(
            planRestore({
              request: {
                backup: { id: '6f0c1b0e-0000-4000-8000-000000000001', project: 'shop' },
                deployment: 'web',
                volume: 'data',
                mode: 'merge',
                path: 'uploads/a.txt',
                overwrite: true,
              },
            }),
          ),
        ),
      ],
    });

    const result = await firstValueFrom(planRestore$(TestBed.inject(Actions), plans as unknown as PlansService));
    const doc = parse(plans.create.mock.calls[0][0].documents);

    expect(result).toEqual(planRestoreSuccess({ plan: { id: 'p1' } as Plan }));
    expect(doc).toMatchObject({
      kind: 'Restore',
      metadata: { project: 'shop' },
      spec: {
        backup: '6f0c1b0e-0000-4000-8000-000000000001',
        target: { deployment: 'web', volume: 'data', mode: 'merge', path: 'uploads/a.txt', overwrite: true },
      },
    });
    await firstValueFrom(
      openRestorePlan$(
        new Actions(of(planRestoreSuccess({ plan: { id: 'p1' } as Plan }))),
        router as unknown as Router,
      ).pipe(toArray()),
    );
    expect(router.navigate).toHaveBeenCalledWith(['/plans', 'p1']);
  });
});

describe('ConsoleBackupsFacade', () => {
  it('dispatches the backups actions', () => {
    TestBed.configureTestingModule({ providers: [provideMockStore(), ConsoleBackupsFacade] });

    const store = TestBed.inject(MockStore);
    const dispatch = jest.spyOn(store, 'dispatch');
    const facade = TestBed.inject(ConsoleBackupsFacade);

    facade.load('shop', true);
    facade.open('b1');
    facade.browse('b1', 'uploads');
    facade.compare('b0', 'b1');
    facade.backupNow('shop/web/data');
    facade.testNow('b1');
    facade.requestDeletion(['b1'], 'GDPR');
    facade.actOnDeletion('d1', 'cancel');

    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      loadBackups({ project: 'shop', silent: true }),
      loadBackup({ id: 'b1', silent: false }),
      loadBackupFiles({ id: 'b1', path: 'uploads' }),
      loadBackupDiff({ from: 'b0', to: 'b1' }),
      backupNow({ volume: 'shop/web/data' }),
      startRestoreTest({ id: 'b1' }),
      requestBackupDeletion({ backupIds: ['b1'], reason: 'GDPR' }),
      backupDeletionAction({ id: 'd1', action: 'cancel' }),
    ]);
  });
});
