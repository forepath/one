import { TestBed } from '@angular/core/testing';
import { provideMockStore, MockStore } from '@ngrx/store/testing';

import { saveEditor } from './editor.actions';
import { EditorFacade } from './editor.facade';

describe('EditorFacade', () => {
  let facade: EditorFacade;
  let store: MockStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [EditorFacade, provideMockStore()],
    });

    facade = TestBed.inject(EditorFacade);
    store = TestBed.inject(MockStore);
    jest.spyOn(store, 'dispatch');
  });

  it('should dispatch save', () => {
    facade.save();
    expect(store.dispatch).toHaveBeenCalledWith(saveEditor());
  });
});
