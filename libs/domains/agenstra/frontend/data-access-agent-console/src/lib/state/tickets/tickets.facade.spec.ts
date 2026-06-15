import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';

import {
  addTicketComment,
  clearTicketsError,
  closeTicketDetail,
  createTicket,
  deleteTicket,
  loadTickets,
  migrateTicket,
  openTicketDetail,
  updateTicket,
} from './tickets.actions';
import { TicketsFacade } from './tickets.facade';
import {
  EMPTY_TICKET_TASKS,
  type CreateTicketDto,
  type TicketResponseDto,
  type UpdateTicketDto,
} from './tickets.types';

describe('TicketsFacade', () => {
  let facade: TicketsFacade;
  let store: jest.Mocked<Store>;
  const mockTicket: TicketResponseDto = {
    id: 'ticket-1',
    clientId: 'client-1',
    title: 'Example',
    priority: 'medium',
    status: 'draft',
    automationEligible: false,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    tasks: EMPTY_TICKET_TASKS,
  };
  const mockBoardRows = {
    draft: [{ ticket: mockTicket, depth: 0 }],
    todo: [] as { ticket: TicketResponseDto; depth: number }[],
    in_progress: [] as { ticket: TicketResponseDto; depth: number }[],
    prototype: [] as { ticket: TicketResponseDto; depth: number }[],
  };
  const createFacadeWithMock = <T>(mockSelectReturn: T): TicketsFacade => {
    const mockStore = {
      select: jest.fn().mockReturnValue(of(mockSelectReturn)),
      dispatch: jest.fn(),
    } as unknown as Store;

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [TicketsFacade, { provide: Store, useValue: mockStore }],
    });

    return TestBed.inject(TicketsFacade);
  };

  beforeEach(() => {
    store = {
      select: jest.fn().mockReturnValue(of(null)),
      dispatch: jest.fn(),
    } as unknown as jest.Mocked<Store>;

    TestBed.configureTestingModule({
      providers: [TicketsFacade, { provide: Store, useValue: store }],
    });

    facade = TestBed.inject(TicketsFacade);
  });

  describe('state observables', () => {
    it('exposes tickets$', (done) => {
      const list = [mockTicket];

      createFacadeWithMock(list).tickets$.subscribe((result) => {
        expect(result).toEqual(list);
        done();
      });
    });

    it('exposes ticketsBoardRowsByStatus$', (done) => {
      createFacadeWithMock(mockBoardRows).ticketsBoardRowsByStatus$.subscribe((result) => {
        expect(result).toEqual(mockBoardRows);
        done();
      });
    });

    it('exposes loadingList$', (done) => {
      createFacadeWithMock(true).loadingList$.subscribe((result) => {
        expect(result).toBe(true);
        done();
      });
    });

    it('exposes selectedTicketId$', (done) => {
      createFacadeWithMock('ticket-1').selectedTicketId$.subscribe((result) => {
        expect(result).toBe('ticket-1');
        done();
      });
    });

    it('exposes detail$', (done) => {
      createFacadeWithMock(mockTicket).detail$.subscribe((result) => {
        expect(result).toEqual(mockTicket);
        done();
      });
    });

    it('exposes comments$', (done) => {
      const comments = [
        {
          id: 'c1',
          ticketId: 'ticket-1',
          body: 'x',
          createdAt: '2024-01-01T00:00:00Z',
        },
      ];

      createFacadeWithMock(comments).comments$.subscribe((result) => {
        expect(result).toEqual(comments);
        done();
      });
    });

    it('exposes activity$', (done) => {
      const activity = [
        {
          id: 'a1',
          ticketId: 'ticket-1',
          occurredAt: '2024-01-01T00:00:00Z',
          actorType: 'system' as const,
          actionType: 'created',
          payload: {},
        },
      ];

      createFacadeWithMock(activity).activity$.subscribe((result) => {
        expect(result).toEqual(activity);
        done();
      });
    });

    it('exposes loadingDetail$', (done) => {
      createFacadeWithMock(false).loadingDetail$.subscribe((result) => {
        expect(result).toBe(false);
        done();
      });
    });

    it('exposes saving$', (done) => {
      createFacadeWithMock(true).saving$.subscribe((result) => {
        expect(result).toBe(true);
        done();
      });
    });

    it('exposes error$', (done) => {
      createFacadeWithMock('oops').error$.subscribe((result) => {
        expect(result).toBe('oops');
        done();
      });
    });
  });

  describe('action methods', () => {
    it('dispatches loadTickets with params', () => {
      const params = { clientId: 'client-1', parentId: null };

      facade.loadTickets(params);
      expect(store.dispatch).toHaveBeenCalledWith(loadTickets({ params }));
    });

    it('dispatches loadTickets without params', () => {
      facade.loadTickets();
      expect(store.dispatch).toHaveBeenCalledWith(loadTickets({ params: undefined }));
    });

    it('dispatches openTicketDetail', () => {
      facade.openDetail('ticket-1');
      expect(store.dispatch).toHaveBeenCalledWith(openTicketDetail({ id: 'ticket-1' }));
    });

    it('dispatches closeTicketDetail', () => {
      facade.closeDetail();
      expect(store.dispatch).toHaveBeenCalledWith(closeTicketDetail());
    });

    it('dispatches createTicket', () => {
      const dto: CreateTicketDto = { clientId: 'c1', title: 'New', status: 'todo' };

      facade.create(dto);
      expect(store.dispatch).toHaveBeenCalledWith(createTicket({ dto }));
    });

    it('dispatches updateTicket', () => {
      const dto: UpdateTicketDto = { status: 'done' };

      facade.update('ticket-1', dto);
      expect(store.dispatch).toHaveBeenCalledWith(updateTicket({ id: 'ticket-1', dto }));
    });

    it('dispatches migrateTicket', () => {
      facade.migrateTicket('ticket-1', 'client-2');
      expect(store.dispatch).toHaveBeenCalledWith(migrateTicket({ id: 'ticket-1', targetClientId: 'client-2' }));
    });

    it('dispatches deleteTicket', () => {
      facade.remove('ticket-1');
      expect(store.dispatch).toHaveBeenCalledWith(deleteTicket({ id: 'ticket-1' }));
    });

    it('dispatches deleteTicket with releaseExternalSyncMarker', () => {
      facade.remove('ticket-1', true);
      expect(store.dispatch).toHaveBeenCalledWith(deleteTicket({ id: 'ticket-1', releaseExternalSyncMarker: true }));
    });

    it('dispatches addTicketComment', () => {
      facade.addComment('ticket-1', 'hello');
      expect(store.dispatch).toHaveBeenCalledWith(addTicketComment({ ticketId: 'ticket-1', body: 'hello' }));
    });

    it('dispatches clearTicketsError', () => {
      facade.clearError();
      expect(store.dispatch).toHaveBeenCalledWith(clearTicketsError());
    });
  });
});
