import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';

import type { AddonResponse, CreateAddonDto, UpdateAddonDto } from '../types/billing.types';

import { AddonsService } from './addons.service';

describe('AddonsService', () => {
  let service: AddonsService;
  let httpMock: HttpTestingController;
  const apiUrl = 'http://localhost:3200/api';
  const mockAddon: AddonResponse = {
    id: 'addon-1',
    key: 'backup',
    name: 'Backup',
    implementationType: 'module',
    moduleKey: 'backup',
    configSchema: {},
    compatibleProviders: ['hetzner'],
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
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

    service = TestBed.inject(AddonsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('listAddons', () => {
    it('lists addons', (done) => {
      service.listAddons().subscribe((list) => {
        expect(list).toEqual([mockAddon]);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/addons`);
      expect(req.request.method).toBe('GET');
      req.flush([mockAddon]);
    });

    it('includes pagination parameters when provided', (done) => {
      service.listAddons({ limit: 10, offset: 20 }).subscribe((list) => {
        expect(list).toEqual([mockAddon]);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/addons?limit=10&offset=20`);
      expect(req.request.params.get('limit')).toBe('10');
      expect(req.request.params.get('offset')).toBe('20');
      req.flush([mockAddon]);
    });
  });

  describe('getAddon', () => {
    it('returns an addon by id', (done) => {
      service.getAddon('addon-1').subscribe((addon) => {
        expect(addon).toEqual(mockAddon);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/addons/addon-1`);
      expect(req.request.method).toBe('GET');
      req.flush(mockAddon);
    });
  });

  describe('createAddon', () => {
    it('creates an addon', (done) => {
      const dto: CreateAddonDto = {
        key: 'backup',
        name: 'Backup',
        implementationType: 'module',
        moduleKey: 'backup',
      };

      service.createAddon(dto).subscribe((addon) => {
        expect(addon).toEqual(mockAddon);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/addons`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(dto);
      req.flush(mockAddon);
    });
  });

  describe('updateAddon', () => {
    it('updates an addon', (done) => {
      const dto: UpdateAddonDto = { name: 'Updated' };

      service.updateAddon('addon-1', dto).subscribe((addon) => {
        expect(addon).toEqual(mockAddon);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/addons/addon-1`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(dto);
      req.flush(mockAddon);
    });
  });

  describe('deleteAddon', () => {
    it('deletes an addon', (done) => {
      service.deleteAddon('addon-1').subscribe((result) => {
        expect(result).toBeNull();
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/addons/addon-1`);
      expect(req.request.method).toBe('DELETE');
      req.flush(null);
    });
  });

  describe('addon meters', () => {
    const attachedMeter = {
      meterId: 'meter-1',
      key: 'api_calls',
      name: 'API Calls',
      aggregator: 'max' as const,
      defaultUnitPriceNet: 0.01,
      effectiveUnitPriceNet: 0.01,
      isActive: true,
    };

    it('lists addon meters', (done) => {
      service.listAddonMeters('addon-1').subscribe((meters) => {
        expect(meters).toEqual([attachedMeter]);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/addons/addon-1/meters`);
      expect(req.request.method).toBe('GET');
      req.flush([attachedMeter]);
    });

    it('attaches an addon meter', (done) => {
      service.attachAddonMeter('addon-1', { meterId: 'meter-1' }).subscribe((meter) => {
        expect(meter).toEqual(attachedMeter);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/addons/addon-1/meters`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ meterId: 'meter-1' });
      req.flush(attachedMeter);
    });

    it('updates an addon meter override', (done) => {
      service.updateAddonMeter('addon-1', 'meter-1', { unitPriceNet: 0.05 }).subscribe((meter) => {
        expect(meter.effectiveUnitPriceNet).toBe(0.05);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/addons/addon-1/meters/meter-1`);
      expect(req.request.method).toBe('POST');
      req.flush({ ...attachedMeter, effectiveUnitPriceNet: 0.05 });
    });

    it('detaches an addon meter', (done) => {
      service.detachAddonMeter('addon-1', 'meter-1').subscribe(() => done());

      const req = httpMock.expectOne(`${apiUrl}/addons/addon-1/meters/meter-1`);
      expect(req.request.method).toBe('DELETE');
      req.flush(null);
    });
  });

  describe('listAddonModules', () => {
    it('lists registered addon modules', (done) => {
      const modules = [
        {
          key: 'backup',
          displayName: 'Backup',
          meters: [{ key: 'traffic', name: 'Traffic', aggregator: 'max' as const, defaultUnitPriceNet: 0.01 }],
        },
      ];

      service.listAddonModules().subscribe((list) => {
        expect(list).toEqual(modules);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/addons/modules`);
      expect(req.request.method).toBe('GET');
      req.flush(modules);
    });
  });
});
