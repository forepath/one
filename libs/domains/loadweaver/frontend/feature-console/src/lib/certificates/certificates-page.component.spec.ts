import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { CertificatesService, type CertificateSummary } from '@forepath/loadweaver/frontend/data-access-console';
import { BehaviorSubject, of, throwError } from 'rxjs';

import { MasterDetailState } from '../section/master-detail.component';
import { LoadweaverCertificateDetailPageComponent } from './certificate-detail-page.component';
import { certificateState, certificateTitle, LoadweaverCertificatesPageComponent } from './certificates-page.component';
import { LoadweaverCertificatesStore } from './certificates-store';

const NOW = Date.parse('2026-10-18T12:00:00.000Z');
const DAY = 86_400_000;

function certificate(overrides: Partial<CertificateSummary> = {}): CertificateSummary {
  return {
    id: 'shop-example-com',
    names: ['shop.example.com', 'www.shop.example.com'],
    source: 'acme',
    notAfter: new Date(NOW + 60 * DAY).toISOString(),
    failures: 0,
    lastError: null,
    ...overrides,
  };
}

describe('LoadweaverCertificatesPageComponent (master-detail list | detail)', () => {
  let service: { list: jest.Mock };

  async function configure(
    id: string | null,
    list = of([certificate(), certificate({ id: 'api', names: ['api.x'] })]),
  ) {
    service = { list: jest.fn().mockReturnValue(list) };

    const params = convertToParamMap(id ? { id } : {});

    await TestBed.configureTestingModule({
      imports: [LoadweaverCertificatesPageComponent, LoadweaverCertificateDetailPageComponent],
      providers: [
        provideRouter([]),
        LoadweaverCertificatesStore,
        MasterDetailState,
        { provide: CertificatesService, useValue: service },
        {
          provide: ActivatedRoute,
          useValue: { paramMap: new BehaviorSubject(params), snapshot: { paramMap: params } },
        },
      ],
    }).compileComponents();
  }

  function list(): ComponentFixture<LoadweaverCertificatesPageComponent> {
    const fixture = TestBed.createComponent(LoadweaverCertificatesPageComponent);

    fixture.detectChanges();

    return fixture;
  }

  function detail(): ComponentFixture<LoadweaverCertificateDetailPageComponent> {
    const fixture = TestBed.createComponent(LoadweaverCertificateDetailPageComponent);

    fixture.detectChanges();

    return fixture;
  }

  const el = (fixture: ComponentFixture<unknown>) => fixture.nativeElement as HTMLElement;

  it('lists the certificates in a data table and opens one', async () => {
    await configure(null);

    const fixture = list();
    const navigate = jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    expect(service.list).toHaveBeenCalledTimes(1);
    expect(el(fixture).querySelectorAll('[data-testid="certificates-table"] tr.fpc-data-table__row')).toHaveLength(2);
    expect(el(fixture).querySelector('table:not(fpc-data-table table)')).toBeNull();
    expect(el(fixture).querySelector('[data-testid="fpc-data-table-state"]')?.getAttribute('aria-label')).toBeTruthy();
    expect(el(fixture).querySelector('a.fpc-data-table__link')?.getAttribute('href')).toContain(
      '/delivery/certificates/',
    );

    fixture.componentInstance.open(certificate({ id: 'api' }));
    expect(navigate).toHaveBeenCalledWith(['/delivery/certificates', 'api']);
  });

  it('marks the open certificate', async () => {
    await configure(null);
    TestBed.inject(MasterDetailState).selectedId.set('api');

    const fixture = list();

    expect(fixture.componentInstance.selectedId()).toBe('api');
  });

  it('searches the certificates by id and name', async () => {
    await configure(null);

    const fixture = list();

    fixture.componentInstance.search.set('API.X');
    fixture.detectChanges();
    expect(el(fixture).querySelectorAll('[data-testid="certificates-table"] tr.fpc-data-table__row')).toHaveLength(1);

    fixture.componentInstance.search.set('nothing');
    fixture.detectChanges();
    expect(
      el(fixture).querySelector('[data-testid="certificates-table"] [data-testid="fpc-data-table-no-matches"]'),
    ).not.toBeNull();
  });

  it('shows the linked certificate as facts with the back link', async () => {
    await configure('shop-example-com');

    const fixture = detail();

    expect(service.list).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.selected()?.id).toBe('shop-example-com');
    expect(el(fixture).querySelector('[data-testid="certificate-detail"] fpc-key-value-list')?.textContent).toContain(
      'www.shop.example.com',
    );
    expect(el(fixture).querySelector('[data-testid="certificate-back"]')).not.toBeNull();
    expect(el(fixture).querySelector('dl.row')).toBeNull();
  });

  it("says when the linked certificate doesn't exist and reports errors", async () => {
    await configure('gone');
    expect(el(detail()).querySelector('[data-testid="certificate-not-found"]')).not.toBeNull();

    TestBed.resetTestingModule();
    await configure(
      null,
      throwError(() => new HttpErrorResponse({ status: 403, error: { message: 'forbidden' } })),
    );
    expect(list().componentInstance.error()).toBe('forbidden');
  });

  it('derives the state', () => {
    expect(certificateState(certificate(), NOW)).toBe('valid');
    expect(certificateState(certificate({ notAfter: new Date(NOW + 3 * DAY).toISOString() }), NOW)).toBe('expiring');
    expect(certificateState(certificate({ notAfter: new Date(NOW - DAY).toISOString() }), NOW)).toBe('expired');
    expect(certificateState(certificate({ notAfter: null }), NOW)).toBe('pending');
    expect(certificateState(certificate({ failures: 2, lastError: 'rate limited' }), NOW)).toBe('failing');
  });
});

describe('certificate titles (D11, LW-22)', () => {
  it('names a certificate by its first DNS name (+N), the id only without names', () => {
    expect(certificateTitle({ id: 'api-example-com', names: ['api.example.com'] })).toBe('api.example.com');
    expect(certificateTitle({ id: 'x', names: ['a.example.org', 'b.example.org', 'c.example.org'] })).toBe(
      'a.example.org +2',
    );
    expect(certificateTitle({ id: 'empty', names: [] })).toBe('empty');
  });
});
