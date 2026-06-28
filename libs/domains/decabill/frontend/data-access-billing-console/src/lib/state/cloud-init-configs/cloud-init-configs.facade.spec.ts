import { TestBed } from '@angular/core/testing';
import { provideMockStore, MockStore } from '@ngrx/store/testing';

import { CloudInitConfigsFacade } from './cloud-init-configs.facade';
import { loadCloudInitConfigs } from './cloud-init-configs.actions';

describe('CloudInitConfigsFacade', () => {
  let facade: CloudInitConfigsFacade;
  let store: MockStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [CloudInitConfigsFacade, provideMockStore()],
    });

    facade = TestBed.inject(CloudInitConfigsFacade);
    store = TestBed.inject(MockStore);
    jest.spyOn(store, 'dispatch');
  });

  it('dispatches loadCloudInitConfigs', () => {
    facade.loadCloudInitConfigs();
    expect(store.dispatch).toHaveBeenCalledWith(loadCloudInitConfigs({ params: undefined }));
  });
});
