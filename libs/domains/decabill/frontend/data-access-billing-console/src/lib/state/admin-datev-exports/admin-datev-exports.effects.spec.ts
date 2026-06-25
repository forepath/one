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
  loadAdminDatevExportsBatch,
  loadAdminDatevExportsFailure,
  loadAdminDatevExportsSuccess,
  triggerDatevExport,
  triggerDatevExportFailure,
  triggerDatevExportSuccess,
} from './admin-datev-exports.actions';
import {
  downloadDatevExport$,
  loadAdminDatevExports$,
  loadAdminDatevExportsBatch$,
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
  });

  describe('loadAdminDatevExports$', () => {
    it('returns empty success when no exports', (done) => {
      actions$ = of(loadAdminDatevExports({ params: { scope: 'tenant' } }));
      service.listDatevExports.mockReturnValue(of({ items: [], total: 0, limit: 10, offset: 0 }));

      loadAdminDatevExports$(actions$, service as AdminBillingService).subscribe((result) => {
        expect(result).toEqual(
          loadAdminDatevExportsSuccess({ items: [], total: 0, limit: 10, offset: 0, loadedScope: 'tenant' }),
        );
        expect(service.listDatevExports).toHaveBeenCalledWith({ scope: 'tenant', limit: 10, offset: 0 });
        done();
      });
    });

    it('returns success when first page is partial', (done) => {
      actions$ = of(loadAdminDatevExports({ params: { scope: 'tenant' } }));
      service.listDatevExports.mockReturnValue(of({ items: [listItem], total: 1, limit: 10, offset: 0 }));

      loadAdminDatevExports$(actions$, service as AdminBillingService).subscribe((result) => {
        expect(result).toEqual(
          loadAdminDatevExportsSuccess({ items: [listItem], total: 1, limit: 10, offset: 0, loadedScope: 'tenant' }),
        );
        done();
      });
    });

    it('chains batch when first page is full', (done) => {
      actions$ = of(loadAdminDatevExports({ params: { scope: 'tenant' } }));
      service.listDatevExports.mockReturnValue(
        of({ items: Array(10).fill(listItem), total: 20, limit: 10, offset: 0 }),
      );

      loadAdminDatevExports$(actions$, service as AdminBillingService).subscribe((result) => {
        expect(result).toEqual(
          loadAdminDatevExportsBatch({
            params: { scope: 'tenant', limit: 10, offset: 0 },
            offset: 10,
            accumulatedItems: Array(10).fill(listItem),
          }),
        );
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

  describe('loadAdminDatevExportsBatch$', () => {
    it('finishes when batch page is partial', (done) => {
      actions$ = of(
        loadAdminDatevExportsBatch({
          params: { scope: 'tenant', limit: 10, offset: 0 },
          offset: 10,
          accumulatedItems: Array(10).fill(listItem),
        }),
      );
      service.listDatevExports.mockReturnValue(of({ items: [listItem], total: 11, limit: 10, offset: 10 }));

      loadAdminDatevExportsBatch$(actions$, service as AdminBillingService).subscribe((result) => {
        expect(result).toEqual(
          loadAdminDatevExportsSuccess({
            items: [...Array(10).fill(listItem), listItem],
            total: 11,
            limit: 10,
            offset: 0,
            loadedScope: 'tenant',
          }),
        );
        done();
      });
    });

    it('chains another batch when page is full', (done) => {
      actions$ = of(
        loadAdminDatevExportsBatch({
          params: { scope: 'tenant', limit: 10, offset: 0 },
          offset: 10,
          accumulatedItems: Array(10).fill(listItem),
        }),
      );
      service.listDatevExports.mockReturnValue(
        of({ items: Array(10).fill(listItem), total: 30, limit: 10, offset: 10 }),
      );

      loadAdminDatevExportsBatch$(actions$, service as AdminBillingService).subscribe((result) => {
        expect(result).toEqual(
          loadAdminDatevExportsBatch({
            params: { scope: 'tenant', limit: 10, offset: 0 },
            offset: 20,
            accumulatedItems: Array(20).fill(listItem),
          }),
        );
        done();
      });
    });

    it('maps batch failures', (done) => {
      actions$ = of(
        loadAdminDatevExportsBatch({
          params: { scope: 'tenant' },
          offset: 10,
          accumulatedItems: [listItem],
        }),
      );
      service.listDatevExports.mockReturnValue(throwError(() => new Error('batch failed')));

      loadAdminDatevExportsBatch$(actions$, service as AdminBillingService).subscribe((result) => {
        expect(result).toEqual(loadAdminDatevExportsFailure({ error: 'batch failed' }));
        done();
      });
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
    it('reloads exports for the active scope without switching tabs', (done) => {
      actions$ = of(
        triggerDatevExportSuccess({
          result: { queued: true, scope: 'unified', year: 2026, month: 2 },
          queuedAt: '2026-02-01T00:00:00Z',
        }),
      );

      triggerDatevExportSuccessReload$(actions$, store).subscribe((result) => {
        expect(result).toEqual(
          loadAdminDatevExports({
            params: { scope: 'tenant', limit: 10, offset: 0 },
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
