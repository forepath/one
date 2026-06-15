import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';

import type {
  AgentResponseDto,
  ContainerType,
  CreateAgentDto,
  CreateAgentResponseDto,
  UpdateAgentDto,
} from '../state/agents/agents.types';

import { AgentsService } from './agents.service';

describe('AgentsService', () => {
  let service: AgentsService;
  let httpMock: HttpTestingController;
  const apiUrl = 'http://localhost:3100/api';
  const clientId = 'client-1';
  const mockAgent: AgentResponseDto = {
    id: 'agent-1',
    name: 'Test Agent',
    description: 'Test Description',
    agentType: 'cursor',
    containerType: 'generic' as ContainerType,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };
  const mockCreateAgentResponse: CreateAgentResponseDto = {
    ...mockAgent,
    password: 'generated-password',
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

    service = TestBed.inject(AgentsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('listClientAgents', () => {
    it('should return agents array for a client', (done) => {
      const mockAgents: AgentResponseDto[] = [mockAgent];

      service.listClientAgents(clientId).subscribe((agents) => {
        expect(agents).toEqual(mockAgents);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/clients/${clientId}/agents`);

      expect(req.request.method).toBe('GET');
      req.flush(mockAgents);
    });

    it('should include pagination parameters when provided', (done) => {
      const params = { limit: 10, offset: 20 };
      const mockAgents: AgentResponseDto[] = [mockAgent];

      service.listClientAgents(clientId, params).subscribe((agents) => {
        expect(agents).toEqual(mockAgents);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/clients/${clientId}/agents?limit=10&offset=20`);

      expect(req.request.method).toBe('GET');
      expect(req.request.params.get('limit')).toBe('10');
      expect(req.request.params.get('offset')).toBe('20');
      req.flush(mockAgents);
    });
  });

  describe('getClientAgent', () => {
    it('should return an agent by id for a client', (done) => {
      const agentId = 'agent-1';

      service.getClientAgent(clientId, agentId).subscribe((agent) => {
        expect(agent).toEqual(mockAgent);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/clients/${clientId}/agents/${agentId}`);

      expect(req.request.method).toBe('GET');
      req.flush(mockAgent);
    });
  });

  describe('listClientAgentModels', () => {
    it('should GET model map for a client agent', (done) => {
      const agentId = 'agent-1';
      const mockModels = { 'model-a': 'Model A', 'model-b': 'Model B' };

      service.listClientAgentModels(clientId, agentId).subscribe((models) => {
        expect(models).toEqual(mockModels);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/clients/${clientId}/agents/${agentId}/models`);

      expect(req.request.method).toBe('GET');
      req.flush(mockModels);
    });
  });

  describe('createClientAgent', () => {
    it('should create a new agent for a client', (done) => {
      const createDto: CreateAgentDto = {
        name: 'New Agent',
      };

      service.createClientAgent(clientId, createDto).subscribe((agent) => {
        expect(agent).toEqual(mockCreateAgentResponse);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/clients/${clientId}/agents`);

      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(createDto);
      req.flush(mockCreateAgentResponse);
    });
  });

  describe('updateClientAgent', () => {
    it('should update an existing agent for a client', (done) => {
      const agentId = 'agent-1';
      const updateDto: UpdateAgentDto = {
        name: 'Updated Agent',
      };

      service.updateClientAgent(clientId, agentId, updateDto).subscribe((agent) => {
        expect(agent).toEqual({ ...mockAgent, name: 'Updated Agent' });
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/clients/${clientId}/agents/${agentId}`);

      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(updateDto);
      req.flush({ ...mockAgent, name: 'Updated Agent' });
    });
  });

  describe('deleteClientAgent', () => {
    it('should delete an agent for a client', (done) => {
      const agentId = 'agent-1';

      service.deleteClientAgent(clientId, agentId).subscribe(() => {
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/clients/${clientId}/agents/${agentId}`);

      expect(req.request.method).toBe('DELETE');
      req.flush(null);
    });
  });

  describe('startClientAgent', () => {
    it('should start agent containers for a client', (done) => {
      const agentId = 'agent-1';

      service.startClientAgent(clientId, agentId).subscribe((agent) => {
        expect(agent).toEqual(mockAgent);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/clients/${clientId}/agents/${agentId}/start`);

      expect(req.request.method).toBe('POST');
      req.flush(mockAgent);
    });
  });

  describe('stopClientAgent', () => {
    it('should stop agent containers for a client', (done) => {
      const agentId = 'agent-1';

      service.stopClientAgent(clientId, agentId).subscribe((agent) => {
        expect(agent).toEqual(mockAgent);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/clients/${clientId}/agents/${agentId}/stop`);

      expect(req.request.method).toBe('POST');
      req.flush(mockAgent);
    });
  });

  describe('restartClientAgent', () => {
    it('should restart agent containers for a client', (done) => {
      const agentId = 'agent-1';

      service.restartClientAgent(clientId, agentId).subscribe((agent) => {
        expect(agent).toEqual(mockAgent);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/clients/${clientId}/agents/${agentId}/restart`);

      expect(req.request.method).toBe('POST');
      req.flush(mockAgent);
    });
  });
});
