import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';

import type {
  ClientResponseDto,
  CreateClientDto,
  CreateClientResponseDto,
  UpdateClientDto,
} from '../state/clients/clients.types';

import { ClientsService } from './clients.service';

describe('ClientsService', () => {
  let service: ClientsService;
  let httpMock: HttpTestingController;
  const apiUrl = 'http://localhost:3100/api';
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
  const mockCreateClientResponse: CreateClientResponseDto = {
    ...mockClient,
    apiKey: 'generated-api-key',
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        {
          provide: ENVIRONMENT,
          useValue: {
            controller: {
              restApiUrl: apiUrl,
            },
          },
        },
      ],
    });

    service = TestBed.inject(ClientsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('listClients', () => {
    it('should return clients array', (done) => {
      const mockClients: ClientResponseDto[] = [mockClient];

      service.listClients().subscribe((clients) => {
        expect(clients).toEqual(mockClients);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/clients`);

      expect(req.request.method).toBe('GET');
      req.flush(mockClients);
    });

    it('should include pagination parameters when provided', (done) => {
      const params = { limit: 10, offset: 20 };
      const mockClients: ClientResponseDto[] = [mockClient];

      service.listClients(params).subscribe((clients) => {
        expect(clients).toEqual(mockClients);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/clients?limit=10&offset=20`);

      expect(req.request.method).toBe('GET');
      expect(req.request.params.get('limit')).toBe('10');
      expect(req.request.params.get('offset')).toBe('20');
      req.flush(mockClients);
    });
  });

  describe('getClient', () => {
    it('should return a client by id', (done) => {
      const clientId = 'client-1';

      service.getClient(clientId).subscribe((client) => {
        expect(client).toEqual(mockClient);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/clients/${clientId}`);

      expect(req.request.method).toBe('GET');
      req.flush(mockClient);
    });
  });

  describe('createClient', () => {
    it('should create a new client', (done) => {
      const createDto: CreateClientDto = {
        name: 'New Client',
        endpoint: 'https://example.com/api',
        authenticationType: 'api_key',
      };

      service.createClient(createDto).subscribe((client) => {
        expect(client).toEqual(mockCreateClientResponse);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/clients`);

      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(createDto);
      req.flush(mockCreateClientResponse);
    });
  });

  describe('updateClient', () => {
    it('should update an existing client', (done) => {
      const clientId = 'client-1';
      const updateDto: UpdateClientDto = {
        name: 'Updated Client',
      };

      service.updateClient(clientId, updateDto).subscribe((client) => {
        expect(client).toEqual({ ...mockClient, name: 'Updated Client' });
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/clients/${clientId}`);

      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(updateDto);
      req.flush({ ...mockClient, name: 'Updated Client' });
    });
  });

  describe('deleteClient', () => {
    it('should delete a client', (done) => {
      const clientId = 'client-1';

      service.deleteClient(clientId).subscribe(() => {
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/clients/${clientId}`);

      expect(req.request.method).toBe('DELETE');
      req.flush(null);
    });
  });

  describe('getClientUsers', () => {
    it('should return client users', (done) => {
      const clientId = 'client-1';
      const mockUsers = [
        {
          id: 'rel-1',
          userId: 'user-1',
          clientId,
          role: 'user' as const,
          userEmail: 'a@test.com',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ];

      service.getClientUsers(clientId).subscribe((users) => {
        expect(users).toEqual(mockUsers);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/clients/${clientId}/users`);

      expect(req.request.method).toBe('GET');
      req.flush(mockUsers);
    });
  });

  describe('addClientUser', () => {
    it('should add a user to a client', (done) => {
      const clientId = 'client-1';
      const dto = { email: 'new@test.com', role: 'user' as const };
      const mockResponse = {
        id: 'rel-2',
        userId: 'user-2',
        clientId,
        role: 'user' as const,
        userEmail: 'new@test.com',
        createdAt: '2024-01-02T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z',
      };

      service.addClientUser(clientId, dto).subscribe((user) => {
        expect(user).toEqual(mockResponse);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/clients/${clientId}/users`);

      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(dto);
      req.flush(mockResponse);
    });
  });

  describe('removeClientUser', () => {
    it('should remove a user from a client', (done) => {
      const clientId = 'client-1';
      const relationshipId = 'rel-1';

      service.removeClientUser(clientId, relationshipId).subscribe(() => {
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/clients/${clientId}/users/${relationshipId}`);

      expect(req.request.method).toBe('DELETE');
      req.flush(null);
    });
  });

  describe('client agent autonomy', () => {
    const mockAutonomy = {
      clientId: 'client-1',
      agentId: 'agent-1',
      enabled: true,
      preImproveTicket: false,
      maxRuntimeMs: 3_600_000,
      maxIterations: 20,
      tokenBudgetLimit: null as number | null,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    };

    it('listEnabledAutonomyAgentIds GETs id list', (done) => {
      service.listEnabledAutonomyAgentIds('client-1').subscribe((res) => {
        expect(res).toEqual({ agentIds: ['agent-1', 'agent-2'] });
        done();
      });
      const req = httpMock.expectOne(`${apiUrl}/clients/client-1/agent-autonomy/enabled-agent-ids`);

      expect(req.request.method).toBe('GET');
      req.flush({ agentIds: ['agent-1', 'agent-2'] });
    });

    it('getClientAgentAutonomy GETs autonomy', (done) => {
      service.getClientAgentAutonomy('client-1', 'agent-1').subscribe((row) => {
        expect(row).toEqual(mockAutonomy);
        done();
      });
      const req = httpMock.expectOne(`${apiUrl}/clients/client-1/agents/agent-1/autonomy`);

      expect(req.request.method).toBe('GET');
      req.flush(mockAutonomy);
    });

    it('upsertClientAgentAutonomy PUTs dto', (done) => {
      const dto = {
        enabled: false,
        preImproveTicket: true,
        maxRuntimeMs: 120_000,
        maxIterations: 10,
      };

      service.upsertClientAgentAutonomy('client-1', 'agent-1', dto).subscribe((row) => {
        expect(row).toEqual(mockAutonomy);
        done();
      });
      const req = httpMock.expectOne(`${apiUrl}/clients/client-1/agents/agent-1/autonomy`);

      expect(req.request.method).toBe('PUT');
      expect(req.request.body).toEqual(dto);
      req.flush(mockAutonomy);
    });
  });
});
