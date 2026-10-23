import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { firstValueFrom, of, throwError, toArray } from 'rxjs';

import { GitService } from '../../services/git.service';
import type { CreatedGitConnection, GitConnection } from '../../types/git.types';
import {
  clearGitSave,
  createGitConnection,
  createGitConnectionSuccess,
  deleteGitConnectionSuccess,
  hideGitWebhookSecret,
  loadGitCommits,
  loadGitConnections,
  loadGitConnectionsSuccess,
  loadGitSopsRecipient,
  loadGitSopsRecipientFailure,
  loadGitSopsRecipientSuccess,
  revealGitWebhookSecret,
  revealGitWebhookSecretSuccess,
  rotateGitWebhookSecret,
  rotateGitWebhookSecretFailure,
  rotateGitWebhookSecretSuccess,
  runGitConnectionAction,
  runGitConnectionActionFailure,
  runGitConnectionActionSuccess,
  updateGitConnectionSuccess,
} from './git.actions';
import {
  loadGitSopsRecipient$,
  reloadAfterGitAction$,
  revealGitWebhookSecret$,
  rotateGitWebhookSecret$,
  runGitConnectionAction$,
} from './git.effects';
import { consoleGitReducer, initialConsoleGitState } from './git.reducer';

function gitConnection(overrides: Partial<GitConnection> = {}): GitConnection {
  return {
    id: '6f1c1b0e-0000-4000-8000-000000000001',
    project: 'shop',
    provider: 'github',
    repoUrl: 'https://github.com/acme/infra.git',
    branch: 'main',
    path: 'shop',
    mode: 'bidirectional',
    credentials: 'secret://shop/git-token',
    apiUrl: null,
    caCertificate: null,
    pollIntervalSeconds: 60,
    webhook: true,
    webhookPath: '/api/git/webhooks/6f1c1b0e-0000-4000-8000-000000000001',
    approvalByMergeReview: false,
    membershipsFromGit: false,
    autoMerge: true,
    sops: false,
    githubApp: false,
    webhookGeneration: 0,
    hostKey: null,
    lastSyncedCommit: null,
    lastSyncAt: null,
    lastError: null,
    createdBy: 'u1',
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    ...overrides,
  };
}

describe('console git state', () => {
  const cluster = gitConnection({ id: 'c0', project: null, path: '' });
  const shop = gitConnection();

  it('keeps the cluster scope first and shows the webhook secret of a new connection once', () => {
    const loaded = consoleGitReducer(initialConsoleGitState, loadGitConnectionsSuccess({ connections: [shop] }));
    const created: CreatedGitConnection = { ...cluster, webhookSecret: 'whsec' };
    const saving = consoleGitReducer(loaded, createGitConnection({ request: {} as never }));
    const done = consoleGitReducer(saving, createGitConnectionSuccess({ connection: created }));

    expect(saving.saving).toBe(true);
    expect(done.connections.map((c) => c.id)).toEqual(['c0', shop.id]);
    expect(done.connections[0]).not.toHaveProperty('webhookSecret');
    expect(done.created?.webhookSecret).toBe('whsec');
    expect(done.saved).toBe('c0');

    const cleared = consoleGitReducer(done, clearGitSave());

    expect(cleared.created).toBeNull();
    expect(cleared.saved).toBeNull();

    const updated = consoleGitReducer(
      cleared,
      updateGitConnectionSuccess({ connection: { ...shop, mode: 'authoritative' } }),
    );

    expect(updated.connections.find((c) => c.id === shop.id)?.mode).toBe('authoritative');
    expect(consoleGitReducer(updated, deleteGitConnectionSuccess({ id: 'c0' })).connections).toHaveLength(1);
  });

  it('loads silently without the loading state and tracks actions, secrets and the SOPS recipient', () => {
    expect(consoleGitReducer(initialConsoleGitState, loadGitConnections({ silent: true })).loading).toBe(false);
    expect(consoleGitReducer(initialConsoleGitState, loadGitConnections({})).loading).toBe(true);
    expect(consoleGitReducer(initialConsoleGitState, loadGitCommits({ id: 'x' })).commitsLoading).toBe('x');

    const acting = consoleGitReducer(initialConsoleGitState, runGitConnectionAction({ id: 'x', action: 'sync' }));

    expect(acting.acting).toEqual({ id: 'x', action: 'sync' });

    const failed = consoleGitReducer(acting, runGitConnectionActionFailure({ id: 'x', action: 'sync', error: 'no' }));

    expect(failed).toMatchObject({ acting: null, actionError: { id: 'x', action: 'sync', error: 'no' } });

    const shown = consoleGitReducer(
      consoleGitReducer(initialConsoleGitState, revealGitWebhookSecret({ id: 'x' })),
      revealGitWebhookSecretSuccess({ id: 'x', secret: 's3cr3t' }),
    );

    expect(shown.webhookSecret).toEqual({ id: 'x', secret: 's3cr3t' });
    expect(consoleGitReducer(shown, hideGitWebhookSecret()).webhookSecret).toBeNull();

    expect(
      consoleGitReducer(initialConsoleGitState, loadGitSopsRecipientSuccess({ recipient: 'age1abc' })).sopsRecipient,
    ).toBe('age1abc');
    expect(
      consoleGitReducer(initialConsoleGitState, loadGitSopsRecipientFailure({ error: 'nf', unavailable: true })),
    ).toMatchObject({ sopsUnavailable: true, sopsError: null, sopsLoaded: true });
  });

  it('runs actions, reloads after a sync, reads secrets and tells a missing SOPS endpoint apart', async () => {
    const service = {
      test: jest.fn().mockReturnValue(of({ ok: true, head: 'abc', hostKey: null })),
      sync: jest.fn().mockReturnValue(of({ commit: 'abc', state: 'pending', planId: 'p1', reason: null })),
      exportToRepo: jest.fn().mockReturnValue(of({ commit: 'def', resources: 3, changed: true })),
      resetHostKey: jest.fn().mockReturnValue(throwError(() => new Error('nope'))),
      webhookSecret: jest.fn().mockReturnValue(of({ webhookSecret: 'whsec' })),
      sopsRecipient: jest
        .fn()
        .mockReturnValueOnce(of({ recipient: 'age1xyz' }))
        .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 404, error: { message: 'Not Found' } }))),
    };

    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() =>
          of(
            runGitConnectionAction({ id: 'a', action: 'test' }),
            runGitConnectionAction({ id: 'a', action: 'sync' }),
            runGitConnectionAction({ id: 'a', action: 'export', force: true }),
            runGitConnectionAction({ id: 'a', action: 'reset-host-key' }),
            revealGitWebhookSecret({ id: 'a' }),
            loadGitSopsRecipient(),
            loadGitSopsRecipient(),
          ),
        ),
      ],
    });

    const actions = TestBed.inject(Actions);
    const api = service as unknown as GitService;
    const results = await firstValueFrom(runGitConnectionAction$(actions, api).pipe(toArray()));

    expect(results[0]).toEqual(
      runGitConnectionActionSuccess({
        id: 'a',
        outcome: { action: 'test', result: { ok: true, head: 'abc', hostKey: null } },
      }),
    );
    expect(results[1]).toMatchObject({ outcome: { action: 'sync', result: { planId: 'p1' } } });
    expect(service.exportToRepo).toHaveBeenCalledWith('a', true);
    expect(results[3]).toEqual(runGitConnectionActionFailure({ id: 'a', action: 'reset-host-key', error: 'nope' }));

    expect(await firstValueFrom(revealGitWebhookSecret$(actions, api))).toEqual(
      revealGitWebhookSecretSuccess({ id: 'a', secret: 'whsec' }),
    );

    const sops = await firstValueFrom(loadGitSopsRecipient$(actions, api).pipe(toArray()));

    expect(sops[0]).toEqual(loadGitSopsRecipientSuccess({ recipient: 'age1xyz' }));
    expect(sops[1]).toMatchObject({ type: loadGitSopsRecipientFailure.type, unavailable: true });
  });

  it('reloads the connection and its commits after a sync, not after a host key reset', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() =>
          of(
            runGitConnectionActionSuccess({
              id: 'a',
              outcome: { action: 'sync', result: { commit: null, state: 'unchanged', planId: null, reason: null } },
            }),
            runGitConnectionActionSuccess({ id: 'a', outcome: { action: 'reset-host-key', result: shop } }),
          ),
        ),
      ],
    });

    const reloads = await firstValueFrom(reloadAfterGitAction$(TestBed.inject(Actions)).pipe(toArray()));

    expect(reloads).toEqual([loadGitConnections({ silent: true }), loadGitCommits({ id: 'a', silent: true })]);
  });

  it('rotates the webhook secret: shows the new one once and bumps the generation', async () => {
    const loaded = consoleGitReducer(initialConsoleGitState, loadGitConnectionsSuccess({ connections: [shop] }));
    const rotating = consoleGitReducer(loaded, rotateGitWebhookSecret({ id: shop.id }));

    expect(rotating).toMatchObject({ webhookSecretRotating: shop.id, webhookSecret: null });

    const rotated = consoleGitReducer(
      rotating,
      rotateGitWebhookSecretSuccess({ id: shop.id, secret: 'whsec_2', generation: 2 }),
    );

    expect(rotated.webhookSecret).toEqual({ id: shop.id, secret: 'whsec_2', rotated: true });
    expect(rotated.webhookSecretRotating).toBeNull();
    expect(rotated.connections[0].webhookGeneration).toBe(2);
    expect(consoleGitReducer(rotated, hideGitWebhookSecret()).webhookSecret).toBeNull();
    expect(
      consoleGitReducer(rotating, rotateGitWebhookSecretFailure({ id: shop.id, error: 'forbidden' })),
    ).toMatchObject({ webhookSecretRotating: null, webhookSecretError: 'forbidden' });

    const service = {
      rotateWebhookSecret: jest
        .fn()
        .mockReturnValueOnce(of({ webhookSecret: 'whsec_3', webhookGeneration: 3 }))
        .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 403, error: { message: 'no' } }))),
    };

    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() => of(rotateGitWebhookSecret({ id: 'a' }), rotateGitWebhookSecret({ id: 'b' }))),
      ],
    });

    const results = await firstValueFrom(
      rotateGitWebhookSecret$(TestBed.inject(Actions), service as unknown as GitService).pipe(toArray()),
    );

    expect(results[0]).toEqual(rotateGitWebhookSecretSuccess({ id: 'a', secret: 'whsec_3', generation: 3 }));
    expect(results[1]).toEqual(rotateGitWebhookSecretFailure({ id: 'b', error: 'no' }));
  });
});
