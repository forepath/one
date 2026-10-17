import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { firstValueFrom, of, throwError, toArray } from 'rxjs';

import { auditParams, ConsoleAuditService } from '../../services/audit.service';
import type { AuditEntry, AuditVerification } from '../../types/audit.types';
import {
  loadAuditPage,
  loadAuditPageFailure,
  loadAuditPageSuccess,
  nextAuditPage,
  previousAuditPage,
  searchAudit,
  verifyAudit,
  verifyAuditFailure,
  verifyAuditSuccess,
} from './audit.actions';
import { auditPageNavigation$, loadAuditPage$, searchAudit$, verifyAudit$ } from './audit.effects';
import { consoleAuditReducer, initialConsoleAuditState, type ConsoleAuditState } from './audit.reducer';

function entry(seq: string): AuditEntry {
  return {
    seq,
    at: '2026-10-18T09:12:03.000Z',
    actorType: 'user',
    actorId: 'u1',
    action: 'terminal.open',
    target: 'replica/shop/web/api/0',
    project: 'shop',
    details: { node: 'n1', recorded: true },
    hash: 'ab'.repeat(32),
  };
}

const filter = { project: 'shop', action: 'terminal.*' };
const verification: AuditVerification = {
  ok: true,
  checked: 120,
  head: '120',
  anchors: { checked: 3, mismatched: [], available: true },
};

describe('console audit state', () => {
  it('pages with the before cursor and remembers the cursors', () => {
    let state = consoleAuditReducer(initialConsoleAuditState, searchAudit({ filter, limit: 2 }));

    state = consoleAuditReducer(state, loadAuditPage({ page: 0, before: null }));
    state = consoleAuditReducer(
      state,
      loadAuditPageSuccess({ page: 0, result: { entries: [entry('120'), entry('119')], before: '119' } }),
    );
    state = consoleAuditReducer(state, loadAuditPage({ page: 1, before: '119' }));
    state = consoleAuditReducer(
      state,
      loadAuditPageSuccess({ page: 1, result: { entries: [entry('118')], before: null } }),
    );

    expect(state).toMatchObject({ page: 1, cursors: [null, '119'], nextBefore: null, loading: false });
    expect(consoleAuditReducer(state, loadAuditPageFailure({ page: 0, error: 'x' }))).toBe(state);
  });

  it('keeps the verification result', () => {
    let state = consoleAuditReducer(initialConsoleAuditState, verifyAudit());

    expect(state.verifying).toBe(true);
    state = consoleAuditReducer(state, verifyAuditSuccess({ verification, at: '2026-10-18T10:00:00.000Z' }));
    expect(state).toMatchObject({ verifying: false, verification, verifiedAt: '2026-10-18T10:00:00.000Z' });
    expect(consoleAuditReducer(state, verifyAuditFailure({ error: 'forbidden' })).verifyError).toBe('forbidden');
  });

  it('builds query parameters without empty values', () => {
    expect(auditParams({ project: 'shop', actor: '', text: undefined, limit: 50 }).toString()).toBe(
      'project=shop&limit=50',
    );
  });

  it('starts a search at the newest page and navigates', async () => {
    const state: ConsoleAuditState = {
      ...initialConsoleAuditState,
      filter,
      page: 1,
      cursors: [null, '119'],
      nextBefore: '80',
    };

    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() => of(searchAudit({ filter, limit: 50 }), nextAuditPage(), previousAuditPage())),
        provideMockStore({ initialState: { consoleAudit: state } }),
      ],
    });

    expect(await firstValueFrom(TestBed.runInInjectionContext(() => searchAudit$()).pipe(toArray()))).toEqual([
      loadAuditPage({ page: 0, before: null }),
    ]);
    expect(await firstValueFrom(TestBed.runInInjectionContext(() => auditPageNavigation$()).pipe(toArray()))).toEqual([
      loadAuditPage({ page: 2, before: '80' }),
      loadAuditPage({ page: 0, before: null }),
    ]);
  });

  it('loads pages and verifies the chain', async () => {
    const service = {
      list: jest
        .fn()
        .mockReturnValueOnce(of({ entries: [entry('100')], before: null }))
        .mockReturnValueOnce(
          throwError(() => new HttpErrorResponse({ status: 404, error: { message: 'no audit entries visible' } })),
        ),
      verify: jest
        .fn()
        .mockReturnValueOnce(of(verification))
        .mockReturnValueOnce(throwError(() => new Error('forbidden'))),
    };

    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() =>
          of(loadAuditPage({ page: 1, before: '101' }), loadAuditPage({ page: 0, before: null }), verifyAudit()),
        ),
        provideMockStore({ initialState: { consoleAudit: { ...initialConsoleAuditState, filter, limit: 25 } } }),
        { provide: ConsoleAuditService, useValue: service },
      ],
    });

    expect(await firstValueFrom(TestBed.runInInjectionContext(() => loadAuditPage$()).pipe(toArray()))).toEqual([
      loadAuditPageSuccess({ page: 1, result: { entries: [entry('100')], before: null } }),
      loadAuditPageFailure({ page: 0, error: 'no audit entries visible' }),
    ]);
    expect(service.list).toHaveBeenNthCalledWith(1, { ...filter, limit: 25, before: '101' });
    expect(service.list).toHaveBeenNthCalledWith(2, { ...filter, limit: 25 });

    const [verified] = await firstValueFrom(TestBed.runInInjectionContext(() => verifyAudit$()).pipe(toArray()));

    expect(verified).toMatchObject({ type: verifyAuditSuccess.type, verification });
  });
});
