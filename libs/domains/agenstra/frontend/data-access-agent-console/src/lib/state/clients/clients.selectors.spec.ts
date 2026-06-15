import { initialClientsState, type ClientsState } from './clients.reducer';
import {
  selectActiveClient,
  selectActiveClientId,
  selectClientById,
  selectClientCreating,
  selectClientDeleting,
  selectClientLoading,
  selectClientUpdating,
  selectClients,
  selectClientsCount,
  selectClientsError,
  selectClientsLoading,
  selectClientsLoadingAny,
  selectClientsState,
  selectClientUsers,
  selectHasClients,
  selectLoadingClientUsers,
  selectSelectedClient,
} from './clients.selectors';
import type { ClientResponseDto } from './clients.types';

describe('Clients Selectors', () => {
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
  const createState = (overrides?: Partial<ClientsState>): ClientsState => ({
    ...initialClientsState,
    ...overrides,
  });

  describe('selectClientsState', () => {
    it('should select the clients feature state', () => {
      const state = createState();
      const rootState = { clients: state };
      const result = selectClientsState(rootState as any);

      expect(result).toEqual(state);
    });
  });

  describe('selectClients', () => {
    it('should select entities', () => {
      const state = createState({ entities: [mockClient, mockClient2] });
      const rootState = { clients: state };
      const result = selectClients(rootState as any);

      expect(result).toEqual([mockClient, mockClient2]);
    });
  });

  describe('selectSelectedClient', () => {
    it('should select selectedClient', () => {
      const state = createState({ selectedClient: mockClient });
      const rootState = { clients: state };
      const result = selectSelectedClient(rootState as any);

      expect(result).toEqual(mockClient);
    });

    it('should return null when no client is selected', () => {
      const state = createState({ selectedClient: null });
      const rootState = { clients: state };
      const result = selectSelectedClient(rootState as any);

      expect(result).toBeNull();
    });
  });

  describe('selectActiveClientId', () => {
    it('should select activeClientId', () => {
      const state = createState({ activeClientId: 'client-1' });
      const rootState = { clients: state };
      const result = selectActiveClientId(rootState as any);

      expect(result).toBe('client-1');
    });
  });

  describe('selectActiveClient', () => {
    it('should select active client from entities', () => {
      const state = createState({
        entities: [mockClient, mockClient2],
        activeClientId: 'client-1',
      });
      const rootState = { clients: state };
      const result = selectActiveClient(rootState as any);

      expect(result).toEqual(mockClient);
    });

    it('should return null when activeClientId is null', () => {
      const state = createState({
        entities: [mockClient],
        activeClientId: null,
      });
      const rootState = { clients: state };
      const result = selectActiveClient(rootState as any);

      expect(result).toBeNull();
    });

    it('should return null when activeClientId does not match any client', () => {
      const state = createState({
        entities: [mockClient],
        activeClientId: 'non-existent',
      });
      const rootState = { clients: state };
      const result = selectActiveClient(rootState as any);

      expect(result).toBeNull();
    });
  });

  describe('selectClientsLoading', () => {
    it('should select loading state', () => {
      const state = createState({ loading: true });
      const rootState = { clients: state };
      const result = selectClientsLoading(rootState as any);

      expect(result).toBe(true);
    });
  });

  describe('selectClientLoading', () => {
    it('should select loadingClient state', () => {
      const state = createState({ loadingClient: true });
      const rootState = { clients: state };
      const result = selectClientLoading(rootState as any);

      expect(result).toBe(true);
    });
  });

  describe('selectClientCreating', () => {
    it('should select creating state', () => {
      const state = createState({ creating: true });
      const rootState = { clients: state };
      const result = selectClientCreating(rootState as any);

      expect(result).toBe(true);
    });
  });

  describe('selectClientUpdating', () => {
    it('should select updating state', () => {
      const state = createState({ updating: true });
      const rootState = { clients: state };
      const result = selectClientUpdating(rootState as any);

      expect(result).toBe(true);
    });
  });

  describe('selectClientDeleting', () => {
    it('should select deleting state', () => {
      const state = createState({ deleting: true });
      const rootState = { clients: state };
      const result = selectClientDeleting(rootState as any);

      expect(result).toBe(true);
    });
  });

  describe('selectClientsLoadingAny', () => {
    it('should return true when any loading state is true', () => {
      const state = createState({ loading: true });
      const rootState = { clients: state };
      const result = selectClientsLoadingAny(rootState as any);

      expect(result).toBe(true);
    });

    it('should return true when loadingClient is true', () => {
      const state = createState({ loadingClient: true });
      const rootState = { clients: state };
      const result = selectClientsLoadingAny(rootState as any);

      expect(result).toBe(true);
    });

    it('should return true when creating is true', () => {
      const state = createState({ creating: true });
      const rootState = { clients: state };
      const result = selectClientsLoadingAny(rootState as any);

      expect(result).toBe(true);
    });

    it('should return false when all loading states are false', () => {
      const state = createState({
        loading: false,
        loadingClient: false,
        creating: false,
        updating: false,
        deleting: false,
      });
      const rootState = { clients: state };
      const result = selectClientsLoadingAny(rootState as any);

      expect(result).toBe(false);
    });
  });

  describe('selectClientsError', () => {
    it('should select error', () => {
      const state = createState({ error: 'Test error' });
      const rootState = { clients: state };
      const result = selectClientsError(rootState as any);

      expect(result).toBe('Test error');
    });

    it('should return null when no error', () => {
      const state = createState({ error: null });
      const rootState = { clients: state };
      const result = selectClientsError(rootState as any);

      expect(result).toBeNull();
    });
  });

  describe('selectClientsCount', () => {
    it('should return the count of clients', () => {
      const state = createState({ entities: [mockClient, mockClient2] });
      const rootState = { clients: state };
      const result = selectClientsCount(rootState as any);

      expect(result).toBe(2);
    });

    it('should return 0 when entities is empty', () => {
      const state = createState({ entities: [] });
      const rootState = { clients: state };
      const result = selectClientsCount(rootState as any);

      expect(result).toBe(0);
    });
  });

  describe('selectClientById', () => {
    it('should return client by id', () => {
      const state = createState({ entities: [mockClient, mockClient2] });
      const rootState = { clients: state };
      const selector = selectClientById('client-1');
      const result = selector(rootState as any);

      expect(result).toEqual(mockClient);
    });

    it('should return null when client not found', () => {
      const state = createState({ entities: [mockClient] });
      const rootState = { clients: state };
      const selector = selectClientById('non-existent');
      const result = selector(rootState as any);

      expect(result).toBeNull();
    });
  });

  describe('selectHasClients', () => {
    it('should return true when clients exist', () => {
      const state = createState({ entities: [mockClient] });
      const rootState = { clients: state };
      const result = selectHasClients(rootState as any);

      expect(result).toBe(true);
    });

    it('should return false when no clients exist', () => {
      const state = createState({ entities: [] });
      const rootState = { clients: state };
      const result = selectHasClients(rootState as any);

      expect(result).toBe(false);
    });
  });

  describe('selectClientUsers', () => {
    it('should return client users for clientId', () => {
      const users = [
        {
          id: 'rel-1',
          userId: 'user-1',
          clientId: 'client-1',
          role: 'user' as const,
          createdAt: '2024-01-01',
          updatedAt: '2024-01-01',
        },
      ];
      const state = createState({ clientUsers: { 'client-1': users } });
      const rootState = { clients: state };
      const selector = selectClientUsers('client-1');
      const result = selector(rootState as any);

      expect(result).toEqual(users);
    });

    it('should return empty array when no users for clientId', () => {
      const state = createState();
      const rootState = { clients: state };
      const selector = selectClientUsers('client-1');
      const result = selector(rootState as any);

      expect(result).toEqual([]);
    });
  });

  describe('selectLoadingClientUsers', () => {
    it('should return loading state for clientId', () => {
      const state = createState({ loadingClientUsers: { 'client-1': true } });
      const rootState = { clients: state };
      const selector = selectLoadingClientUsers('client-1');
      const result = selector(rootState as any);

      expect(result).toBe(true);
    });
  });
});
