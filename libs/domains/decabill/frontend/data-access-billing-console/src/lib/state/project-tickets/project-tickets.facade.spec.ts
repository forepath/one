import { TestBed } from '@angular/core/testing';
import { provideMockStore, MockStore } from '@ngrx/store/testing';

import { loadProjectTickets, openProjectTicketDetail } from './project-tickets.actions';
import { ProjectTicketsFacade } from './project-tickets.facade';

describe('ProjectTicketsFacade', () => {
  let facade: ProjectTicketsFacade;
  let store: MockStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [ProjectTicketsFacade, provideMockStore()],
    });
    facade = TestBed.inject(ProjectTicketsFacade);
    store = TestBed.inject(MockStore);
    jest.spyOn(store, 'dispatch');
  });

  it('loadTickets dispatches loadProjectTickets', () => {
    facade.loadTickets({ projectId: 'p-1' });
    expect(store.dispatch).toHaveBeenCalledWith(loadProjectTickets({ params: { projectId: 'p-1' } }));
  });

  it('openDetail dispatches openProjectTicketDetail', () => {
    facade.openDetail('t-1');
    expect(store.dispatch).toHaveBeenCalledWith(openProjectTicketDetail({ id: 't-1' }));
  });
});
