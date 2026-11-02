import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';

import { loadProjectTicketTimeEntries, loadProjectTimeEntries } from './project-time-entries.actions';
import { ProjectTimeEntriesFacade } from './project-time-entries.facade';

describe('ProjectTimeEntriesFacade', () => {
  let facade: ProjectTimeEntriesFacade;
  let store: jest.Mocked<Store>;

  beforeEach(() => {
    store = { select: jest.fn(), dispatch: jest.fn() } as never;

    TestBed.configureTestingModule({
      providers: [ProjectTimeEntriesFacade, { provide: Store, useValue: store }],
    });

    facade = TestBed.inject(ProjectTimeEntriesFacade);
  });

  it('requests page 1 by default and a given page / size (replace-page)', () => {
    facade.load('p-1');
    expect(store.dispatch).toHaveBeenLastCalledWith(
      loadProjectTimeEntries({ projectId: 'p-1', page: undefined, pageSize: undefined }),
    );

    facade.load('p-1', 2, 50);
    expect(store.dispatch).toHaveBeenLastCalledWith(
      loadProjectTimeEntries({ projectId: 'p-1', page: 2, pageSize: 50 }),
    );
  });

  it('keeps the ticket-scoped load for the board', () => {
    facade.loadForTicket('p-1', 't-1');
    expect(store.dispatch).toHaveBeenLastCalledWith(
      loadProjectTicketTimeEntries({ projectId: 'p-1', ticketId: 't-1' }),
    );
  });
});
