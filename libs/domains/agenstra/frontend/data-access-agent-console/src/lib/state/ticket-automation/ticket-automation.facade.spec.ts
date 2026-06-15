import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';

import {
  approveTicketAutomation,
  cancelTicketAutomationRun,
  clearTicketAutomation,
  clearTicketAutomationError,
  loadTicketAutomation,
  loadTicketAutomationRunDetail,
  loadTicketAutomationRuns,
  patchTicketAutomation,
  unapproveTicketAutomation,
} from './ticket-automation.actions';
import { TicketAutomationFacade } from './ticket-automation.facade';

describe('TicketAutomationFacade', () => {
  let facade: TicketAutomationFacade;
  let store: jest.Mocked<Store>;

  beforeEach(() => {
    store = {
      select: jest.fn().mockReturnValue(of(null)),
      dispatch: jest.fn(),
    } as unknown as jest.Mocked<Store>;

    TestBed.configureTestingModule({
      providers: [TicketAutomationFacade, { provide: Store, useValue: store }],
    });

    facade = TestBed.inject(TicketAutomationFacade);
  });

  it('dispatches loadConfig', () => {
    facade.loadConfig('t1');
    expect(store.dispatch).toHaveBeenCalledWith(loadTicketAutomation({ ticketId: 't1' }));
  });

  it('dispatches patchConfig', () => {
    const dto = { eligible: true };

    facade.patchConfig('t1', dto);
    expect(store.dispatch).toHaveBeenCalledWith(patchTicketAutomation({ ticketId: 't1', dto }));
  });

  it('dispatches approve', () => {
    facade.approve('t1');
    expect(store.dispatch).toHaveBeenCalledWith(approveTicketAutomation({ ticketId: 't1' }));
  });

  it('dispatches unapprove', () => {
    facade.unapprove('t1');
    expect(store.dispatch).toHaveBeenCalledWith(unapproveTicketAutomation({ ticketId: 't1' }));
  });

  it('dispatches loadRuns', () => {
    facade.loadRuns('t1');
    expect(store.dispatch).toHaveBeenCalledWith(loadTicketAutomationRuns({ ticketId: 't1' }));
  });

  it('dispatches loadRunDetail', () => {
    facade.loadRunDetail('t1', 'r1');
    expect(store.dispatch).toHaveBeenCalledWith(loadTicketAutomationRunDetail({ ticketId: 't1', runId: 'r1' }));
  });

  it('dispatches cancelRun', () => {
    facade.cancelRun('t1', 'r1');
    expect(store.dispatch).toHaveBeenCalledWith(cancelTicketAutomationRun({ ticketId: 't1', runId: 'r1' }));
  });

  it('dispatches clearError and clear', () => {
    facade.clearError();
    expect(store.dispatch).toHaveBeenCalledWith(clearTicketAutomationError());
    facade.clear();
    expect(store.dispatch).toHaveBeenCalledWith(clearTicketAutomation());
  });
});
