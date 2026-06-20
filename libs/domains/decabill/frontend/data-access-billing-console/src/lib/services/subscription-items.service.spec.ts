import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';

import type { ServerInfoResponse, SubscriptionItemResponse } from '../types/billing.types';

import { SubscriptionItemsService } from './subscription-items.service';

describe('SubscriptionItemsService', () => {
  let service: SubscriptionItemsService;
  let httpMock: HttpTestingController;
  const apiUrl = 'http://localhost:3200/api';
  const mockItems: SubscriptionItemResponse[] = [
    {
      id: 'item-1',
      subscriptionId: 'sub-1',
      serviceTypeId: 'st-1',
      provisioningStatus: 'active',
    },
  ];
  const mockServerInfo: ServerInfoResponse = {
    name: 'server-1',
    publicIp: '1.2.3.4',
    status: 'running',
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

    service = TestBed.inject(SubscriptionItemsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('listSubscriptionItems', () => {
    it('should GET subscription items', (done) => {
      service.listSubscriptionItems('sub-1').subscribe((response) => {
        expect(response).toEqual(mockItems);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/subscriptions/sub-1/items`);

      expect(req.request.method).toBe('GET');
      req.flush(mockItems);
    });
  });

  describe('getServerInfo', () => {
    it('should GET server info', (done) => {
      service.getServerInfo('sub-1', 'item-1').subscribe((response) => {
        expect(response).toEqual(mockServerInfo);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/subscriptions/sub-1/items/item-1/server-info`);

      expect(req.request.method).toBe('GET');
      req.flush(mockServerInfo);
    });
  });

  describe('startServer', () => {
    it('should POST to start action', (done) => {
      service.startServer('sub-1', 'item-1').subscribe((response) => {
        expect(response).toEqual({ success: true });
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/subscriptions/sub-1/items/item-1/actions/start`);

      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({});
      req.flush({ success: true });
    });
  });

  describe('stopServer', () => {
    it('should POST to stop action', (done) => {
      service.stopServer('sub-1', 'item-1').subscribe((response) => {
        expect(response).toEqual({ success: true });
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/subscriptions/sub-1/items/item-1/actions/stop`);

      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({});
      req.flush({ success: true });
    });
  });

  describe('restartServer', () => {
    it('should POST to restart action', (done) => {
      service.restartServer('sub-1', 'item-1').subscribe((response) => {
        expect(response).toEqual({ success: true });
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/subscriptions/sub-1/items/item-1/actions/restart`);

      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({});
      req.flush({ success: true });
    });
  });
});
