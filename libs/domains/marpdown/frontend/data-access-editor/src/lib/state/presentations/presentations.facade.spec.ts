import { TestBed } from '@angular/core/testing';
import { provideMockStore, MockStore } from '@ngrx/store/testing';

import { loadPresentations } from './presentations.actions';
import { PresentationsFacade } from './presentations.facade';

describe('PresentationsFacade', () => {
  let facade: PresentationsFacade;
  let store: MockStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [PresentationsFacade, provideMockStore()],
    });

    facade = TestBed.inject(PresentationsFacade);
    store = TestBed.inject(MockStore);
    jest.spyOn(store, 'dispatch');
  });

  it('should dispatch loadPresentations', () => {
    facade.loadPresentations();
    expect(store.dispatch).toHaveBeenCalledWith(loadPresentations({}));
  });
});
