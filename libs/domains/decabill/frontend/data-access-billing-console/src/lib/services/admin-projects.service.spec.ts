import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';

import { AdminProjectsService } from './admin-projects.service';

describe('AdminProjectsService', () => {
  let service: AdminProjectsService;
  let httpMock: HttpTestingController;
  const apiUrl = 'http://localhost:3200/api';

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [AdminProjectsService, { provide: ENVIRONMENT, useValue: { billing: { restApiUrl: apiUrl } } }],
    });
    service = TestBed.inject(AdminProjectsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('gets unbilled time bounds', (done) => {
    const bounds = {
      from: '2026-06-01T08:00:00.000Z',
      to: '2026-06-01T17:00:00.000Z',
      entryCount: 3,
    };

    service.getUnbilledTimeBounds('p-1').subscribe((res) => {
      expect(res).toEqual(bounds);
      done();
    });

    const req = httpMock.expectOne(`${apiUrl}/admin/billing/projects/p-1/unbilled-time-bounds`);

    expect(req.request.method).toBe('GET');
    req.flush(bounds);
  });

  it('posts bill-time with range and custom lines', (done) => {
    const dto = {
      from: '2026-06-01T08:00:00.000Z',
      to: '2026-06-01T17:00:00.000Z',
      subscriptionId: 'sub-1',
      lineItems: [{ description: 'Materials', quantity: 1, unitPriceNet: 25 }],
    };
    const response = { invoiceId: 'inv-1', invoiceNumber: 'INV-1', billedMinutes: 60, amountNet: 125 };

    service.billTime('p-1', dto).subscribe((res) => {
      expect(res).toEqual(response);
      done();
    });

    const req = httpMock.expectOne(`${apiUrl}/admin/billing/projects/p-1/bill-time`);

    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(dto);
    req.flush(response);
  });

  it('posts time-report and returns PDF blob', (done) => {
    const dto = {
      from: '2026-06-01T08:00:00.000Z',
      to: '2026-06-01T17:00:00.000Z',
      unbilledOnly: true,
    };
    const blob = new Blob(['pdf'], { type: 'application/pdf' });

    service.generateTimeReport('p-1', dto).subscribe((res) => {
      expect(res).toBe(blob);
      done();
    });

    const req = httpMock.expectOne(`${apiUrl}/admin/billing/projects/p-1/time-report`);

    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(dto);
    req.flush(blob);
  });

  it('creates project with targetHours', (done) => {
    const dto = {
      userId: 'u-1',
      name: 'Alpha',
      hourlyRateNet: 100,
      targetHours: 40,
      currency: 'EUR',
    };
    const response = {
      id: 'p-1',
      ...dto,
      status: 'active',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    service.create(dto).subscribe((res) => {
      expect(res).toEqual(response);
      done();
    });

    const req = httpMock.expectOne(`${apiUrl}/admin/billing/projects`);

    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(dto);
    req.flush(response);
  });

  it('updates project with null targetHours to clear target', (done) => {
    const dto = { targetHours: null };
    const response = {
      id: 'p-1',
      userId: 'u-1',
      name: 'Alpha',
      status: 'active',
      hourlyRateNet: 100,
      targetHours: null,
      currency: 'EUR',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    service.update('p-1', dto).subscribe((res) => {
      expect(res).toEqual(response);
      done();
    });

    const req = httpMock.expectOne(`${apiUrl}/admin/billing/projects/p-1`);

    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(dto);
    req.flush(response);
  });
});
