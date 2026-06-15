import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';

import {
  addClientUser,
  clearActiveClient,
  createClient,
  deleteClient,
  loadClient,
  loadClientUsers,
  loadClients,
  removeClientUser,
  setActiveClient,
  updateClient,
} from './clients.actions';
import { ClientsFacade } from './clients.facade';
import type { ClientResponseDto, CreateClientDto, ListClientsParams, UpdateClientDto } from './clients.types';

describe('ClientsFacade', () => {
  let facade: ClientsFacade;
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
  const createFacadeWithMock = (mockSelectReturn: any): ClientsFacade => {
    const mockStore = {
      select: jest.fn().mockReturnValue(of(mockSelectReturn)),
      dispatch: jest.fn(),
    } as any;

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        ClientsFacade,
        {
          provide: Store,
          useValue: mockStore,
        },
      ],
    });

    return TestBed.inject(ClientsFacade);
  };

  beforeEach(() => {
    store = {
      select: jest.fn().mockReturnValue(of(null)),
      dispatch: jest.fn(),
    } as any;

    TestBed.configureTestingModule({
      providers: [
        ClientsFacade,
        {
          provide: Store,
          useValue: store,
        },
      ],
    });

    facade = TestBed.inject(ClientsFacade);
  });

  describe('State Observables', () => {
    it('should expose clients$ observable', (done) => {
      const clients = [mockClient, mockClient2];
      const testFacade = createFacadeWithMock(clients);

      testFacade.clients$.subscribe((result) => {
        expect(result).toEqual(clients);
        done();
      });
    });

    it('should expose selectedClient$ observable', (done) => {
      const testFacade = createFacadeWithMock(mockClient);

      testFacade.selectedClient$.subscribe((result) => {
        expect(result).toEqual(mockClient);
        done();
      });
    });

    it('should expose activeClientId$ observable', (done) => {
      const activeClientId = 'client-1';
      const testFacade = createFacadeWithMock(activeClientId);

      testFacade.activeClientId$.subscribe((result) => {
        expect(result).toEqual(activeClientId);
        done();
      });
    });

    it('should expose activeClient$ observable', (done) => {
      const testFacade = createFacadeWithMock(mockClient);

      testFacade.activeClient$.subscribe((result) => {
        expect(result).toEqual(mockClient);
        done();
      });
    });
  });

  describe('Loading State Observables', () => {
    it('should expose loading$ observable', (done) => {
      const testFacade = createFacadeWithMock(true);

      testFacade.loading$.subscribe((result) => {
        expect(result).toBe(true);
        done();
      });
    });

    it('should expose loadingClient$ observable', (done) => {
      const testFacade = createFacadeWithMock(false);

      testFacade.loadingClient$.subscribe((result) => {
        expect(result).toBe(false);
        done();
      });
    });

    it('should expose creating$ observable', (done) => {
      const testFacade = createFacadeWithMock(true);

      testFacade.creating$.subscribe((result) => {
        expect(result).toBe(true);
        done();
      });
    });

    it('should expose updating$ observable', (done) => {
      const testFacade = createFacadeWithMock(false);

      testFacade.updating$.subscribe((result) => {
        expect(result).toBe(false);
        done();
      });
    });

    it('should expose deleting$ observable', (done) => {
      const testFacade = createFacadeWithMock(true);

      testFacade.deleting$.subscribe((result) => {
        expect(result).toBe(true);
        done();
      });
    });

    it('should expose loadingAny$ observable', (done) => {
      const testFacade = createFacadeWithMock(true);

      testFacade.loadingAny$.subscribe((result) => {
        expect(result).toBe(true);
        done();
      });
    });
  });

  describe('Error Observable', () => {
    it('should expose error$ observable', (done) => {
      const error = 'Test error';
      const testFacade = createFacadeWithMock(error);

      testFacade.error$.subscribe((result) => {
        expect(result).toEqual(error);
        done();
      });
    });

    it('should expose null error when no error', (done) => {
      const testFacade = createFacadeWithMock(null);

      testFacade.error$.subscribe((result) => {
        expect(result).toBeNull();
        done();
      });
    });
  });

  describe('Derived State Observables', () => {
    it('should expose clientsCount$ observable', (done) => {
      const count = 5;
      const testFacade = createFacadeWithMock(count);

      testFacade.clientsCount$.subscribe((result) => {
        expect(result).toEqual(count);
        done();
      });
    });

    it('should expose hasClients$ observable', (done) => {
      const testFacade = createFacadeWithMock(true);

      testFacade.hasClients$.subscribe((result) => {
        expect(result).toBe(true);
        done();
      });
    });
  });

  describe('Action Methods', () => {
    it('should dispatch loadClients action', () => {
      const params: ListClientsParams = { limit: 10, offset: 0 };

      facade.loadClients(params);

      expect(store.dispatch).toHaveBeenCalledWith(loadClients({ params }));
    });

    it('should dispatch loadClients action without params', () => {
      facade.loadClients();

      expect(store.dispatch).toHaveBeenCalledWith(loadClients({ params: undefined }));
    });

    it('should dispatch loadClient action', () => {
      const id = 'client-1';

      facade.loadClient(id);

      expect(store.dispatch).toHaveBeenCalledWith(loadClient({ id }));
    });

    it('should dispatch createClient action', () => {
      const createDto: CreateClientDto = {
        name: 'New Client',
        endpoint: 'https://new.example.com/api',
        authenticationType: 'api_key',
      };

      facade.createClient(createDto);

      expect(store.dispatch).toHaveBeenCalledWith(createClient({ client: createDto }));
    });

    it('should dispatch updateClient action', () => {
      const id = 'client-1';
      const updateDto: UpdateClientDto = {
        name: 'Updated Client',
      };

      facade.updateClient(id, updateDto);

      expect(store.dispatch).toHaveBeenCalledWith(updateClient({ id, client: updateDto }));
    });

    it('should dispatch deleteClient action', () => {
      const id = 'client-1';

      facade.deleteClient(id);

      expect(store.dispatch).toHaveBeenCalledWith(deleteClient({ id }));
    });

    it('should dispatch setActiveClient action', () => {
      const id = 'client-1';

      facade.setActiveClient(id);

      expect(store.dispatch).toHaveBeenCalledWith(setActiveClient({ id }));
    });

    it('should dispatch clearActiveClient action', () => {
      facade.clearActiveClient();

      expect(store.dispatch).toHaveBeenCalledWith(clearActiveClient());
    });
  });

  describe('Helper Methods', () => {
    it('should return client by ID observable', (done) => {
      const id = 'client-1';
      const testFacade = createFacadeWithMock(mockClient);

      testFacade.getClientById$(id).subscribe((result) => {
        expect(result).toEqual(mockClient);
        done();
      });
    });

    it('should return null when client not found', (done) => {
      const id = 'non-existent';
      const testFacade = createFacadeWithMock(null);

      testFacade.getClientById$(id).subscribe((result) => {
        expect(result).toBeNull();
        done();
      });
    });
  });

  describe('Client User Management', () => {
    it('should dispatch loadClientUsers action', () => {
      facade.loadClientUsers('client-1');
      expect(store.dispatch).toHaveBeenCalledWith(loadClientUsers({ clientId: 'client-1' }));
    });

    it('should dispatch addClientUser action', () => {
      const dto = { email: 'new@test.com', role: 'user' as const };

      facade.addClientUser('client-1', dto);
      expect(store.dispatch).toHaveBeenCalledWith(addClientUser({ clientId: 'client-1', dto }));
    });

    it('should dispatch removeClientUser action', () => {
      facade.removeClientUser('client-1', 'rel-1');
      expect(store.dispatch).toHaveBeenCalledWith(removeClientUser({ clientId: 'client-1', relationshipId: 'rel-1' }));
    });
  });
});
