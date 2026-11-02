import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { of, throwError } from 'rxjs';

import { AdminBillingService } from '../../services/admin-billing.service';

import {
  downloadDatevExport,
  downloadDatevExportFailure,
  downloadDatevExportSuccess,
  expireQueuedDatevExports,
  loadAdminDatevExports,
  loadAdminDatevExportsFailure,
  loadAdminDatevExportsSuccess,
  resolveQueuedDatevExports,
  triggerDatevExport,
  triggerDatevExportFailure,
  triggerDatevExportSuccess,
} from './admin-datev-exports.actions';
import {
  downloadDatevExport$,
  loadAdminDatevExports$,
  pollQueuedDatevExports$,
  triggerDatevExport$,
  triggerDatevExportSuccessReload$,
  expireQueuedDatevExports$,
} from './admin-datev-exports.effects';
import { initialAdminDatevExportsState } from './admin-datev-exports.reducer';
import { selectAdminDatevExportsScope, selectAdminDatevExportsState } from './admin-datev-exports.selectors';

describe('AdminDatevExportsEffects', () => {
  let actions$: Actions;
  let store: MockStore;
  let service: jest.Mocked<
    Pick<AdminBillingService, 'listDatevExports' | 'triggerDatevExport' | 'downloadDatevExport'>
  >;

  const listItem = {
    id: 'exp-1',
    scope: 'tenant' as const,
    tenantId: 'default',
    periodYear: 2026,
    periodMonth: 1,
    status: 'completed' as const,
    bookingCount: 1,
    invoiceCount: 1,
    debtorCount: 1,
    createdAt: '2026-02-01T00:00:00Z',
  };

  beforeEach(() => {
    service = {
      listDatevExports: jest.fn(),
      triggerDatevExport: jest.fn(),
      downloadDatevExport: jest.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() => actions$),
        provideMockStore(),
        { provide: AdminBillingService, useValue: service },
      ],
    });
    actions$ = TestBed.inject(Actions);
    store = TestBed.inject(MockStore);
    store.overrideSelector(selectAdminDatevExportsScope, 'tenant');
    store.overrideSelector(selectAdminDatevExportsState, {
      ...initialAdminDatevExportsState,
      scope: 'tenant',
      viewTenantId: 'default',
    });
  });

  describe('loadAdminDatevExports$', () => {
    it('loads page 1 with the default page size when no window is given', (done) => {
      actions$ = of(loadAdminDatevExports({ params: { scope: 'tenant' } }));
      service.listDatevExports.mockReturnValue(of({ items: [], total: 0, limit: 25, offset: 0 }));

      loadAdminDatevExports$(actions$, service as AdminBillingService).subscribe((result) => {
        expect(result).toEqual(
          loadAdminDatevExportsSuccess({ items: [], total: 0, limit: 25, offset: 0, loadedScope: 'tenant' }),
        );
        expect(service.listDatevExports).toHaveBeenCalledWith({ scope: 'tenant', limit: 25, offset: 0 });
        done();
      });
    });

    it('loads exactly the requested page with the total in one request (replace-page)', (done) => {
      actions$ = of(loadAdminDatevExports({ params: { scope: 'unified', search: '2026', limit: 50, offset: 100 } }));
      service.listDatevExports.mockReturnValue(of({ items: [listItem], total: 101, limit: 50, offset: 100 }));

      loadAdminDatevExports$(actions$, service as AdminBillingService).subscribe((result) => {
        expect(result).toEqual(
          loadAdminDatevExportsSuccess({
            items: [listItem],
            total: 101,
            limit: 50,
            offset: 100,
            loadedScope: 'unified',
          }),
        );
        expect(service.listDatevExports).toHaveBeenCalledTimes(1);
        expect(service.listDatevExports).toHaveBeenCalledWith({
          scope: 'unified',
          search: '2026',
          limit: 50,
          offset: 100,
        });
        done();
      });
    });

    it('maps load failures', (done) => {
      actions$ = of(loadAdminDatevExports({ params: { scope: 'tenant' } }));
      service.listDatevExports.mockReturnValue(throwError(() => new Error('load failed')));

      loadAdminDatevExports$(actions$, service as AdminBillingService).subscribe((result) => {
        expect(result).toEqual(loadAdminDatevExportsFailure({ error: 'load failed' }));
        done();
      });
    });
  });

  describe('pollQueuedDatevExports$', () => {
    it('resolves queued exports by their year (any page) and then reloads the current page', (done) => {
      jest.useFakeTimers();
      const current = {
        ...initialAdminDatevExportsState,
        scope: 'tenant' as const,
        viewTenantId: 'default',
        search: 'jan',
        limit: 25,
        offset: 50,
        queuedExports: [
          { clientId: 'tenant-2025-1-0', scope: 'tenant' as const, periodYear: 2025, periodMonth: 1, queuedAt: 'x' },
        ],
      };

      store.overrideSelector(selectAdminDatevExportsState, current);
      service.listDatevExports.mockReturnValue(
        of({ items: [{ ...listItem, periodYear: 2025 }], total: 1, limit: 100, offset: 0 }),
      );
      actions$ = of(
        triggerDatevExportSuccess({
          result: { queued: true, scope: 'tenant', year: 2025, month: 1 },
          queuedAt: '2026-02-01T00:00:00Z',
        }),
      );
      const results: unknown[] = [];
      const subscription = pollQueuedDatevExports$(actions$, store, service as AdminBillingService).subscribe(
        (result) => {
          results.push(result);

          if (results.length < 2) return;

          expect(service.listDatevExports).toHaveBeenCalledWith({
            scope: 'tenant',
            viewTenantId: 'default',
            year: 2025,
            limit: 100,
            offset: 0,
          });
          expect(results[0]).toEqual(
            resolveQueuedDatevExports({ items: [{ ...listItem, periodYear: 2025 }], loadedScope: 'tenant' }),
          );
          expect(results[1]).toEqual(
            loadAdminDatevExports({
              params: { scope: 'tenant', viewTenantId: 'default', search: 'jan', limit: 25, offset: 50 },
              preserveScope: true,
            }),
          );
          subscription.unsubscribe();
          jest.useRealTimers();
          done();
        },
      );

      jest.advanceTimersByTime(3000);
    });
  });

  describe('triggerDatevExport$', () => {
    it('maps trigger success', (done) => {
      actions$ = of(triggerDatevExport({ dto: { year: 2026, month: 1 } }));
      service.triggerDatevExport.mockReturnValue(of({ queued: true, scope: 'tenant', year: 2026, month: 1 }));

      triggerDatevExport$(actions$, service as AdminBillingService).subscribe((result) => {
        expect(result.type).toBe(triggerDatevExportSuccess.type);
        expect(result).toEqual(
          expect.objectContaining({
            result: { queued: true, scope: 'tenant', year: 2026, month: 1 },
          }),
        );
        done();
      });
    });

    it('maps trigger failures', (done) => {
      actions$ = of(triggerDatevExport({ dto: { year: 2026, month: 1 } }));
      service.triggerDatevExport.mockReturnValue(throwError(() => new Error('trigger failed')));

      triggerDatevExport$(actions$, service as AdminBillingService).subscribe((result) => {
        expect(result).toEqual(triggerDatevExportFailure({ error: 'trigger failed' }));
        done();
      });
    });
  });

  describe('triggerDatevExportSuccessReload$', () => {
    it('reloads the current page of the active scope without switching tabs', (done) => {
      actions$ = of(
        triggerDatevExportSuccess({
          result: { queued: true, scope: 'unified', year: 2026, month: 2 },
          queuedAt: '2026-02-01T00:00:00Z',
        }),
      );

      triggerDatevExportSuccessReload$(actions$, store).subscribe((result) => {
        expect(result).toEqual(
          loadAdminDatevExports({
            params: { scope: 'tenant', viewTenantId: 'default', limit: 25, offset: 0 },
            preserveScope: true,
          }),
        );
        done();
      });
    });
  });

  describe('expireQueuedDatevExports$', () => {
    it('expires queued exports after the timeout', (done) => {
      jest.useFakeTimers();
      actions$ = of(
        triggerDatevExportSuccess({
          result: { queued: true, scope: 'tenant', year: 2026, month: 1 },
          queuedAt: '2026-02-01T00:00:00Z',
        }),
      );
      store.overrideSelector(selectAdminDatevExportsState, {
        ...initialAdminDatevExportsState,
        queuedExports: [
          {
            clientId: 'tenant-2026-1-0',
            scope: 'tenant',
            periodYear: 2026,
            periodMonth: 1,
            queuedAt: '2026-02-01T00:00:00Z',
          },
        ],
      });

      expireQueuedDatevExports$(actions$, store).subscribe((result) => {
        expect(result).toEqual(expireQueuedDatevExports());
        jest.useRealTimers();
        done();
      });

      jest.advanceTimersByTime(5 * 60 * 1000);
    });
  });

  describe('downloadDatevExport$', () => {
    it('downloads export and dispatches success', (done) => {
      const createObjectURL = jest.fn().mockReturnValue('blob:datev');
      const revokeObjectURL = jest.fn();
      const click = jest.fn();

      Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
      Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
      jest.spyOn(document, 'createElement').mockReturnValue({ click } as never);

      actions$ = of(downloadDatevExport({ exportId: 'exp-1' }));
      service.downloadDatevExport.mockReturnValue(of(new Blob(['zip'])));

      downloadDatevExport$(actions$, service as AdminBillingService).subscribe((result) => {
        expect(result).toEqual(downloadDatevExportSuccess());
        expect(createObjectURL).toHaveBeenCalled();
        expect(click).toHaveBeenCalled();
        expect(revokeObjectURL).toHaveBeenCalledWith('blob:datev');
        done();
      });
    });

    it('maps download failures', (done) => {
      actions$ = of(downloadDatevExport({ exportId: 'exp-1' }));
      service.downloadDatevExport.mockReturnValue(throwError(() => new Error('download failed')));

      downloadDatevExport$(actions$, service as AdminBillingService).subscribe((result) => {
        expect(result).toEqual(downloadDatevExportFailure({ error: 'download failed' }));
        done();
      });
    });
  });
});
