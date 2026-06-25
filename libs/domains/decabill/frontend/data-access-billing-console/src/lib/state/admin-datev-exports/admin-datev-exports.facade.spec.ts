import { TestBed } from '@angular/core/testing';
import { provideMockStore, MockStore } from '@ngrx/store/testing';

import { downloadDatevExport, loadAdminDatevExports, triggerDatevExport } from './admin-datev-exports.actions';
import { AdminDatevExportsFacade } from './admin-datev-exports.facade';

describe('AdminDatevExportsFacade', () => {
  let facade: AdminDatevExportsFacade;
  let store: MockStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [AdminDatevExportsFacade, provideMockStore()],
    });
    facade = TestBed.inject(AdminDatevExportsFacade);
    store = TestBed.inject(MockStore);
    jest.spyOn(store, 'dispatch');
  });

  it('loadExports dispatches loadAdminDatevExports', () => {
    facade.loadExports({ scope: 'tenant', year: 2026 });

    expect(store.dispatch).toHaveBeenCalledWith(loadAdminDatevExports({ params: { scope: 'tenant', year: 2026 } }));
  });

  it('setScope dispatches load with scope only', () => {
    facade.setScope('unified');

    expect(store.dispatch).toHaveBeenCalledWith(loadAdminDatevExports({ params: { scope: 'unified' } }));
  });

  it('triggerExport dispatches triggerDatevExport', () => {
    facade.triggerExport({ year: 2026, month: 1 });

    expect(store.dispatch).toHaveBeenCalledWith(triggerDatevExport({ dto: { year: 2026, month: 1 } }));
  });

  it('downloadExport dispatches downloadDatevExport', () => {
    facade.downloadExport('exp-1');

    expect(store.dispatch).toHaveBeenCalledWith(downloadDatevExport({ exportId: 'exp-1' }));
  });
});
