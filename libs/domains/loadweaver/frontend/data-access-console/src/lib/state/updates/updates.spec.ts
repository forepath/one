import { HttpErrorResponse, HttpEventType, HttpResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { firstValueFrom, of, Subject, throwError, toArray } from 'rxjs';

import { ResourcesService } from '../../services/resources.service';
import { UpdatesService } from '../../services/updates.service';
import type { Rollout, UpdateRelease, UpdatesStatus } from '../../types/updates.types';
import {
  cancelBundleUpload,
  createRolloutSuccess,
  downloadRelease,
  downloadReleaseSuccess,
  loadRollout,
  loadUpdates,
  loadUpdatesSuccess,
  rolloutAction,
  rolloutActionFailure,
  rolloutActionSuccess,
  uploadBundle,
  uploadBundleFailure,
  uploadBundleProgress,
  uploadBundleSuccess,
} from './updates.actions';
import {
  loadUpdates$,
  openCreatedRollout$,
  reloadUpdatesAfterChange$,
  rolloutActions$,
  uploadBundle$,
} from './updates.effects';
import { consoleUpdatesReducer, initialConsoleUpdatesState } from './updates.reducer';
import { rolloutWaves, selectPlannableReleases, selectReleasesByChannel, selectUpdatesBusy } from './updates.selectors';

function testRelease(overrides: Partial<UpdateRelease> = {}): UpdateRelease {
  return {
    version: '1.2.0',
    channel: 'stable',
    status: 'available',
    source: 'github',
    signed: true,
    keyId: 'k1',
    notes: [],
    components: [],
    clusterImages: [],
    announcement: null,
    error: null,
    importedAt: null,
    importedBy: null,
    ...overrides,
  };
}

function rollout(overrides: Partial<Rollout> = {}): Rollout {
  return {
    id: 'r1',
    status: 'planned',
    kind: 'minor',
    fromVersion: '1.1.0',
    toVersion: '1.2.0',
    options: { windows: 'respect', host: false, osUpgrade: false, automatic: false, emergency: false },
    diff: [],
    notes: [],
    warnings: [],
    failureAnalysis: [],
    createdBy: 'u1',
    approvedBy: null,
    approvedAt: null,
    pauseReason: null,
    startedAt: null,
    finishedAt: null,
    createdAt: '2026-10-01T10:00:00.000Z',
    progress: { done: 0, total: 2, currentWave: null },
    steps: [],
    ...overrides,
  };
}

const status: UpdatesStatus = {
  clusterVersion: '1.1.0',
  controlPlaneVersion: '1.1.0',
  policy: {
    policy: 'auto-patch',
    channel: 'stable',
    source: 'github',
    osUpdates: true,
    settleSeconds: 60,
    stepTimeoutMinutes: 30,
  },
  activeRollout: null,
  latestAvailable: '1.2.0',
  nodes: [],
  contractMigrations: { ready: true, blockers: [] },
};

const loaded = (overrides: Partial<Parameters<typeof loadUpdatesSuccess>[0]> = {}) =>
  loadUpdatesSuccess({
    status,
    releases: [testRelease()],
    rollouts: [rollout()],
    windows: [],
    clusterResource: 'cluster',
    ...overrides,
  });

describe('console updates state', () => {
  it('groups releases per channel and offers imported ones for plans', () => {
    const state = consoleUpdatesReducer(
      initialConsoleUpdatesState,
      loaded({
        releases: [
          testRelease({ version: '1.3.0-beta.1', channel: 'beta' }),
          testRelease({ version: '1.2.1', status: 'announced' }),
          testRelease(),
        ],
      }),
    );
    const root = { consoleUpdates: state };

    expect(selectReleasesByChannel(root).stable.map((r) => r.version)).toEqual(['1.2.1', '1.2.0']);
    expect(selectReleasesByChannel(root).beta.map((r) => r.version)).toEqual(['1.3.0-beta.1']);
    expect(selectPlannableReleases(root).map((r) => r.version)).toEqual(['1.3.0-beta.1', '1.2.0']);
    expect(selectUpdatesBusy(root)).toBe(false);
  });

  it('is busy while a rollout runs or a bundle imports', () => {
    const running = consoleUpdatesReducer(
      initialConsoleUpdatesState,
      loaded({ rollouts: [rollout({ status: 'running' })] }),
    );
    const importing = consoleUpdatesReducer(
      initialConsoleUpdatesState,
      loaded({ releases: [testRelease({ status: 'importing' })], rollouts: [] }),
    );

    expect(selectUpdatesBusy({ consoleUpdates: running })).toBe(true);
    expect(selectUpdatesBusy({ consoleUpdates: importing })).toBe(true);
  });

  it('keeps windows and the cluster resource when they fail alone', () => {
    const first = consoleUpdatesReducer(initialConsoleUpdatesState, loaded());
    const again = consoleUpdatesReducer(first, loaded({ windows: null, clusterResource: null }));

    expect(again.windows).toEqual([]);
    expect(again.clusterResource).toBe('cluster');
  });

  it('marks a requested download as importing until the list has it', () => {
    const listed = consoleUpdatesReducer(
      initialConsoleUpdatesState,
      loaded({ releases: [testRelease({ status: 'announced' })] }),
    );
    const requested = consoleUpdatesReducer(listed, downloadRelease({ version: '1.2.0' }));
    const accepted = consoleUpdatesReducer(requested, downloadReleaseSuccess({ version: '1.2.0' }));
    const reloaded = consoleUpdatesReducer(accepted, loaded({ releases: [testRelease({ status: 'importing' })] }));

    expect(requested.downloading).toEqual(['1.2.0']);
    expect(accepted.releases[0].status).toBe('importing');
    expect(reloaded.downloading).toEqual([]);
  });

  it('tracks bundle uploads', () => {
    const file = new File(['x'.repeat(10)], 'bundle.tar');
    const started = consoleUpdatesReducer(initialConsoleUpdatesState, uploadBundle({ file }));
    const progressed = consoleUpdatesReducer(started, uploadBundleProgress({ loaded: 5, total: 10 }));
    const done = consoleUpdatesReducer(progressed, uploadBundleSuccess({ release: testRelease({ source: 'upload' }) }));
    const failed = consoleUpdatesReducer(progressed, uploadBundleFailure({ error: 'signature invalid' }));

    expect(started.upload).toEqual({ fileName: 'bundle.tar', loaded: 0, total: 10 });
    expect(progressed.upload?.loaded).toBe(5);
    expect(done).toMatchObject({ upload: null, uploaded: { source: 'upload' } });
    expect(done.releases).toHaveLength(1);
    expect(failed).toMatchObject({ upload: null, uploadError: 'signature invalid' });
    expect(consoleUpdatesReducer(started, cancelBundleUpload()).upload).toBeNull();
  });

  it('applies action answers to list and detail and records failures', () => {
    const listed = consoleUpdatesReducer(initialConsoleUpdatesState, loaded());
    const opened = consoleUpdatesReducer(listed, loadRollout({ id: 'r1' }));
    const acting = consoleUpdatesReducer(opened, rolloutAction({ id: 'r1', action: 'approve' }));
    const done = consoleUpdatesReducer(
      acting,
      rolloutActionSuccess({ action: 'approve', rollout: rollout({ status: 'approved' }) }),
    );

    expect(opened.selected?.id).toBe('r1');
    expect(acting.acting).toEqual({ id: 'r1', action: 'approve' });
    expect(done.selected?.status).toBe('approved');
    expect(done.rollouts[0].status).toBe('approved');
    expect(
      consoleUpdatesReducer(acting, rolloutActionFailure({ id: 'r1', action: 'approve', error: 'outside window' })),
    ).toMatchObject({ acting: null, actionError: 'outside window' });
    expect(consoleUpdatesReducer(listed, createRolloutSuccess({ rollout: rollout({ id: 'r2' }) })).rollouts[0].id).toBe(
      'r2',
    );
  });

  it('groups steps by wave with the wave’s failure analysis', () => {
    const step = (index: number, wave: number, state: Rollout['steps'][number]['state']) => ({
      index,
      wave,
      phase: wave === 0 ? 'control-plane' : wave === 1 ? 'canary' : 'wave',
      node: `n${index}`,
      site: 'fra1',
      kind: 'components',
      state,
      from: '1.1.0',
      to: '1.2.0',
      error: null,
      gates: [],
      startedAt: null,
      finishedAt: null,
    });
    const waves = rolloutWaves({
      steps: [step(2, 1, 'applying'), step(0, 0, 'done'), step(1, 0, 'skipped'), step(3, 2, 'pending')],
      failureAnalysis: [{ wave: 2, nodes: ['n3'], risk: ['shop/db loses its replica'] }],
    });

    expect(waves.map((w) => [w.wave, w.phase, w.steps.map((s) => s.node), w.done])).toEqual([
      [0, 'control-plane', ['n0', 'n1'], 2],
      [1, 'canary', ['n2'], 0],
      [2, 'wave', ['n3'], 0],
    ]);
    expect(waves[2].risk).toEqual(['shop/db loses its replica']);
  });
});

describe('console updates effects', () => {
  it('loads everything; windows and the cluster resource may fail alone', async () => {
    const service = {
      status: jest.fn().mockReturnValue(of(status)),
      releases: jest.fn().mockReturnValue(of([testRelease()])),
      rollouts: jest.fn().mockReturnValue(of([])),
    };
    const resources = {
      list: jest.fn((kind: string) =>
        kind === 'Cluster'
          ? of([{ apiVersion: 'v1', kind: 'Cluster', metadata: { name: 'prod' }, spec: {} }])
          : throwError(() => new Error('forbidden')),
      ),
    };

    TestBed.configureTestingModule({ providers: [provideMockActions(() => of(loadUpdates({})))] });

    expect(
      await firstValueFrom(
        loadUpdates$(
          TestBed.inject(Actions),
          service as unknown as UpdatesService,
          resources as unknown as ResourcesService,
        ),
      ),
    ).toEqual(
      loadUpdatesSuccess({
        status,
        releases: [testRelease()],
        rollouts: [],
        windows: null,
        clusterResource: 'prod',
      }),
    );
    expect(resources.list).toHaveBeenCalledWith('MaintenanceWindow');
  });

  it('reports upload progress and the imported release', async () => {
    const file = new File(['bundle'], 'bundle.tar');
    const service = {
      uploadBundle: jest
        .fn()
        .mockReturnValue(
          of(
            { type: HttpEventType.Sent },
            { type: HttpEventType.UploadProgress, loaded: 3, total: 6 },
            new HttpResponse({ body: testRelease({ source: 'upload' }) }),
          ),
        ),
    };

    TestBed.configureTestingModule({ providers: [provideMockActions(() => of(uploadBundle({ file })))] });

    expect(
      await firstValueFrom(
        uploadBundle$(TestBed.inject(Actions), service as unknown as UpdatesService).pipe(toArray()),
      ),
    ).toEqual([
      uploadBundleProgress({ loaded: 3, total: 6 }),
      uploadBundleSuccess({ release: testRelease({ source: 'upload' }) }),
    ]);
  });

  it('aborts an upload when cancelled', () => {
    const actions = new Subject<ReturnType<typeof uploadBundle> | ReturnType<typeof cancelBundleUpload>>();
    const upload = new Subject<unknown>();
    const service = { uploadBundle: jest.fn().mockReturnValue(upload) };
    const emitted: unknown[] = [];

    TestBed.configureTestingModule({ providers: [provideMockActions(() => actions)] });
    uploadBundle$(TestBed.inject(Actions), service as unknown as UpdatesService).subscribe((a) => emitted.push(a));
    actions.next(uploadBundle({ file: new File(['x'], 'b.tar') }));

    expect(upload.observed).toBe(true);
    actions.next(cancelBundleUpload());
    expect(upload.observed).toBe(false);
    expect(emitted).toEqual([]);
  });

  it('runs rollout actions and reports conflicts', async () => {
    const service = {
      act: jest
        .fn()
        .mockReturnValueOnce(of(rollout({ status: 'approved' })))
        .mockReturnValueOnce(
          throwError(() => new HttpErrorResponse({ status: 409, error: { message: 'the rollout is not running' } })),
        ),
    };

    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() =>
          of(
            rolloutAction({ id: 'r1', action: 'approve', emergency: true }),
            rolloutAction({ id: 'r1', action: 'pause' }),
          ),
        ),
      ],
    });

    expect(
      await firstValueFrom(
        rolloutActions$(TestBed.inject(Actions), service as unknown as UpdatesService).pipe(toArray()),
      ),
    ).toEqual([
      rolloutActionSuccess({ action: 'approve', rollout: rollout({ status: 'approved' }) }),
      rolloutActionFailure({ id: 'r1', action: 'pause', error: 'the rollout is not running' }),
    ]);
    expect(service.act).toHaveBeenNthCalledWith(1, 'r1', 'approve', true);
    expect(service.act).toHaveBeenNthCalledWith(2, 'r1', 'pause', false);
  });

  it('reloads after changes and opens a new plan', async () => {
    const router = { navigate: jest.fn().mockResolvedValue(true) };

    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() =>
          of(downloadReleaseSuccess({ version: '1.2.0' }), createRolloutSuccess({ rollout: rollout() })),
        ),
      ],
    });

    expect(await firstValueFrom(reloadUpdatesAfterChange$(TestBed.inject(Actions)).pipe(toArray()))).toEqual([
      loadUpdates({ silent: true }),
    ]);
    await firstValueFrom(openCreatedRollout$(TestBed.inject(Actions), router as unknown as Router).pipe(toArray()));
    expect(router.navigate).toHaveBeenCalledWith(['/delivery/updates/rollouts', 'r1']);
  });
});
