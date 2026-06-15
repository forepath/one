import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { Store } from '@ngrx/store';
import { of, throwError } from 'rxjs';

import { ClientsService } from '../../services/clients.service';

import {
  addClientUser,
  addClientUserFailure,
  addClientUserSuccess,
  createClient,
  createClientFailure,
  createClientSuccess,
  deleteClient,
  deleteClientFailure,
  deleteClientSuccess,
  loadClient,
  loadClientFailure,
  loadClientUsers,
  loadClientUsersFailure,
  loadClientUsersSuccess,
  loadClients,
  loadClientsBatch,
  loadClientsFailure,
  loadClientsSuccess,
  loadClientSuccess,
  loadServerInfo,
  loadServerInfoFailure,
  loadServerInfoSuccess,
  removeClientUser,
  removeClientUserFailure,
  removeClientUserSuccess,
  setActiveClient,
  setActiveClientSuccess,
  updateClient,
  updateClientFailure,
  updateClientSuccess,
} from './clients.actions';
import {
  addClientUser$,
  createClient$,
  deleteClient$,
  loadClient$,
  loadClientUsers$,
  loadClients$,
  loadClientsBatch$,
  loadServerInfo$,
  removeClientUser$,
  setActiveClient$,
  updateClient$,
} from './clients.effects';
import type {
  ClientResponseDto,
  CreateClientDto,
  CreateClientResponseDto,
  ServerInfo,
  UpdateClientDto,
} from './clients.types';

describe('ClientsEffects', () => {
  let actions$: Actions;
  let clientsService: jest.Mocked<ClientsService>;
  let store: jest.Mocked<Store>;
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
  const mockAutoProvisionedClient: ClientResponseDto = {
    ...mockClient,
    id: 'client-2',
    isAutoProvisioned: true,
  };
  const mockCreateClientResponse: CreateClientResponseDto = {
    ...mockClient,
    apiKey: 'generated-api-key',
  };

  beforeEach(() => {
    clientsService = {
      listClients: jest.fn(),
      getClient: jest.fn(),
      createClient: jest.fn(),
      updateClient: jest.fn(),
      deleteClient: jest.fn(),
      getServerInfo: jest.fn(),
      getClientUsers: jest.fn(),
      addClientUser: jest.fn(),
      removeClientUser: jest.fn(),
    } as any;

    store = {
      select: jest.fn(),
    } as any;

    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() => actions$),
        {
          provide: ClientsService,
          useValue: clientsService,
        },
        {
          provide: Store,
          useValue: store,
        },
      ],
    });

    actions$ = TestBed.inject(Actions);
  });

  describe('loadClients$', () => {
    it('should return loadClientsSuccess when batch is empty', (done) => {
      const clients: ClientResponseDto[] = [];
      const action = loadClients({});
      const outcome = loadClientsSuccess({ clients: [] });

      actions$ = of(action);
      clientsService.listClients.mockReturnValue(of(clients));

      loadClients$(actions$, clientsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        expect(clientsService.listClients).toHaveBeenCalledWith({ limit: 10, offset: 0 });
        done();
      });
    });

    it('should return loadClientsSuccess when batch is partial (< 10)', (done) => {
      const clients: ClientResponseDto[] = [mockClient];
      const action = loadClients({});
      const outcome = loadClientsSuccess({ clients });

      actions$ = of(action);
      clientsService.listClients.mockReturnValue(of(clients));

      loadClients$(actions$, clientsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        expect(clientsService.listClients).toHaveBeenCalledWith({ limit: 10, offset: 0 });
        done();
      });
    });

    it('should return loadClientsBatch when batch is full (10 entries)', (done) => {
      const clients: ClientResponseDto[] = Array.from({ length: 10 }, (_, i) => ({
        ...mockClient,
        id: `client-${i}`,
      }));
      const action = loadClients({});
      const outcome = loadClientsBatch({ offset: 10, accumulatedClients: clients });

      actions$ = of(action);
      clientsService.listClients.mockReturnValue(of(clients));

      loadClients$(actions$, clientsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        expect(clientsService.listClients).toHaveBeenCalledWith({ limit: 10, offset: 0 });
        done();
      });
    });

    it('should ignore user params and use batch params', (done) => {
      const params = { limit: 5, offset: 20 };
      const action = loadClients({ params });
      const clients: ClientResponseDto[] = [mockClient];

      actions$ = of(action);
      clientsService.listClients.mockReturnValue(of(clients));

      loadClients$(actions$, clientsService).subscribe(() => {
        expect(clientsService.listClients).toHaveBeenCalledWith({ limit: 10, offset: 0 });
        done();
      });
    });

    it('should return loadClientsFailure on error', (done) => {
      const action = loadClients({});
      const error = new Error('Load failed');
      const outcome = loadClientsFailure({ error: 'Load failed' });

      actions$ = of(action);
      clientsService.listClients.mockReturnValue(throwError(() => error));

      loadClients$(actions$, clientsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });
  });

  describe('loadClientsBatch$', () => {
    it('should return loadClientsSuccess when batch is empty', (done) => {
      const accumulatedClients: ClientResponseDto[] = [mockClient];
      const newClients: ClientResponseDto[] = [];
      const action = loadClientsBatch({ offset: 10, accumulatedClients });
      const outcome = loadClientsSuccess({ clients: accumulatedClients });

      actions$ = of(action);
      clientsService.listClients.mockReturnValue(of(newClients));

      loadClientsBatch$(actions$, clientsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        expect(clientsService.listClients).toHaveBeenCalledWith({ limit: 10, offset: 10 });
        done();
      });
    });

    it('should return loadClientsSuccess when batch is partial (< 10)', (done) => {
      const accumulatedClients: ClientResponseDto[] = [mockClient];
      const newClients: ClientResponseDto[] = [{ ...mockClient, id: 'client-2' }];
      const action = loadClientsBatch({ offset: 10, accumulatedClients });
      const outcome = loadClientsSuccess({ clients: [...accumulatedClients, ...newClients] });

      actions$ = of(action);
      clientsService.listClients.mockReturnValue(of(newClients));

      loadClientsBatch$(actions$, clientsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        expect(clientsService.listClients).toHaveBeenCalledWith({ limit: 10, offset: 10 });
        done();
      });
    });

    it('should return loadClientsBatch when batch is full (10 entries)', (done) => {
      const accumulatedClients: ClientResponseDto[] = Array.from({ length: 10 }, (_, i) => ({
        ...mockClient,
        id: `client-${i}`,
      }));
      const newClients: ClientResponseDto[] = Array.from({ length: 10 }, (_, i) => ({
        ...mockClient,
        id: `client-${i + 10}`,
      }));
      const action = loadClientsBatch({ offset: 10, accumulatedClients });
      const outcome = loadClientsBatch({
        offset: 20,
        accumulatedClients: [...accumulatedClients, ...newClients],
      });

      actions$ = of(action);
      clientsService.listClients.mockReturnValue(of(newClients));

      loadClientsBatch$(actions$, clientsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        expect(clientsService.listClients).toHaveBeenCalledWith({ limit: 10, offset: 10 });
        done();
      });
    });

    it('should return loadClientsFailure on error', (done) => {
      const accumulatedClients: ClientResponseDto[] = [mockClient];
      const action = loadClientsBatch({ offset: 10, accumulatedClients });
      const error = new Error('Load failed');
      const outcome = loadClientsFailure({ error: 'Load failed' });

      actions$ = of(action);
      clientsService.listClients.mockReturnValue(throwError(() => error));

      loadClientsBatch$(actions$, clientsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });
  });

  describe('loadClient$', () => {
    it('should return loadClientSuccess on success', (done) => {
      const action = loadClient({ id: 'client-1' });
      const outcome = loadClientSuccess({ client: mockClient });

      actions$ = of(action);
      clientsService.getClient.mockReturnValue(of(mockClient));

      loadClient$(actions$, clientsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });

    it('should return loadClientFailure on error', (done) => {
      const action = loadClient({ id: 'client-1' });
      const error = new Error('Load failed');
      const outcome = loadClientFailure({ error: 'Load failed' });

      actions$ = of(action);
      clientsService.getClient.mockReturnValue(throwError(() => error));

      loadClient$(actions$, clientsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });
  });

  describe('createClient$', () => {
    it('should return createClientSuccess on success', (done) => {
      const createDto: CreateClientDto = {
        name: 'New Client',
        endpoint: 'https://example.com/api',
        authenticationType: 'api_key',
      };
      const action = createClient({ client: createDto });
      const outcome = createClientSuccess({ client: mockCreateClientResponse });

      actions$ = of(action);
      clientsService.createClient.mockReturnValue(of(mockCreateClientResponse));

      createClient$(actions$, clientsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });

    it('should return createClientFailure on error', (done) => {
      const createDto: CreateClientDto = {
        name: 'New Client',
        endpoint: 'https://example.com/api',
        authenticationType: 'api_key',
      };
      const action = createClient({ client: createDto });
      const error = new Error('Create failed');
      const outcome = createClientFailure({ error: 'Create failed' });

      actions$ = of(action);
      clientsService.createClient.mockReturnValue(throwError(() => error));

      createClient$(actions$, clientsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });
  });

  describe('updateClient$', () => {
    it('should return updateClientSuccess on success', (done) => {
      const updateDto: UpdateClientDto = { name: 'Updated Client' };
      const action = updateClient({ id: 'client-1', client: updateDto });
      const updatedClient = { ...mockClient, name: 'Updated Client' };
      const outcome = updateClientSuccess({ client: updatedClient });

      actions$ = of(action);
      clientsService.updateClient.mockReturnValue(of(updatedClient));

      updateClient$(actions$, clientsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });

    it('should return updateClientFailure on error', (done) => {
      const updateDto: UpdateClientDto = { name: 'Updated Client' };
      const action = updateClient({ id: 'client-1', client: updateDto });
      const error = new Error('Update failed');
      const outcome = updateClientFailure({ error: 'Update failed' });

      actions$ = of(action);
      clientsService.updateClient.mockReturnValue(throwError(() => error));

      updateClient$(actions$, clientsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });
  });

  describe('deleteClient$', () => {
    it('should return deleteClientSuccess on success', (done) => {
      const action = deleteClient({ id: 'client-1' });
      const outcome = deleteClientSuccess({ id: 'client-1' });

      actions$ = of(action);
      clientsService.deleteClient.mockReturnValue(of(undefined));

      deleteClient$(actions$, clientsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });

    it('should return deleteClientFailure on error', (done) => {
      const action = deleteClient({ id: 'client-1' });
      const error = new Error('Delete failed');
      const outcome = deleteClientFailure({ error: 'Delete failed' });

      actions$ = of(action);
      clientsService.deleteClient.mockReturnValue(throwError(() => error));

      deleteClient$(actions$, clientsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });
  });

  describe('setActiveClient$', () => {
    it('should return setActiveClientSuccess', (done) => {
      const action = setActiveClient({ id: 'client-1' });
      const outcome = setActiveClientSuccess({ id: 'client-1' });

      actions$ = of(action);

      setActiveClient$(actions$).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });
  });

  describe('error normalization', () => {
    it('should normalize Error objects', (done) => {
      const action = loadClients({});
      const error = new Error('Test error');
      const outcome = loadClientsFailure({ error: 'Test error' });

      actions$ = of(action);
      clientsService.listClients.mockReturnValue(throwError(() => error));

      loadClients$(actions$, clientsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });

    it('should normalize string errors', (done) => {
      const action = loadClients({});
      const error = 'String error';
      const outcome = loadClientsFailure({ error: 'String error' });

      actions$ = of(action);
      clientsService.listClients.mockReturnValue(throwError(() => error));

      loadClients$(actions$, clientsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });

    it('should normalize object errors with message property', (done) => {
      const action = loadClients({});
      const error = { message: 'Object error' };
      const outcome = loadClientsFailure({ error: 'Object error' });

      actions$ = of(action);
      clientsService.listClients.mockReturnValue(throwError(() => error));

      loadClients$(actions$, clientsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });

    it('should use default error message for unknown error types', (done) => {
      const action = loadClients({});
      const error = { unknown: 'property' };
      const outcome = loadClientsFailure({ error: 'An unexpected error occurred' });

      actions$ = of(action);
      clientsService.listClients.mockReturnValue(throwError(() => error));

      loadClients$(actions$, clientsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });
  });

  describe('loadServerInfo$', () => {
    const mockServerInfo: ServerInfo = {
      serverId: 'server-1',
      serverName: 'Test Server',
      publicIp: '1.2.3.4',
      providerType: 'hetzner',
    };

    it('should return loadServerInfoSuccess on success when client is auto-provisioned', (done) => {
      const action = loadServerInfo({ clientId: 'client-2' });
      const outcome = loadServerInfoSuccess({ clientId: 'client-2', serverInfo: mockServerInfo });

      actions$ = of(action);
      (store.select as jest.Mock).mockReturnValue(of(mockAutoProvisionedClient));
      clientsService.getServerInfo.mockReturnValue(of(mockServerInfo));

      loadServerInfo$(actions$, clientsService, store).subscribe((result) => {
        expect(result).toEqual(outcome);
        expect(clientsService.getServerInfo).toHaveBeenCalledWith('client-2');
        done();
      });
    });

    it('should skip API call and return failure with empty error when client is not auto-provisioned', (done) => {
      const action = loadServerInfo({ clientId: 'client-1' });
      const outcome = loadServerInfoFailure({ clientId: 'client-1', error: '' });

      actions$ = of(action);
      (store.select as jest.Mock).mockReturnValue(of(mockClient));

      loadServerInfo$(actions$, clientsService, store).subscribe((result) => {
        expect(result).toEqual(outcome);
        expect(clientsService.getServerInfo).not.toHaveBeenCalled();
        done();
      });
    });

    it('should skip API call when client is not found in store', (done) => {
      const action = loadServerInfo({ clientId: 'client-unknown' });
      const outcome = loadServerInfoFailure({ clientId: 'client-unknown', error: '' });

      actions$ = of(action);
      (store.select as jest.Mock).mockReturnValue(of(null));

      loadServerInfo$(actions$, clientsService, store).subscribe((result) => {
        expect(result).toEqual(outcome);
        expect(clientsService.getServerInfo).not.toHaveBeenCalled();
        done();
      });
    });

    it('should return loadServerInfoFailure with empty error for 404 (no provisioning)', (done) => {
      const action = loadServerInfo({ clientId: 'client-2' });
      const error = new HttpErrorResponse({ status: 404, statusText: 'Not Found' });
      const outcome = loadServerInfoFailure({ clientId: 'client-2', error: '' });

      actions$ = of(action);
      (store.select as jest.Mock).mockReturnValue(of(mockAutoProvisionedClient));
      clientsService.getServerInfo.mockReturnValue(throwError(() => error));

      loadServerInfo$(actions$, clientsService, store).subscribe((result) => {
        expect(result).toEqual(outcome);
        expect(clientsService.getServerInfo).toHaveBeenCalledWith('client-2');
        done();
      });
    });

    it('should return loadServerInfoFailure with error message for non-404 errors', (done) => {
      const action = loadServerInfo({ clientId: 'client-2' });
      const error = new Error('Network error');
      const outcome = loadServerInfoFailure({ clientId: 'client-2', error: 'Network error' });

      actions$ = of(action);
      (store.select as jest.Mock).mockReturnValue(of(mockAutoProvisionedClient));
      clientsService.getServerInfo.mockReturnValue(throwError(() => error));

      loadServerInfo$(actions$, clientsService, store).subscribe((result) => {
        expect(result).toEqual(outcome);
        expect(clientsService.getServerInfo).toHaveBeenCalledWith('client-2');
        done();
      });
    });

    it('should handle multiple concurrent requests for different clients', (done) => {
      const action1 = loadServerInfo({ clientId: 'client-1' });
      const action2 = loadServerInfo({ clientId: 'client-2' });
      const mockServerInfo2: ServerInfo = {
        serverId: 'server-2',
        providerType: 'hetzner',
      };

      actions$ = of(action1, action2);

      // Mock store.select to execute the selector with mock state
      // The selector function from selectClientById(clientId) will be called with state
      const mockState = {
        clients: {
          entities: [mockClient, mockAutoProvisionedClient],
        },
      };

      (store.select as jest.Mock).mockImplementation((selector: any) => {
        // Execute the selector with mock state to get the correct client
        // selectClientById creates a selector that finds a client by id
        if (typeof selector === 'function') {
          const result = selector(mockState);

          return of(result);
        }

        return of(null);
      });

      clientsService.getServerInfo.mockImplementation((clientId: string) => {
        if (clientId === 'client-2') {
          return of(mockServerInfo2);
        }

        return of(mockServerInfo);
      });

      const outcomes = [
        loadServerInfoFailure({ clientId: 'client-1', error: '' }), // Not auto-provisioned, skipped
        loadServerInfoSuccess({ clientId: 'client-2', serverInfo: mockServerInfo2 }), // Auto-provisioned, called
      ];
      const results: any[] = [];

      loadServerInfo$(actions$, clientsService, store).subscribe({
        next: (result) => {
          results.push(result);

          if (results.length === 2) {
            expect(results).toContainEqual(outcomes[0]);
            expect(results).toContainEqual(outcomes[1]);
            expect(clientsService.getServerInfo).not.toHaveBeenCalledWith('client-1');
            expect(clientsService.getServerInfo).toHaveBeenCalledWith('client-2');
            done();
          }
        },
      });
    });
  });

  describe('loadClientUsers$', () => {
    it('should return loadClientUsersSuccess on success', (done) => {
      const clientId = 'client-1';
      const users = [
        {
          id: 'rel-1',
          userId: 'user-1',
          clientId,
          role: 'user' as const,
          userEmail: 'a@test.com',
          createdAt: '2024-01-01',
          updatedAt: '2024-01-01',
        },
      ];
      const action = loadClientUsers({ clientId });
      const outcome = loadClientUsersSuccess({ clientId, users });

      actions$ = of(action);
      clientsService.getClientUsers.mockReturnValue(of(users));

      loadClientUsers$(actions$, clientsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        expect(clientsService.getClientUsers).toHaveBeenCalledWith(clientId);
        done();
      });
    });

    it('should return loadClientUsersFailure on error', (done) => {
      const clientId = 'client-1';
      const action = loadClientUsers({ clientId });
      const error = new Error('Load failed');
      const outcome = loadClientUsersFailure({ clientId, error: 'Load failed' });

      actions$ = of(action);
      clientsService.getClientUsers.mockReturnValue(throwError(() => error));

      loadClientUsers$(actions$, clientsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });
  });

  describe('addClientUser$', () => {
    it('should return addClientUserSuccess on success', (done) => {
      const clientId = 'client-1';
      const dto = { email: 'new@test.com', role: 'user' as const };
      const user = {
        id: 'rel-2',
        userId: 'user-2',
        clientId,
        role: 'user' as const,
        userEmail: 'new@test.com',
        createdAt: '2024-01-02',
        updatedAt: '2024-01-02',
      };
      const action = addClientUser({ clientId, dto });
      const outcome = addClientUserSuccess({ clientId, user });

      actions$ = of(action);
      clientsService.addClientUser.mockReturnValue(of(user));

      addClientUser$(actions$, clientsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        expect(clientsService.addClientUser).toHaveBeenCalledWith(clientId, dto);
        done();
      });
    });

    it('should return addClientUserFailure on error', (done) => {
      const clientId = 'client-1';
      const dto = { email: 'new@test.com', role: 'user' as const };
      const action = addClientUser({ clientId, dto });
      const error = new Error('Add failed');
      const outcome = addClientUserFailure({ clientId, error: 'Add failed' });

      actions$ = of(action);
      clientsService.addClientUser.mockReturnValue(throwError(() => error));

      addClientUser$(actions$, clientsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });
  });

  describe('removeClientUser$', () => {
    it('should return removeClientUserSuccess on success', (done) => {
      const clientId = 'client-1';
      const relationshipId = 'rel-1';
      const action = removeClientUser({ clientId, relationshipId });
      const outcome = removeClientUserSuccess({ clientId, relationshipId });

      actions$ = of(action);
      clientsService.removeClientUser.mockReturnValue(of(undefined));

      removeClientUser$(actions$, clientsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        expect(clientsService.removeClientUser).toHaveBeenCalledWith(clientId, relationshipId);
        done();
      });
    });

    it('should return removeClientUserFailure on error', (done) => {
      const clientId = 'client-1';
      const relationshipId = 'rel-1';
      const action = removeClientUser({ clientId, relationshipId });
      const error = new Error('Remove failed');
      const outcome = removeClientUserFailure({
        clientId,
        relationshipId,
        error: 'Remove failed',
      });

      actions$ = of(action);
      clientsService.removeClientUser.mockReturnValue(throwError(() => error));

      removeClientUser$(actions$, clientsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });
  });
});
