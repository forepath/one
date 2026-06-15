import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';

import type {
  CreateEnvironmentVariableDto,
  EnvironmentVariableResponseDto,
  UpdateEnvironmentVariableDto,
} from '../state/env/env.types';

import { EnvService } from './env.service';

describe('EnvService', () => {
  let service: EnvService;
  let httpMock: HttpTestingController;
  const apiUrl = 'http://localhost:3100/api';
  const clientId = 'client-1';
  const agentId = 'agent-1';
  const mockEnvironmentVariable: EnvironmentVariableResponseDto = {
    id: 'env-var-1',
    agentId: agentId,
    variable: 'TEST_VAR',
    content: 'test-value',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
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

    service = TestBed.inject(EnvService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('listEnvironmentVariables', () => {
    it('should return environment variables list', (done) => {
      const mockEnvVars: EnvironmentVariableResponseDto[] = [mockEnvironmentVariable];

      service.listEnvironmentVariables(clientId, agentId).subscribe((envVars) => {
        expect(envVars).toEqual(mockEnvVars);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/clients/${clientId}/agents/${agentId}/environment`);

      expect(req.request.method).toBe('GET');
      req.flush(mockEnvVars);
    });

    it('should include pagination parameters when provided', (done) => {
      const params = { limit: 10, offset: 20 };
      const mockEnvVars: EnvironmentVariableResponseDto[] = [mockEnvironmentVariable];

      service.listEnvironmentVariables(clientId, agentId, params).subscribe((envVars) => {
        expect(envVars).toEqual(mockEnvVars);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/clients/${clientId}/agents/${agentId}/environment?limit=10&offset=20`);

      expect(req.request.method).toBe('GET');
      expect(req.request.params.get('limit')).toBe('10');
      expect(req.request.params.get('offset')).toBe('20');
      req.flush(mockEnvVars);
    });
  });

  describe('countEnvironmentVariables', () => {
    it('should return count of environment variables', (done) => {
      const mockCount = { count: 5 };

      service.countEnvironmentVariables(clientId, agentId).subscribe((count) => {
        expect(count).toEqual(mockCount);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/clients/${clientId}/agents/${agentId}/environment/count`);

      expect(req.request.method).toBe('GET');
      req.flush(mockCount);
    });
  });

  describe('createEnvironmentVariable', () => {
    it('should create an environment variable', (done) => {
      const createDto: CreateEnvironmentVariableDto = {
        variable: 'NEW_VAR',
        content: 'new-value',
      };

      service.createEnvironmentVariable(clientId, agentId, createDto).subscribe((envVar) => {
        expect(envVar).toEqual(mockEnvironmentVariable);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/clients/${clientId}/agents/${agentId}/environment`);

      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(createDto);
      req.flush(mockEnvironmentVariable);
    });
  });

  describe('updateEnvironmentVariable', () => {
    it('should update an environment variable', (done) => {
      const envVarId = 'env-var-1';
      const updateDto: UpdateEnvironmentVariableDto = {
        variable: 'UPDATED_VAR',
        content: 'updated-value',
      };

      service.updateEnvironmentVariable(clientId, agentId, envVarId, updateDto).subscribe((envVar) => {
        expect(envVar).toEqual(mockEnvironmentVariable);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/clients/${clientId}/agents/${agentId}/environment/${envVarId}`);

      expect(req.request.method).toBe('PUT');
      expect(req.request.body).toEqual(updateDto);
      req.flush(mockEnvironmentVariable);
    });
  });

  describe('deleteEnvironmentVariable', () => {
    it('should delete an environment variable', (done) => {
      const envVarId = 'env-var-1';

      service.deleteEnvironmentVariable(clientId, agentId, envVarId).subscribe(() => {
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/clients/${clientId}/agents/${agentId}/environment/${envVarId}`);

      expect(req.request.method).toBe('DELETE');
      req.flush(null);
    });
  });

  describe('deleteAllEnvironmentVariables', () => {
    it('should delete all environment variables', (done) => {
      const mockResponse = { deletedCount: 3 };

      service.deleteAllEnvironmentVariables(clientId, agentId).subscribe((response) => {
        expect(response).toEqual(mockResponse);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/clients/${clientId}/agents/${agentId}/environment`);

      expect(req.request.method).toBe('DELETE');
      req.flush(mockResponse);
    });
  });
});
