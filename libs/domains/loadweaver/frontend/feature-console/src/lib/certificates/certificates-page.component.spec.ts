import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { CertificatesService, type CertificateSummary } from '@forepath/loadweaver/frontend/data-access-console';
import { BehaviorSubject, of, throwError } from 'rxjs';

import { certificateState, LoadweaverCertificatesPageComponent } from './certificates-page.component';

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

describe('LoadweaverCertificatesPageComponent', () => {
  let fixture: ComponentFixture<LoadweaverCertificatesPageComponent>;
  let service: { list: jest.Mock };

  async function create(id: string | null, list = of([certificate(), certificate({ id: 'api', names: ['api.x'] })])) {
    service = { list: jest.fn().mockReturnValue(list) };

    const params = convertToParamMap(id ? { id } : {});

    await TestBed.configureTestingModule({
      imports: [LoadweaverCertificatesPageComponent],
      providers: [
        provideRouter([]),
        { provide: CertificatesService, useValue: service },
        {
          provide: ActivatedRoute,
          useValue: { paramMap: new BehaviorSubject(params), snapshot: { paramMap: params } },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LoadweaverCertificatesPageComponent);
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;

  it('lists the certificates', async () => {
    await create(null);

    expect(service.list).toHaveBeenCalledTimes(1);
    expect(el().querySelectorAll('[data-testid="certificates-table"] tbody tr')).toHaveLength(2);
    expect(el().querySelector('[data-testid="certificate-detail"]')).toBeNull();
  });

  it('shows the linked certificate', async () => {
    await create('shop-example-com');

    expect(fixture.componentInstance.selected()?.id).toBe('shop-example-com');
    expect(el().querySelector('[data-testid="certificate-detail"]')?.textContent).toContain('www.shop.example.com');
  });

  it("says when the linked certificate doesn't exist and reports errors", async () => {
    await create('gone');
    expect(el().querySelector('[data-testid="certificate-not-found"]')).not.toBeNull();

    TestBed.resetTestingModule();
    await create(
      null,
      throwError(() => new HttpErrorResponse({ status: 403, error: { message: 'forbidden' } })),
    );
    expect(fixture.componentInstance.error()).toBe('forbidden');
  });

  it('derives the state', () => {
    expect(certificateState(certificate(), NOW)).toBe('valid');
    expect(certificateState(certificate({ notAfter: new Date(NOW + 3 * DAY).toISOString() }), NOW)).toBe('expiring');
    expect(certificateState(certificate({ notAfter: new Date(NOW - DAY).toISOString() }), NOW)).toBe('expired');
    expect(certificateState(certificate({ notAfter: null }), NOW)).toBe('pending');
    expect(certificateState(certificate({ failures: 2, lastError: 'rate limited' }), NOW)).toBe('failing');
  });
});
