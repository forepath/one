import { HttpRequest, HttpResponse } from '@angular/common/http';
import { Injector, runInInjectionContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { ENVIRONMENT } from '@forepath/decabill/frontend/util-configuration';

import {
  BILLING_TENANT_HEADER,
  billingTenantInterceptor,
  DEFAULT_BILLING_TENANT_ID,
  resolveBillingTenantDisplayName,
  resolveBillingTenantId,
} from './tenant.interceptor';

describe('billingTenantInterceptor', () => {
  const mockNext = jest.fn((req: HttpRequest<unknown>) => {
    return of(new HttpResponse({ body: null, status: 200, url: req.url, headers: req.headers }));
  });

  const setupTestBed = (billing: { urls: { restApi: string; frontend: string }; tenantId?: string }): Injector => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ENVIRONMENT,
          useValue: {
            billing,
          },
        },
      ],
    });

    return TestBed.inject(Injector);
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('resolveBillingTenantId defaults to default', () => {
    expect(
      resolveBillingTenantId({
        billing: {
          urls: {
            restApi: 'http://localhost:3200/api',
            frontend: 'http://localhost:4202',
          },
        },
      } as never),
    ).toBe(DEFAULT_BILLING_TENANT_ID);
  });

  it('resolveBillingTenantId uses configured tenant', () => {
    expect(
      resolveBillingTenantId({
        billing: {
          urls: {
            restApi: 'http://localhost:3200/api',
            frontend: 'http://localhost:4202',
          },
          tenantId: 'one',
        },
      } as never),
    ).toBe('one');
  });

  it('resolveBillingTenantDisplayName capitalizes the configured tenant id', () => {
    expect(
      resolveBillingTenantDisplayName({
        billing: {
          urls: {
            restApi: 'http://localhost:3200/api',
            frontend: 'http://localhost:4202',
          },
          tenantId: 'decabill',
        },
      } as never),
    ).toBe('Decabill');
    expect(
      resolveBillingTenantDisplayName({
        billing: {
          urls: {
            restApi: 'http://localhost:3200/api',
            frontend: 'http://localhost:4202',
          },
        },
      } as never),
    ).toBe('Default');
  });

  it('does not modify unrelated requests', (done) => {
    const injector = setupTestBed({
      urls: {
        restApi: 'http://localhost:3200/api',
        frontend: 'http://localhost:4202',
      },
    });
    const req = new HttpRequest('GET', 'http://other.example/api/data');
    const result = runInInjectionContext(injector, () => billingTenantInterceptor(req, mockNext));

    result.subscribe(() => {
      expect(mockNext).toHaveBeenCalledWith(req);
      done();
    });
  });

  it('adds X-Tenant default header for billing API requests', (done) => {
    const injector = setupTestBed({
      urls: {
        restApi: 'http://localhost:3200/api',
        frontend: 'http://localhost:4202',
      },
    });
    const req = new HttpRequest('GET', 'http://localhost:3200/api/subscriptions');
    const result = runInInjectionContext(injector, () => billingTenantInterceptor(req, mockNext));

    result.subscribe((response) => {
      const httpResponse = response as HttpResponse<unknown>;

      expect(httpResponse.headers.get(BILLING_TENANT_HEADER)).toBe(DEFAULT_BILLING_TENANT_ID);
      done();
    });
  });

  it('adds X-Tenant default header when tenantId is unset but restApi comes from merged config', (done) => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ENVIRONMENT,
          useValue: {
            billing: {
              urls: {
                restApi: 'http://localhost:3200/api',
                frontend: 'http://localhost:4202',
              },
            },
          },
        },
      ],
    });
    const injector = TestBed.inject(Injector);
    const req = new HttpRequest('GET', 'http://localhost:3200/api/backorders?limit=10&offset=0');
    const result = runInInjectionContext(injector, () => billingTenantInterceptor(req, mockNext));

    result.subscribe((response) => {
      const httpResponse = response as HttpResponse<unknown>;

      expect(httpResponse.headers.get(BILLING_TENANT_HEADER)).toBe(DEFAULT_BILLING_TENANT_ID);
      done();
    });
  });

  it('adds configured tenant header for billing API requests', (done) => {
    const injector = setupTestBed({
      urls: {
        restApi: 'http://localhost:3200/api',
        frontend: 'http://localhost:4202',
      },
      tenantId: 'acme',
    });
    const req = new HttpRequest('GET', 'http://localhost:3200/api/invoices');
    const result = runInInjectionContext(injector, () => billingTenantInterceptor(req, mockNext));

    result.subscribe((response) => {
      const httpResponse = response as HttpResponse<unknown>;

      expect(httpResponse.headers.get(BILLING_TENANT_HEADER)).toBe('acme');
      done();
    });
  });

  it('adds X-Tenant from landing env when billing is absent', (done) => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ENVIRONMENT,
          useValue: {
            landing: {
              tenantId: 'agenstra',
              urls: {
                restApi: 'http://localhost:3200/api',
                portal: 'http://localhost:4202',
              },
            },
          },
        },
      ],
    });
    const injector = TestBed.inject(Injector);
    const req = new HttpRequest('GET', 'http://localhost:3200/api/public/service-plan-offerings');
    const result = runInInjectionContext(injector, () => billingTenantInterceptor(req, mockNext));

    result.subscribe((response) => {
      const httpResponse = response as HttpResponse<unknown>;

      expect(httpResponse.headers.get(BILLING_TENANT_HEADER)).toBe('agenstra');
      done();
    });
  });
});
