import { TestBed } from '@angular/core/testing';
import { provideMockStore, MockStore } from '@ngrx/store/testing';

import { listAssetDirectory } from './assets.actions';
import { AssetsFacade } from './assets.facade';

describe('AssetsFacade', () => {
  let facade: AssetsFacade;
  let store: MockStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [AssetsFacade, provideMockStore()],
    });

    facade = TestBed.inject(AssetsFacade);
    store = TestBed.inject(MockStore);
    jest.spyOn(store, 'dispatch');
  });

  it('should dispatch listDirectory', () => {
    facade.listDirectory('pres-1');
    expect(store.dispatch).toHaveBeenCalledWith(listAssetDirectory({ presentationId: 'pres-1', directoryPath: '.' }));
  });
});
