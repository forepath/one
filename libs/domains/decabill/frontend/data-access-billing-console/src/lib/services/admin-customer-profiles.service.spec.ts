import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';

import { AdminCustomerProfilesService } from './admin-customer-profiles.service';

describe('AdminCustomerProfilesService', () => {
  let service: AdminCustomerProfilesService;
  let httpMock: HttpTestingController;
  const apiUrl = 'http://localhost:3200/api';

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        AdminCustomerProfilesService,
        { provide: ENVIRONMENT, useValue: { billing: { restApiUrl: apiUrl } } },
      ],
    });
    service = TestBed.inject(AdminCustomerProfilesService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('lists profiles with pagination params', (done) => {
    service.list({ limit: 25, offset: 10 }).subscribe((res) => {
      expect(res.total).toBe(1);
      done();
    });
    const req = httpMock.expectOne((r) => r.url === `${apiUrl}/admin/billing/customer-profiles`);

    expect(req.request.params.get('limit')).toBe('25');
    expect(req.request.params.get('offset')).toBe('10');
    req.flush({ items: [], total: 1, limit: 25, offset: 10 });
  });

  it('gets profile by id', (done) => {
    service.getById('profile-1').subscribe((res) => {
      expect(res.id).toBe('profile-1');
      done();
    });
    const req = httpMock.expectOne(`${apiUrl}/admin/billing/customer-profiles/profile-1`);

    expect(req.request.method).toBe('GET');
    req.flush({ id: 'profile-1', userId: 'user-1', isComplete: true, createdAt: '', updatedAt: '' });
  });

  it('gets trust score by profile id', (done) => {
    service.getTrustScore('profile-1').subscribe((res) => {
      expect(res.profileId).toBe('profile-1');
      done();
    });
    const req = httpMock.expectOne(`${apiUrl}/admin/billing/customer-profiles/profile-1/trust-score`);

    expect(req.request.method).toBe('GET');
    req.flush({ profileId: 'profile-1', userId: 'user-1', score: 120, level: 'green', baseScore: 100, factors: [] });
  });

  it('recomputes trust score by profile id', (done) => {
    service.recomputeTrustScore('profile-1').subscribe((res) => {
      expect(res.score).toBe(95);
      done();
    });
    const req = httpMock.expectOne(`${apiUrl}/admin/billing/customer-profiles/profile-1/trust-score/recompute`);

    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({});
    req.flush({ profileId: 'profile-1', userId: 'user-1', score: 95, level: 'yellow', baseScore: 100, factors: [] });
  });

  it('creates profile', (done) => {
    const dto = { userId: 'user-1', firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' };

    service.create(dto).subscribe((res) => {
      expect(res.userId).toBe('user-1');
      done();
    });
    const req = httpMock.expectOne(`${apiUrl}/admin/billing/customer-profiles`);

    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(dto);
    req.flush({ userId: 'user-1', isComplete: true });
  });

  it('updates profile', (done) => {
    const dto = { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', country: 'DE' };

    service.update('profile-1', dto).subscribe(() => done());
    const req = httpMock.expectOne(`${apiUrl}/admin/billing/customer-profiles/profile-1`);

    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(dto);
    req.flush({ userId: 'user-1', isComplete: true });
  });

  it('deletes profile', (done) => {
    service.delete('profile-1').subscribe((res) => {
      expect(res).toBeNull();
      done();
    });
    const req = httpMock.expectOne(`${apiUrl}/admin/billing/customer-profiles/profile-1`);

    expect(req.request.method).toBe('DELETE');
    req.flush(null);
  });
});
