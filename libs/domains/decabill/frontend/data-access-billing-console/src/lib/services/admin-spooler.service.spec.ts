import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/decabill/frontend/util-configuration';
import { of } from 'rxjs';

import type { SpoolJob } from '../types/spooler.types';

import { AdminSpoolerService, SpoolJobFailedError } from './admin-spooler.service';

describe('AdminSpoolerService', () => {
  const apiUrl = 'http://localhost:3200/api';
  const base = `${apiUrl}/admin/billing/spooler/jobs`;
  let service: AdminSpoolerService;
  let httpMock: HttpTestingController;
  const job = (patch: Partial<SpoolJob>) => ({ id: 'job-1', status: 'queued', hasFile: false, ...patch }) as SpoolJob;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [AdminSpoolerService, { provide: ENVIRONMENT, useValue: { billing: { urls: { restApi: apiUrl } } } }],
    });
    service = TestBed.inject(AdminSpoolerService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('lists jobs with the given filters only', () => {
    service.list({ status: 'failed', limit: 10, offset: 0 }).subscribe();

    const req = httpMock.expectOne((r) => r.url === base);

    expect(req.request.params.get('status')).toBe('failed');
    expect(req.request.params.get('limit')).toBe('10');
    expect(req.request.params.has('kind')).toBe(false);
    req.flush({ items: [], total: 0, limit: 10, offset: 0, counts: {} });
  });

  it('retries and cancels jobs', () => {
    service.retry('job-1').subscribe();
    service.cancel('job-1').subscribe();

    expect(httpMock.expectOne(`${base}/job-1/retry`).request.method).toBe('POST');
    expect(httpMock.expectOne(`${base}/job-1/cancel`).request.method).toBe('POST');
  });

  it('polls until the spooled job completed, then downloads its file', fakeAsync(() => {
    const blob = new Blob(['%PDF']);
    let result: Blob | undefined;

    service.spoolAndDownload(of(job({}))).subscribe((value) => (result = value));

    tick(0);
    httpMock.expectOne(`${base}/job-1`).flush(job({ status: 'processing' }));
    tick(1000);
    httpMock.expectOne(`${base}/job-1`).flush(job({ status: 'completed', hasFile: true }));
    httpMock.expectOne(`${base}/job-1/file`).flush(blob);

    expect(result).toBe(blob);
  }));

  it('errors with the job message when the job failed', fakeAsync(() => {
    let failure: unknown;

    service.spoolAndDownload(of(job({}))).subscribe({ error: (error) => (failure = error) });

    tick(0);
    httpMock.expectOne(`${base}/job-1`).flush(job({ status: 'failed', error: 'Customer has no postal address' }));

    expect(failure).toBeInstanceOf(SpoolJobFailedError);
    expect((failure as Error).message).toBe('Customer has no postal address');
  }));
});
