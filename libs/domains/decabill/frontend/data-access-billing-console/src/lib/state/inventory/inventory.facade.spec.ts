import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';

import { connectInventorySocket, disconnectInventorySocket } from './inventory.actions';
import { InventoryFacade } from './inventory.facade';

describe('InventoryFacade live connection', () => {
  const store = { dispatch: jest.fn(), select: jest.fn() };
  let facade: InventoryFacade;

  beforeEach(() => {
    jest.useFakeTimers();
    store.dispatch.mockClear();
    TestBed.configureTestingModule({ providers: [InventoryFacade, { provide: Store, useValue: store }] });
    facade = TestBed.inject(InventoryFacade);
  });

  afterEach(() => jest.useRealTimers());

  it('keeps one connection across page swaps', () => {
    facade.connectLive();
    facade.disconnectLive();
    facade.connectLive();
    jest.advanceTimersByTime(5000);

    expect(store.dispatch.mock.calls.map(([action]) => action.type)).toEqual([connectInventorySocket.type]);
  });

  it('disconnects after the last page leaves', () => {
    facade.connectLive();
    facade.disconnectLive();
    jest.advanceTimersByTime(1500);

    expect(store.dispatch).toHaveBeenLastCalledWith(disconnectInventorySocket());
  });
});
