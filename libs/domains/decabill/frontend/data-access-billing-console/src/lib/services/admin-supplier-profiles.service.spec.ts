import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/decabill/frontend/util-configuration';

import { AdminSupplierProfilesService } from './admin-supplier-profiles.service';

describe('AdminSupplierProfilesService', () => {
  let service: AdminSupplierProfilesService;
  let httpMock: HttpTestingController;
  const apiUrl = 'http://localhost:3200/api';

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        AdminSupplierProfilesService,
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
    service = TestBed.inject(AdminSupplierProfilesService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('lists supplier profiles with pagination params', (done) => {
    service.list({ limit: 25, offset: 10, search: 'acme' }).subscribe((res) => {
      expect(res.total).toBe(1);
      done();
    });
    const req = httpMock.expectOne((r) => r.url === `${apiUrl}/admin/billing/supplier-profiles`);

    expect(req.request.params.get('limit')).toBe('25');
    expect(req.request.params.get('offset')).toBe('10');
    expect(req.request.params.get('search')).toBe('acme');
    req.flush({ items: [], total: 1, limit: 25, offset: 10 });
  });

  it('lists contracts for a supplier profile', (done) => {
    service.listContracts('supplier-1', 'C-100').subscribe((res) => {
      expect(res.length).toBe(1);
      done();
    });
    const req = httpMock.expectOne((r) => r.url === `${apiUrl}/admin/billing/supplier-profiles/supplier-1/contracts`);

    expect(req.request.params.get('search')).toBe('C-100');
    req.flush([{ id: 'c-1', supplierId: 'supplier-1', contractNumber: 'C-100', createdAt: '' }]);
  });

  it('creates supplier profile', (done) => {
    const dto = { company: 'Acme GmbH', email: 'billing@acme.example' };

    service.create(dto).subscribe((res) => {
      expect(res.company).toBe('Acme GmbH');
      done();
    });
    const req = httpMock.expectOne(`${apiUrl}/admin/billing/supplier-profiles`);

    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(dto);
    req.flush({
      id: 'supplier-1',
      supplierNumber: 'S-1',
      company: 'Acme GmbH',
      email: 'billing@acme.example',
      isComplete: false,
      customData: {},
      createdAt: '',
      updatedAt: '',
    });
  });
});
