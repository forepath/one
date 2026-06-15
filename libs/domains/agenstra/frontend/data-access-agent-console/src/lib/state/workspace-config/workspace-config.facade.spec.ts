import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { provideMockStore } from '@ngrx/store/testing';

import {
  deleteWorkspaceConfigurationOverride,
  loadWorkspaceConfigurationOverrides,
  upsertWorkspaceConfigurationOverride,
} from './workspace-config.actions';
import { WorkspaceConfigFacade } from './workspace-config.facade';

describe('WorkspaceConfigFacade', () => {
  let facade: WorkspaceConfigFacade;
  let store: Store;
  let dispatchSpy: jest.SpyInstance;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [WorkspaceConfigFacade, provideMockStore()],
    });

    facade = TestBed.inject(WorkspaceConfigFacade);
    store = TestBed.inject(Store);
    dispatchSpy = jest.spyOn(store, 'dispatch');
  });

  it('dispatches load action', () => {
    facade.loadSettings('c1');
    expect(dispatchSpy).toHaveBeenCalledWith(loadWorkspaceConfigurationOverrides({ clientId: 'c1' }));
  });

  it('dispatches upsert action', () => {
    facade.upsertSetting('c1', 'gitToken', 'abc');
    expect(dispatchSpy).toHaveBeenCalledWith(
      upsertWorkspaceConfigurationOverride({ clientId: 'c1', settingKey: 'gitToken', dto: { value: 'abc' } }),
    );
  });

  it('dispatches delete action', () => {
    facade.deleteSettingOverride('c1', 'gitToken');
    expect(dispatchSpy).toHaveBeenCalledWith(
      deleteWorkspaceConfigurationOverride({ clientId: 'c1', settingKey: 'gitToken' }),
    );
  });
});
