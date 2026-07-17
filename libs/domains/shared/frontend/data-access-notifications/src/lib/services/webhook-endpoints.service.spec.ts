import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { NOTIFICATION_ADMIN_ENVIRONMENT } from '../tokens/notification-admin-environment';
import { WebhookAuthType, WebhookHttpMethod, type WebhookEndpointResponseDto } from '../types/webhook-endpoint.types';

import { WebhookEndpointsService } from './webhook-endpoints.service';

describe('WebhookEndpointsService', () => {
  let service: WebhookEndpointsService;
  let httpMock: HttpTestingController;
  const baseUrl = 'http://localhost:3300/api/admin/webhooks';

  const mockEndpoint = (): WebhookEndpointResponseDto => ({
    id: '11111111-1111-1111-1111-111111111111',
    scopeKey: 'app',
    name: 'Primary',
    url: 'https://example.com/hook',
    httpMethod: WebhookHttpMethod.POST,
    subscribedEvents: ['ticket.created'],
    enabled: true,
    authType: WebhookAuthType.NONE,
    hasAuthValue: false,
    consecutiveFailures: 0,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        {
          provide: NOTIFICATION_ADMIN_ENVIRONMENT,
          useValue: {
            apiUrl: 'http://localhost:3300/api',
            webhooksBasePath: 'admin/webhooks',
            applicationId: 'agenstra',
            clientFilterEnabled: false,
          },
        },
      ],
    });

    service = TestBed.inject(WebhookEndpointsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('lists webhook endpoints with pagination params', (done) => {
    const endpoints = [mockEndpoint()];

    service.list({ limit: 10, offset: 0 }).subscribe((result) => {
      expect(result).toEqual(endpoints);
      done();
    });

    const req = httpMock.expectOne((request) => request.url === baseUrl);

    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('limit')).toBe('10');
    expect(req.request.params.get('offset')).toBe('0');
    req.flush(endpoints);
  });

  it('creates webhook endpoints', (done) => {
    const dto = {
      name: 'Primary',
      url: 'https://example.com/hook',
      httpMethod: WebhookHttpMethod.POST,
      subscribedEvents: ['ticket.created'],
      authType: WebhookAuthType.NONE,
    };

    service.create(dto).subscribe((result) => {
      expect(result).toEqual(mockEndpoint());
      done();
    });

    const req = httpMock.expectOne(baseUrl);

    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(dto);
    req.flush(mockEndpoint());
  });

  it('tests webhook endpoints', (done) => {
    const delivery = {
      id: '22222222-2222-2222-2222-222222222222',
      endpointId: mockEndpoint().id,
      eventId: 'evt-1',
      eventType: 'ticket.created',
      payload: { ok: true },
      success: true,
      attempt: 1,
      createdAt: '2024-01-01T00:00:00Z',
    };

    service.test(mockEndpoint().id).subscribe((result) => {
      expect(result).toEqual(delivery);
      done();
    });

    const req = httpMock.expectOne(`${baseUrl}/${mockEndpoint().id}/test`);

    expect(req.request.method).toBe('POST');
    req.flush(delivery);
  });

  it('lists deliveries for an endpoint', (done) => {
    const response = { items: [], total: 0 };

    service.listDeliveries(mockEndpoint().id, { limit: 10, offset: 0 }).subscribe((result) => {
      expect(result).toEqual(response);
      done();
    });

    const req = httpMock.expectOne((request) => request.url === `${baseUrl}/${mockEndpoint().id}/deliveries`);

    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('limit')).toBe('10');
    req.flush(response);
  });
});
