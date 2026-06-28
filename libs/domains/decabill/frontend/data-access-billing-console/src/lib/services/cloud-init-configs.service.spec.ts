import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';

import type {
  CloudInitConfigResponse,
  CreateCloudInitConfigDto,
  UpdateCloudInitConfigDto,
} from '../types/billing.types';

import { CloudInitConfigsService } from './cloud-init-configs.service';

describe('CloudInitConfigsService', () => {
  let service: CloudInitConfigsService;
  let httpMock: HttpTestingController;
  const apiUrl = 'http://localhost:3200/api';
  const mockConfig: CloudInitConfigResponse = {
    id: 'cfg-1',
    key: 'my-app',
    name: 'My App',
    provisioningMode: 'simple',
    dockerImage: 'nginx:alpine',
    containerPort: 8080,
    hostPort: 80,
    workDir: '/opt/custom-app',
    environmentVariables: [],
    isActive: true,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        {
          provide: ENVIRONMENT,
          useValue: { billing: { restApiUrl: apiUrl } },
        },
      ],
    });

    service = TestBed.inject(CloudInitConfigsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('listCloudInitConfigs', () => {
    it('lists cloud init configs', (done) => {
      service.listCloudInitConfigs().subscribe((list) => {
        expect(list).toEqual([mockConfig]);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/cloud-init-configs`);
      expect(req.request.method).toBe('GET');
      req.flush([mockConfig]);
    });

    it('includes pagination parameters when provided', (done) => {
      const params = { limit: 10, offset: 20 };

      service.listCloudInitConfigs(params).subscribe((list) => {
        expect(list).toEqual([mockConfig]);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/cloud-init-configs?limit=10&offset=20`);
      expect(req.request.params.get('limit')).toBe('10');
      expect(req.request.params.get('offset')).toBe('20');
      req.flush([mockConfig]);
    });
  });

  describe('getCloudInitConfig', () => {
    it('returns a cloud init config by id', (done) => {
      service.getCloudInitConfig('cfg-1').subscribe((config) => {
        expect(config).toEqual(mockConfig);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/cloud-init-configs/cfg-1`);
      expect(req.request.method).toBe('GET');
      req.flush(mockConfig);
    });
  });

  describe('createCloudInitConfig', () => {
    it('creates a cloud init config', (done) => {
      const dto: CreateCloudInitConfigDto = {
        key: 'new-app',
        name: 'New App',
      };

      service.createCloudInitConfig(dto).subscribe((config) => {
        expect(config).toEqual(mockConfig);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/cloud-init-configs`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(dto);
      req.flush(mockConfig);
    });
  });

  describe('updateCloudInitConfig', () => {
    it('updates a cloud init config', (done) => {
      const dto: UpdateCloudInitConfigDto = { name: 'Updated' };

      service.updateCloudInitConfig('cfg-1', dto).subscribe((config) => {
        expect(config).toEqual(mockConfig);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/cloud-init-configs/cfg-1`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(dto);
      req.flush(mockConfig);
    });
  });

  describe('deleteCloudInitConfig', () => {
    it('deletes a cloud init config', (done) => {
      service.deleteCloudInitConfig('cfg-1').subscribe(() => done());

      const req = httpMock.expectOne(`${apiUrl}/cloud-init-configs/cfg-1`);
      expect(req.request.method).toBe('DELETE');
      req.flush(null);
    });
  });
});
