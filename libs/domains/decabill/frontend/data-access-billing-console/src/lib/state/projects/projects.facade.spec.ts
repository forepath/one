import { TestBed } from '@angular/core/testing';
import { provideMockStore, MockStore } from '@ngrx/store/testing';

import { loadProjects, loadAdminProjects, createAdminProject, billProjectTime } from './projects.actions';
import { ProjectsFacade } from './projects.facade';

describe('ProjectsFacade', () => {
  let facade: ProjectsFacade;
  let store: MockStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [ProjectsFacade, provideMockStore()],
    });
    facade = TestBed.inject(ProjectsFacade);
    store = TestBed.inject(MockStore);
    jest.spyOn(store, 'dispatch');
  });

  it('loadProjects dispatches loadProjects', () => {
    facade.loadProjects();
    expect(store.dispatch).toHaveBeenCalledWith(loadProjects());
  });

  it('loadAdminProjects dispatches loadAdminProjects', () => {
    facade.loadAdminProjects();
    expect(store.dispatch).toHaveBeenCalledWith(loadAdminProjects());
  });

  it('createAdminProject dispatches createAdminProject', () => {
    const dto = { userId: 'u-1', name: 'Alpha', hourlyRateNet: 100 };
    facade.createAdminProject(dto);
    expect(store.dispatch).toHaveBeenCalledWith(createAdminProject({ dto }));
  });

  it('billProjectTime dispatches billProjectTime', () => {
    const dto = {
      from: '2026-06-01T08:00:00.000Z',
      to: '2026-06-01T17:00:00.000Z',
      lineItems: [{ description: 'Extra', quantity: 1, unitPriceNet: 10 }],
    };
    facade.billProjectTime('p-1', dto);
    expect(store.dispatch).toHaveBeenCalledWith(billProjectTime({ projectId: 'p-1', dto }));
  });
});
