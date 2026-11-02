import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { firstValueFrom, of, throwError, toArray } from 'rxjs';

import { BackupsService } from '../../services/backups.service';
import type { BackupKeyGeneration, KitShare } from '../../types/backups.types';
import {
  backupKeyActionFailure,
  backupKeyActionSuccess,
  clearKitShare,
  confirmBackupKit,
  downloadKitShare,
  escrowBackupKey,
  kitShareReceived,
  loadBackupKeys,
  loadBackupKeysSuccess,
  reissueBackupKit,
  rotateBackupKey,
} from './backup-keys.actions';
import { backupKeyActions$, loadBackupKeys$, reloadBackupKeysAfterAction$ } from './backup-keys.effects';
import { ConsoleBackupKeysFacade } from './backup-keys.facade';
import { consoleBackupKeysReducer, initialConsoleBackupKeysState } from './backup-keys.reducer';
import { isRecoverable, pendingShares, selectActiveBackupKey } from './backup-keys.selectors';

function generation(overrides: Partial<BackupKeyGeneration> = {}): BackupKeyGeneration {
  return {
    generation: 1,
    rootId: 'root-1',
    active: true,
    createdAt: '2026-10-01T10:00:00.000Z',
    retiredAt: null,
    kit: { shares: 3, threshold: 2, downloaded: [], confirmedAt: null, confirmedBy: null },
    escrow: null,
    ...overrides,
  };
}

const share: KitShare = {
  document: {
    format: 'loadweaver-recovery-kit',
    version: 1,
    cluster: 'prod',
    generation: 1,
    rootId: 'root-1',
    index: 2,
    shares: 3,
    threshold: 2,
    share: 'abc',
    createdAt: '2026-10-01T10:00:00.000Z',
    checksum: '0123456789abcdef',
  },
  text: 'LOADWEAVER RECOVERY KIT share 2 of 3',
};

describe('console backup keys state', () => {
  it('sorts generations newest first and finds the active one', () => {
    const state = consoleBackupKeysReducer(
      initialConsoleBackupKeysState,
      loadBackupKeysSuccess({
        generations: [generation({ active: false, retiredAt: 'x' }), generation({ generation: 2, rootId: 'root-2' })],
      }),
    );

    expect(state.generations.map((g) => g.generation)).toEqual([2, 1]);
    expect(selectActiveBackupKey({ consoleBackupKeys: state })?.generation).toBe(2);
  });

  it('knows what is recoverable and which shares are still to hand out', () => {
    const g = generation({
      kit: {
        shares: 3,
        threshold: 2,
        downloaded: [
          { index: 1, downloadedAt: 'x', downloadedBy: 'u1' },
          { index: 3, downloadedAt: null, downloadedBy: null },
        ],
        confirmedAt: null,
        confirmedBy: null,
      },
    });

    expect(isRecoverable(g)).toBe(false);
    expect(isRecoverable({ ...g, kit: { ...g.kit, confirmedAt: 'x' } })).toBe(true);
    expect(isRecoverable({ ...g, escrow: { provider: 'vault', keyRef: 'k', at: 'x' } })).toBe(true);
    expect(pendingShares(g)).toEqual([2, 3]);
  });

  it('shows a share once and marks it handed out', () => {
    const listed = consoleBackupKeysReducer(
      initialConsoleBackupKeysState,
      loadBackupKeysSuccess({ generations: [generation()] }),
    );
    const acting = consoleBackupKeysReducer(listed, downloadKitShare({ generation: 1, index: 2 }));
    const received = consoleBackupKeysReducer(acting, kitShareReceived({ generation: 1, index: 2, share }));

    expect(acting.acting).toEqual({ action: 'share', generation: 1, index: 2 });
    expect(received.share?.share.text).toContain('share 2 of 3');
    expect(pendingShares(received.generations[0])).toEqual([1, 3]);
    expect(consoleBackupKeysReducer(received, clearKitShare()).share).toBeNull();
  });

  it('applies rotations and records failures', () => {
    const listed = consoleBackupKeysReducer(
      initialConsoleBackupKeysState,
      loadBackupKeysSuccess({ generations: [generation()] }),
    );
    const rotating = consoleBackupKeysReducer(listed, rotateBackupKey({}));
    const rotated = consoleBackupKeysReducer(
      rotating,
      backupKeyActionSuccess({ action: 'rotate', generation: 2, updated: generation({ generation: 2 }) }),
    );
    const refused = consoleBackupKeysReducer(
      consoleBackupKeysReducer(listed, confirmBackupKit({ generation: 1, shares: ['a'] })),
      backupKeyActionFailure({ action: 'confirm', generation: 1, error: 'too few shares' }),
    );

    expect(rotating.acting).toEqual({ action: 'rotate', generation: null });
    expect(rotated.generations.map((g) => [g.generation, g.active])).toEqual([
      [2, true],
      [1, false],
    ]);
    expect(rotated.lastSuccess).toEqual({ action: 'rotate', generation: 2 });
    expect(refused).toMatchObject({ acting: null, actionError: 'too few shares' });
  });
});

describe('console backup keys effects', () => {
  it('loads generations', async () => {
    const service = { keys: jest.fn().mockReturnValue(of([generation()])) };

    TestBed.configureTestingModule({ providers: [provideMockActions(() => of(loadBackupKeys({})))] });

    expect(
      await firstValueFrom(loadBackupKeys$(TestBed.inject(Actions), service as unknown as BackupsService)),
    ).toEqual(loadBackupKeysSuccess({ generations: [generation()] }));
  });

  it('runs each key action and passes the API’s messages on', async () => {
    const service = {
      rotateKey: jest.fn().mockReturnValue(of(generation({ generation: 2 }))),
      reissueKit: jest.fn().mockReturnValue(of(generation())),
      downloadShare: jest.fn().mockReturnValue(of(share)),
      confirmKit: jest
        .fn()
        .mockReturnValue(
          throwError(() => new HttpErrorResponse({ status: 400, error: { message: 'share 2: checksum mismatch' } })),
        ),
      escrow: jest
        .fn()
        .mockReturnValue(
          throwError(() => new HttpErrorResponse({ status: 400, error: { message: 'no KMS is configured' } })),
        ),
    };

    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() =>
          of(
            rotateBackupKey({ kit: { shares: 5, threshold: 3 } }),
            reissueBackupKit({ generation: 1, kit: { shares: 3, threshold: 2 } }),
            downloadKitShare({ generation: 1, index: 2 }),
            confirmBackupKit({ generation: 1, shares: ['a', 'b'] }),
            escrowBackupKey({ generation: 1 }),
          ),
        ),
      ],
    });

    expect(
      await firstValueFrom(
        backupKeyActions$(TestBed.inject(Actions), service as unknown as BackupsService).pipe(toArray()),
      ),
    ).toEqual([
      backupKeyActionSuccess({ action: 'rotate', generation: 2, updated: generation({ generation: 2 }) }),
      backupKeyActionSuccess({ action: 'reissue', generation: 1, updated: generation() }),
      kitShareReceived({ generation: 1, index: 2, share }),
      backupKeyActionSuccess({ action: 'share', generation: 1, updated: null }),
      backupKeyActionFailure({ action: 'confirm', generation: 1, error: 'share 2: checksum mismatch' }),
      backupKeyActionFailure({ action: 'escrow', generation: 1, error: 'no KMS is configured' }),
    ]);
    expect(service.rotateKey).toHaveBeenCalledWith({ shares: 5, threshold: 3 });
    expect(service.confirmKit).toHaveBeenCalledWith(1, ['a', 'b']);
  });

  it('reloads after an action', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() => of(backupKeyActionSuccess({ action: 'escrow', generation: 1, updated: null }))),
      ],
    });

    expect(await firstValueFrom(reloadBackupKeysAfterAction$(TestBed.inject(Actions)))).toEqual(
      loadBackupKeys({ silent: true }),
    );
  });
});

describe('ConsoleBackupKeysFacade', () => {
  it('dispatches the key actions', () => {
    TestBed.configureTestingModule({ providers: [provideMockStore(), ConsoleBackupKeysFacade] });

    const store = TestBed.inject(MockStore);
    const dispatch = jest.spyOn(store, 'dispatch');
    const facade = TestBed.inject(ConsoleBackupKeysFacade);

    facade.load();
    facade.rotate();
    facade.reissue(1, { shares: 3, threshold: 2 });
    facade.downloadShare(1, 3);
    facade.confirm(1, ['a', 'b']);
    facade.escrow(1);
    facade.clearShare();

    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      loadBackupKeys({ silent: false }),
      rotateBackupKey({}),
      reissueBackupKit({ generation: 1, kit: { shares: 3, threshold: 2 } }),
      downloadKitShare({ generation: 1, index: 3 }),
      confirmBackupKit({ generation: 1, shares: ['a', 'b'] }),
      escrowBackupKey({ generation: 1 }),
      clearKitShare(),
    ]);
  });
});
