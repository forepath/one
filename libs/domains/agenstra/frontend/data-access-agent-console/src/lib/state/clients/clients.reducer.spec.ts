import {
  addClientUserSuccess,
  clearActiveClient,
  createClient,
  createClientFailure,
  createClientSuccess,
  deleteClient,
  deleteClientFailure,
  deleteClientSuccess,
  loadClient,
  loadClientFailure,
  loadClients,
  loadClientsBatch,
  loadClientsFailure,
  loadClientsSuccess,
  loadClientSuccess,
  loadClientUsers,
  loadClientUsersSuccess,
  loadServerInfo,
  loadServerInfoFailure,
  loadServerInfoSuccess,
  loadLocations,
  loadLocationsFailure,
  loadLocationsSuccess,
  removeClientUserSuccess,
  setActiveClient,
  setActiveClientFailure,
  setActiveClientSuccess,
  updateClient,
  updateClientFailure,
  updateClientSuccess,
} from './clients.actions';
import { clientsReducer, initialClientsState, type ClientsState } from './clients.reducer';
import type { ClientResponseDto, ServerInfo } from './clients.types';

describe('clientsReducer', () => {
  const mockClient: ClientResponseDto = {
    id: 'client-1',
    name: 'Test Client',
    description: 'Test Description',
    endpoint: 'https://example.com/api',
    authenticationType: 'api_key',
    isAutoProvisioned: false,
    canManageWorkspaceConfiguration: true,
    config: {
      gitRepositoryUrl: 'https://github.com/user/repo.git',
      agentTypes: [{ type: 'cursor', displayName: 'Cursor' }],
    },
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };
  const mockClient2: ClientResponseDto = {
    id: 'client-2',
    name: 'Test Client 2',
    endpoint: 'https://example2.com/api',
    authenticationType: 'keycloak',
    isAutoProvisioned: false,
    canManageWorkspaceConfiguration: true,
    config: {
      gitRepositoryUrl: 'https://github.com/user2/repo2.git',
      agentTypes: [{ type: 'cursor', displayName: 'Cursor' }],
    },
    createdAt: '2024-01-02T00:00:00Z',
    updatedAt: '2024-01-02T00:00:00Z',
  };

  describe('initial state', () => {
    it('should return the initial state', () => {
      const action = { type: 'UNKNOWN' };
      const state = clientsReducer(undefined, action as any);

      expect(state).toEqual(initialClientsState);
    });
  });

  describe('loadClients', () => {
    it('should set loading to true, preserve existing clients, and clear error', () => {
      const state: ClientsState = {
        ...initialClientsState,
        entities: [mockClient],
        error: 'Previous error',
      };
      const newState = clientsReducer(state, loadClients({}));

      expect(newState.loading).toBe(true);
      expect(newState.entities).toEqual([mockClient]);
      expect(newState.error).toBeNull();
    });
  });

  describe('loadClientsBatch', () => {
    it('should accumulate clients and keep loading true', () => {
      const state: ClientsState = {
        ...initialClientsState,
        loading: true,
        entities: [mockClient],
      };
      const accumulatedClients = [mockClient, mockClient2];
      const newState = clientsReducer(state, loadClientsBatch({ offset: 10, accumulatedClients }));

      expect(newState.entities).toEqual(accumulatedClients);
      expect(newState.loading).toBe(true);
      expect(newState.error).toBeNull();
    });
  });

  describe('loadClientsSuccess', () => {
    it('should set entities and set loading to false', () => {
      const state: ClientsState = {
        ...initialClientsState,
        loading: true,
      };
      const newState = clientsReducer(state, loadClientsSuccess({ clients: [mockClient, mockClient2] }));

      expect(newState.entities).toEqual([mockClient, mockClient2]);
      expect(newState.loading).toBe(false);
      expect(newState.error).toBeNull();
    });
  });

  describe('loadClientsFailure', () => {
    it('should set error and set loading to false', () => {
      const state: ClientsState = {
        ...initialClientsState,
        loading: true,
      };
      const newState = clientsReducer(state, loadClientsFailure({ error: 'Load failed' }));

      expect(newState.error).toBe('Load failed');
      expect(newState.loading).toBe(false);
    });
  });

  describe('loadClient', () => {
    it('should set loadingClient to true and clear error', () => {
      const state: ClientsState = {
        ...initialClientsState,
        error: 'Previous error',
      };
      const newState = clientsReducer(state, loadClient({ id: 'client-1' }));

      expect(newState.loadingClient).toBe(true);
      expect(newState.error).toBeNull();
    });
  });

  describe('loadClientSuccess', () => {
    it('should set selectedClient and update entity in list', () => {
      const state: ClientsState = {
        ...initialClientsState,
        entities: [mockClient],
        loadingClient: true,
      };
      const updatedClient = { ...mockClient, name: 'Updated Name' };
      const newState = clientsReducer(state, loadClientSuccess({ client: updatedClient }));

      expect(newState.selectedClient).toEqual(updatedClient);
      expect(newState.entities[0]).toEqual(updatedClient);
      expect(newState.loadingClient).toBe(false);
    });

    it('should add client to entities if not present', () => {
      const state: ClientsState = {
        ...initialClientsState,
        entities: [],
        loadingClient: true,
      };
      const newState = clientsReducer(state, loadClientSuccess({ client: mockClient }));

      expect(newState.selectedClient).toEqual(mockClient);
      expect(newState.entities).toContainEqual(mockClient);
    });
  });

  describe('loadClientFailure', () => {
    it('should set error and set loadingClient to false', () => {
      const state: ClientsState = {
        ...initialClientsState,
        loadingClient: true,
      };
      const newState = clientsReducer(state, loadClientFailure({ error: 'Load failed' }));

      expect(newState.error).toBe('Load failed');
      expect(newState.loadingClient).toBe(false);
    });
  });

  describe('createClient', () => {
    it('should set creating to true and clear error', () => {
      const state: ClientsState = {
        ...initialClientsState,
        error: 'Previous error',
      };
      const newState = clientsReducer(state, createClient({ client: {} as any }));

      expect(newState.creating).toBe(true);
      expect(newState.error).toBeNull();
    });
  });

  describe('createClientSuccess', () => {
    it('should add client to entities and set selectedClient', () => {
      const state: ClientsState = {
        ...initialClientsState,
        entities: [mockClient],
        creating: true,
      };
      const newState = clientsReducer(state, createClientSuccess({ client: { ...mockClient2, apiKey: 'key' } }));

      expect(newState.entities).toContainEqual({ ...mockClient2, apiKey: 'key' });
      expect(newState.selectedClient).toEqual({ ...mockClient2, apiKey: 'key' });
      expect(newState.creating).toBe(false);
    });
  });

  describe('createClientFailure', () => {
    it('should set error and set creating to false', () => {
      const state: ClientsState = {
        ...initialClientsState,
        creating: true,
      };
      const newState = clientsReducer(state, createClientFailure({ error: 'Create failed' }));

      expect(newState.error).toBe('Create failed');
      expect(newState.creating).toBe(false);
    });
  });

  describe('updateClient', () => {
    it('should set updating to true and clear error', () => {
      const state: ClientsState = {
        ...initialClientsState,
        error: 'Previous error',
      };
      const newState = clientsReducer(state, updateClient({ id: 'client-1', client: {} }));

      expect(newState.updating).toBe(true);
      expect(newState.error).toBeNull();
    });
  });

  describe('updateClientSuccess', () => {
    it('should update client in entities', () => {
      const state: ClientsState = {
        ...initialClientsState,
        entities: [mockClient],
        updating: true,
      };
      const updatedClient = { ...mockClient, name: 'Updated Name' };
      const newState = clientsReducer(state, updateClientSuccess({ client: updatedClient }));

      expect(newState.entities[0]).toEqual(updatedClient);
      expect(newState.updating).toBe(false);
    });

    it('should update selectedClient if it matches', () => {
      const state: ClientsState = {
        ...initialClientsState,
        entities: [mockClient],
        selectedClient: mockClient,
        updating: true,
      };
      const updatedClient = { ...mockClient, name: 'Updated Name' };
      const newState = clientsReducer(state, updateClientSuccess({ client: updatedClient }));

      expect(newState.selectedClient).toEqual(updatedClient);
    });

    it('should not update selectedClient if it does not match', () => {
      const state: ClientsState = {
        ...initialClientsState,
        entities: [mockClient, mockClient2],
        selectedClient: mockClient2,
        updating: true,
      };
      const updatedClient = { ...mockClient, name: 'Updated Name' };
      const newState = clientsReducer(state, updateClientSuccess({ client: updatedClient }));

      expect(newState.selectedClient).toEqual(mockClient2);
    });
  });

  describe('updateClientFailure', () => {
    it('should set error and set updating to false', () => {
      const state: ClientsState = {
        ...initialClientsState,
        updating: true,
      };
      const newState = clientsReducer(state, updateClientFailure({ error: 'Update failed' }));

      expect(newState.error).toBe('Update failed');
      expect(newState.updating).toBe(false);
    });
  });

  describe('deleteClient', () => {
    it('should set deleting to true and clear error', () => {
      const state: ClientsState = {
        ...initialClientsState,
        error: 'Previous error',
      };
      const newState = clientsReducer(state, deleteClient({ id: 'client-1' }));

      expect(newState.deleting).toBe(true);
      expect(newState.error).toBeNull();
    });
  });

  describe('deleteClientSuccess', () => {
    it('should remove client from entities', () => {
      const state: ClientsState = {
        ...initialClientsState,
        entities: [mockClient, mockClient2],
        deleting: true,
      };
      const newState = clientsReducer(state, deleteClientSuccess({ id: 'client-1' }));

      expect(newState.entities).not.toContainEqual(mockClient);
      expect(newState.entities).toContainEqual(mockClient2);
      expect(newState.deleting).toBe(false);
    });

    it('should clear selectedClient if it matches deleted id', () => {
      const state: ClientsState = {
        ...initialClientsState,
        entities: [mockClient],
        selectedClient: mockClient,
        deleting: true,
      };
      const newState = clientsReducer(state, deleteClientSuccess({ id: 'client-1' }));

      expect(newState.selectedClient).toBeNull();
    });

    it('should clear activeClientId if it matches deleted id', () => {
      const state: ClientsState = {
        ...initialClientsState,
        entities: [mockClient],
        activeClientId: 'client-1',
        deleting: true,
      };
      const newState = clientsReducer(state, deleteClientSuccess({ id: 'client-1' }));

      expect(newState.activeClientId).toBeNull();
    });
  });

  describe('deleteClientFailure', () => {
    it('should set error and set deleting to false', () => {
      const state: ClientsState = {
        ...initialClientsState,
        deleting: true,
      };
      const newState = clientsReducer(state, deleteClientFailure({ error: 'Delete failed' }));

      expect(newState.error).toBe('Delete failed');
      expect(newState.deleting).toBe(false);
    });
  });

  describe('setActiveClient', () => {
    it('should clear error', () => {
      const state: ClientsState = {
        ...initialClientsState,
        error: 'Previous error',
      };
      const newState = clientsReducer(state, setActiveClient({ id: 'client-1' }));

      expect(newState.error).toBeNull();
    });
  });

  describe('setActiveClientSuccess', () => {
    it('should set activeClientId', () => {
      const state: ClientsState = {
        ...initialClientsState,
      };
      const newState = clientsReducer(state, setActiveClientSuccess({ id: 'client-1' }));

      expect(newState.activeClientId).toBe('client-1');
      expect(newState.error).toBeNull();
    });
  });

  describe('setActiveClientFailure', () => {
    it('should set error', () => {
      const state: ClientsState = {
        ...initialClientsState,
      };
      const newState = clientsReducer(state, setActiveClientFailure({ error: 'Set active failed' }));

      expect(newState.error).toBe('Set active failed');
    });
  });

  describe('clearActiveClient', () => {
    it('should clear activeClientId', () => {
      const state: ClientsState = {
        ...initialClientsState,
        activeClientId: 'client-1',
        error: 'Previous error',
      };
      const newState = clientsReducer(state, clearActiveClient());

      expect(newState.activeClientId).toBeNull();
      expect(newState.error).toBeNull();
    });

    it('should handle clearing when no client is active', () => {
      const state: ClientsState = {
        ...initialClientsState,
        activeClientId: null,
      };
      const newState = clientsReducer(state, clearActiveClient());

      expect(newState.activeClientId).toBeNull();
    });

    it('should not affect other state properties', () => {
      const state: ClientsState = {
        ...initialClientsState,
        entities: [mockClient, mockClient2],
        selectedClient: mockClient,
        activeClientId: 'client-1',
      };
      const newState = clientsReducer(state, clearActiveClient());

      expect(newState.activeClientId).toBeNull();
      expect(newState.entities).toEqual([mockClient, mockClient2]);
      expect(newState.selectedClient).toEqual(mockClient);
    });
  });

  describe('loadServerInfo', () => {
    it('should set loadingServerInfo to true for specific clientId', () => {
      const state: ClientsState = {
        ...initialClientsState,
        loadingServerInfo: {},
      };
      const newState = clientsReducer(state, loadServerInfo({ clientId: 'client-1' }));

      expect(newState.loadingServerInfo['client-1']).toBe(true);
      expect(newState.error).toBeNull();
    });

    it('should preserve loading state for other clients', () => {
      const state: ClientsState = {
        ...initialClientsState,
        loadingServerInfo: { 'client-2': true },
      };
      const newState = clientsReducer(state, loadServerInfo({ clientId: 'client-1' }));

      expect(newState.loadingServerInfo['client-1']).toBe(true);
      expect(newState.loadingServerInfo['client-2']).toBe(true);
    });
  });

  describe('loadServerInfoSuccess', () => {
    it('should set serverInfo for specific clientId and set loading to false', () => {
      const mockServerInfo: ServerInfo = {
        serverId: 'server-1',
        serverName: 'Test Server',
        publicIp: '1.2.3.4',
        providerType: 'hetzner',
      };
      const state: ClientsState = {
        ...initialClientsState,
        loadingServerInfo: { 'client-1': true },
        serverInfo: {},
      };
      const newState = clientsReducer(
        state,
        loadServerInfoSuccess({ clientId: 'client-1', serverInfo: mockServerInfo }),
      );

      expect(newState.serverInfo['client-1']).toEqual(mockServerInfo);
      expect(newState.loadingServerInfo['client-1']).toBe(false);
      expect(newState.error).toBeNull();
    });

    it('should preserve serverInfo for other clients', () => {
      const existingServerInfo: ServerInfo = {
        serverId: 'server-2',
        providerType: 'hetzner',
      };
      const newServerInfo: ServerInfo = {
        serverId: 'server-1',
        providerType: 'hetzner',
      };
      const state: ClientsState = {
        ...initialClientsState,
        loadingServerInfo: { 'client-1': true, 'client-2': false },
        serverInfo: { 'client-2': existingServerInfo },
      };
      const newState = clientsReducer(
        state,
        loadServerInfoSuccess({ clientId: 'client-1', serverInfo: newServerInfo }),
      );

      expect(newState.serverInfo['client-1']).toEqual(newServerInfo);
      expect(newState.serverInfo['client-2']).toEqual(existingServerInfo);
    });
  });

  describe('loadServerInfoFailure', () => {
    it('should set loadingServerInfo to false for specific clientId', () => {
      const state: ClientsState = {
        ...initialClientsState,
        loadingServerInfo: { 'client-1': true, 'client-2': true },
      };
      const newState = clientsReducer(state, loadServerInfoFailure({ clientId: 'client-1', error: 'Load failed' }));

      expect(newState.loadingServerInfo['client-1']).toBe(false);
      expect(newState.loadingServerInfo['client-2']).toBe(true); // Other client still loading
      expect(newState.error).toBe('Load failed');
    });

    it('should preserve existing error state when error is empty (404 case)', () => {
      const state: ClientsState = {
        ...initialClientsState,
        loadingServerInfo: { 'client-1': true },
        error: 'Previous error',
      };
      const newState = clientsReducer(state, loadServerInfoFailure({ clientId: 'client-1', error: '' }));

      expect(newState.loadingServerInfo['client-1']).toBe(false);
      expect(newState.error).toBe('Previous error'); // Preserved
    });

    it('should set error when error message is provided', () => {
      const state: ClientsState = {
        ...initialClientsState,
        loadingServerInfo: { 'client-1': true },
        error: null,
      };
      const newState = clientsReducer(state, loadServerInfoFailure({ clientId: 'client-1', error: 'Network error' }));

      expect(newState.loadingServerInfo['client-1']).toBe(false);
      expect(newState.error).toBe('Network error');
    });
  });

  describe('loadClientUsers', () => {
    it('should set loadingClientUsers to true for clientId', () => {
      const state: ClientsState = { ...initialClientsState };
      const newState = clientsReducer(state, loadClientUsers({ clientId: 'client-1' }));

      expect(newState.loadingClientUsers['client-1']).toBe(true);
    });
  });

  describe('loadLocations', () => {
    it('should set loadingLocations to true for providerType', () => {
      const state: ClientsState = { ...initialClientsState };
      const newState = clientsReducer(state, loadLocations({ providerType: 'hetzner' }));

      expect(newState.loadingLocations['hetzner']).toBe(true);
      expect(newState.error).toBeNull();
    });
  });

  describe('loadLocationsSuccess', () => {
    it('should store locations and clear loading flag', () => {
      const locations = [{ id: 'fsn1', name: 'Falkenstein', country: 'DE' }];
      const state: ClientsState = {
        ...initialClientsState,
        loadingLocations: { hetzner: true },
      };
      const newState = clientsReducer(state, loadLocationsSuccess({ providerType: 'hetzner', locations }));

      expect(newState.locations['hetzner']).toEqual(locations);
      expect(newState.loadingLocations['hetzner']).toBe(false);
    });
  });

  describe('loadLocationsFailure', () => {
    it('should clear loading flags and set error', () => {
      const state: ClientsState = {
        ...initialClientsState,
        loadingLocations: { hetzner: true, 'digital-ocean': true },
      };
      const newState = clientsReducer(state, loadLocationsFailure({ error: 'Load failed' }));

      expect(newState.loadingLocations['hetzner']).toBe(false);
      expect(newState.loadingLocations['digital-ocean']).toBe(false);
      expect(newState.error).toBe('Load failed');
    });
  });

  describe('loadClientUsersSuccess', () => {
    it('should set clientUsers and set loading to false', () => {
      const users = [
        {
          id: 'rel-1',
          userId: 'user-1',
          clientId: 'client-1',
          role: 'user' as const,
          userEmail: 'a@test.com',
          createdAt: '2024-01-01',
          updatedAt: '2024-01-01',
        },
      ];
      const state: ClientsState = {
        ...initialClientsState,
        loadingClientUsers: { 'client-1': true },
      };
      const newState = clientsReducer(state, loadClientUsersSuccess({ clientId: 'client-1', users }));

      expect(newState.clientUsers['client-1']).toEqual(users);
      expect(newState.loadingClientUsers['client-1']).toBe(false);
    });
  });

  describe('addClientUserSuccess', () => {
    it('should append user to clientUsers', () => {
      const existingUser = {
        id: 'rel-1',
        userId: 'user-1',
        clientId: 'client-1',
        role: 'user' as const,
        createdAt: '2024-01-01',
        updatedAt: '2024-01-01',
      };
      const newUser = {
        id: 'rel-2',
        userId: 'user-2',
        clientId: 'client-1',
        role: 'admin' as const,
        userEmail: 'b@test.com',
        createdAt: '2024-01-02',
        updatedAt: '2024-01-02',
      };
      const state: ClientsState = {
        ...initialClientsState,
        clientUsers: { 'client-1': [existingUser] },
        addingClientUser: { 'client-1': true },
      };
      const newState = clientsReducer(state, addClientUserSuccess({ clientId: 'client-1', user: newUser }));

      expect(newState.clientUsers['client-1']).toHaveLength(2);
      expect(newState.clientUsers['client-1']).toContainEqual(newUser);
      expect(newState.addingClientUser['client-1']).toBe(false);
    });
  });

  describe('removeClientUserSuccess', () => {
    it('should remove user from clientUsers', () => {
      const users = [
        {
          id: 'rel-1',
          userId: 'user-1',
          clientId: 'client-1',
          role: 'user' as const,
          createdAt: '2024-01-01',
          updatedAt: '2024-01-01',
        },
        {
          id: 'rel-2',
          userId: 'user-2',
          clientId: 'client-1',
          role: 'admin' as const,
          createdAt: '2024-01-02',
          updatedAt: '2024-01-02',
        },
      ];
      const state: ClientsState = {
        ...initialClientsState,
        clientUsers: { 'client-1': users },
        removingClientUser: { 'rel-2': true },
      };
      const newState = clientsReducer(
        state,
        removeClientUserSuccess({ clientId: 'client-1', relationshipId: 'rel-2' }),
      );

      expect(newState.clientUsers['client-1']).toHaveLength(1);
      expect(newState.clientUsers['client-1'][0].id).toBe('rel-1');
      expect(newState.removingClientUser['rel-2']).toBeUndefined();
    });
  });
});
