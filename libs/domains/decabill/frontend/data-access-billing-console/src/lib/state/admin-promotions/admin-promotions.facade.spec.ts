import { TestBed } from '@angular/core/testing';
import { provideMockStore, MockStore } from '@ngrx/store/testing';

import { loadAdminPromotionRedemptions, loadAdminPromotions } from './admin-promotions.actions';
import { AdminPromotionsFacade } from './admin-promotions.facade';
import { initialAdminPromotionsState } from './admin-promotions.reducer';

describe('AdminPromotionsFacade (replace-page)', () => {
  let facade: AdminPromotionsFacade;
  let store: MockStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        AdminPromotionsFacade,
        provideMockStore({
          initialState: { adminPromotions: { ...initialAdminPromotionsState, search: 'save', pageSize: 50 } },
        }),
      ],
    });
    facade = TestBed.inject(AdminPromotionsFacade);
    store = TestBed.inject(MockStore);
    jest.spyOn(store, 'dispatch');
  });

  it('loadPromotions requests the given page with the search', () => {
    facade.loadPromotions({ search: 'x', page: 2, pageSize: 25 });

    expect(store.dispatch).toHaveBeenCalledWith(loadAdminPromotions({ search: 'x', page: 2, pageSize: 25 }));
  });

  it('loadPage keeps the current search and page size', () => {
    facade.loadPage(4);

    expect(store.dispatch).toHaveBeenCalledWith(loadAdminPromotions({ search: 'save', page: 4, pageSize: 50 }));
  });

  it('loadRedemptions requests one page of a promotion', () => {
    facade.loadRedemptions('promo-1', 2, 25);

    expect(store.dispatch).toHaveBeenCalledWith(
      loadAdminPromotionRedemptions({ promotionId: 'promo-1', page: 2, pageSize: 25 }),
    );
  });
});
