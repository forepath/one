import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/decabill/frontend/util-configuration';

import type {
  ContainerManagerContainersResponse,
  ContainerManagerLogsResponse,
  ContainerManagerNetworksResponse,
  ContainerManagerStatsHistoryResponse,
} from '../types/billing.types';

import { ContainerManagerService } from './container-manager.service';

describe('ContainerManagerService', () => {
  let service: ContainerManagerService;
  let httpMock: HttpTestingController;
  const apiUrl = 'http://localhost:3200/api';

  const containersResponse: ContainerManagerContainersResponse = {
    containers: [],
    collectedAt: '2026-08-13T12:00:00.000Z',
  };
  const statsResponse: ContainerManagerStatsHistoryResponse = {
    containerId: 'ctr-1',
    points: [],
  };
  const logsResponse: ContainerManagerLogsResponse = {
    containerId: 'ctr-1',
    lines: ['line-1'],
    collectedAt: '2026-08-13T12:00:00.000Z',
    truncated: false,
    tail: 200,
  };
  const networksResponse: ContainerManagerNetworksResponse = {
    networks: [],
    topology: { nodes: [], edges: [] },
    hostInterfaces: [],
    hostRoutes: [],
    collectedAt: '2026-08-13T12:00:00.000Z',
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        {
          provide: ENVIRONMENT,
          useValue: {
            billing: {
              urls: {
                restApi: apiUrl,
              },
            },
          },
        },
      ],
    });

    service = TestBed.inject(ContainerManagerService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('listContainers', () => {
    it('should GET customer containers', (done) => {
      service.listContainers('sub-1', 'item-1').subscribe((response) => {
        expect(response).toEqual(containersResponse);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/subscriptions/sub-1/items/item-1/container-manager/containers`);

      expect(req.request.method).toBe('GET');
      req.flush(containersResponse);
    });

    it('should GET admin containers', (done) => {
      service.listContainers('sub-1', 'item-1', true).subscribe((response) => {
        expect(response).toEqual(containersResponse);
        done();
      });

      const req = httpMock.expectOne(
        `${apiUrl}/admin/billing/subscriptions/sub-1/items/item-1/container-manager/containers`,
      );

      expect(req.request.method).toBe('GET');
      req.flush(containersResponse);
    });
  });

  describe('getStatsHistory', () => {
    it('should GET customer stats history', (done) => {
      service.getStatsHistory('sub-1', 'item-1', 'ctr/1').subscribe((response) => {
        expect(response).toEqual(statsResponse);
        done();
      });

      const req = httpMock.expectOne(
        `${apiUrl}/subscriptions/sub-1/items/item-1/container-manager/containers/ctr%2F1/stats-history`,
      );

      expect(req.request.method).toBe('GET');
      req.flush(statsResponse);
    });

    it('should GET admin stats history', (done) => {
      service.getStatsHistory('sub-1', 'item-1', 'ctr-1', true).subscribe((response) => {
        expect(response).toEqual(statsResponse);
        done();
      });

      const req = httpMock.expectOne(
        `${apiUrl}/admin/billing/subscriptions/sub-1/items/item-1/container-manager/containers/ctr-1/stats-history`,
      );

      expect(req.request.method).toBe('GET');
      req.flush(statsResponse);
    });
  });

  describe('getLogs', () => {
    it('should GET customer logs with optional tail', (done) => {
      service.getLogs('sub-1', 'item-1', 'ctr/1', false, 100).subscribe((response) => {
        expect(response).toEqual(logsResponse);
        done();
      });

      const req = httpMock.expectOne(
        `${apiUrl}/subscriptions/sub-1/items/item-1/container-manager/containers/ctr%2F1/logs?tail=100`,
      );

      expect(req.request.method).toBe('GET');
      req.flush(logsResponse);
    });

    it('should GET admin logs', (done) => {
      service.getLogs('sub-1', 'item-1', 'ctr-1', true).subscribe((response) => {
        expect(response).toEqual(logsResponse);
        done();
      });

      const req = httpMock.expectOne(
        `${apiUrl}/admin/billing/subscriptions/sub-1/items/item-1/container-manager/containers/ctr-1/logs`,
      );

      expect(req.request.method).toBe('GET');
      req.flush(logsResponse);
    });
  });

  describe('listNetworks', () => {
    it('should GET customer networks', (done) => {
      service.listNetworks('sub-1', 'item-1').subscribe((response) => {
        expect(response).toEqual(networksResponse);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/subscriptions/sub-1/items/item-1/container-manager/networks`);

      expect(req.request.method).toBe('GET');
      req.flush(networksResponse);
    });

    it('should GET admin networks', (done) => {
      service.listNetworks('sub-1', 'item-1', true).subscribe((response) => {
        expect(response).toEqual(networksResponse);
        done();
      });

      const req = httpMock.expectOne(
        `${apiUrl}/admin/billing/subscriptions/sub-1/items/item-1/container-manager/networks`,
      );

      expect(req.request.method).toBe('GET');
      req.flush(networksResponse);
    });
  });
});
