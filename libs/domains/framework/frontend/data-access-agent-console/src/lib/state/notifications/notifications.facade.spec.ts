import { TestBed } from '@angular/core/testing';
import { provideMockStore, MockStore } from '@ngrx/store/testing';
import { firstValueFrom } from 'rxjs';

import {
  connectNotificationsSocket,
  disconnectNotificationsSocket,
  markEnvironmentRead,
  setActiveEnvironment,
} from './notifications.actions';
import { NotificationsFacade } from './notifications.facade';
import type { NotificationsState } from './notifications.reducer';

describe('NotificationsFacade', () => {
  let facade: NotificationsFacade;
  let store: MockStore<{ notifications: NotificationsState }>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        NotificationsFacade,
        provideMockStore({
          initialState: {
            notifications: {
              spacesHasAttention: true,
              socketConnected: false,
              socketConnecting: false,
              socketError: null,
              environmentsByKey: {
                'c1:a1': {
                  clientId: 'c1',
                  agentId: 'a1',
                  hasUnreadMessages: true,
                  gitDirty: false,
                  gitConflict: false,
                },
              },
              clientsById: {
                c1: { clientId: 'c1', hasUnreadMessages: true, gitDirty: true },
              },
              activeEnvironment: null,
            },
          },
        }),
      ],
    });

    facade = TestBed.inject(NotificationsFacade);
    store = TestBed.inject(MockStore);
  });

  it('should be created', () => {
    expect(facade).toBeTruthy();
  });

  it('connectSocket dispatches connectNotificationsSocket', () => {
    const spy = jest.spyOn(store, 'dispatch');

    facade.connectSocket();

    expect(spy).toHaveBeenCalledWith(connectNotificationsSocket());
  });

  it('disconnectSocket dispatches disconnectNotificationsSocket', () => {
    const spy = jest.spyOn(store, 'dispatch');

    facade.disconnectSocket();

    expect(spy).toHaveBeenCalledWith(disconnectNotificationsSocket());
  });

  it('markEnvironmentRead dispatches action with ids', () => {
    const spy = jest.spyOn(store, 'dispatch');

    facade.markEnvironmentRead('c1', 'a1');

    expect(spy).toHaveBeenCalledWith(markEnvironmentRead({ clientId: 'c1', agentId: 'a1' }));
  });

  it('setActiveEnvironment dispatches action', () => {
    const spy = jest.spyOn(store, 'dispatch');

    facade.setActiveEnvironment('c1', 'a1');

    expect(spy).toHaveBeenCalledWith(setActiveEnvironment({ clientId: 'c1', agentId: 'a1' }));
  });

  it('exposes attention and status selectors', async () => {
    expect(await firstValueFrom(facade.spacesAttentionBadge$)).toBe('both');
    expect(await firstValueFrom(facade.getClientHasUnread$('c1'))).toBe(true);
    expect(await firstValueFrom(facade.getClientGitDirty$('c1'))).toBe(true);
    expect(await firstValueFrom(facade.getEnvironmentHasUnread$('c1', 'a1'))).toBe(true);
    expect(await firstValueFrom(facade.getEnvironmentGitDirty$('c1', 'a1'))).toBe(false);
    expect(await firstValueFrom(facade.getClientAttentionBadge$('c1'))).toBe('both');
    expect(await firstValueFrom(facade.getEnvironmentAttentionBadge$('c1', 'a1'))).toBe('unread');
    expect(await firstValueFrom(facade.getEnvironmentStatus$('c1', 'a1'))).toMatchObject({
      clientId: 'c1',
      agentId: 'a1',
    });
  });
});
