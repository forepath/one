import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ConsoleAccessFacade, ConsoleSlosFacade, type Slo } from '@forepath/loadweaver/frontend/data-access-console';

import { accessStub, facadeStub } from '../testing';
import { LoadweaverSlosPageComponent } from './slos-page.component';

function slo(overrides: Partial<Slo> = {}): Slo {
  return {
    project: 'shop',
    deployment: 'web',
    service: 'api',
    hosts: ['api.example.com'],
    window: '30d',
    availability: { target: 99.9, sli: 99.97, budget: 0.1, consumed: 0.3, burnRate1h: 0.2, state: 'ok' },
    latency: {
      target: 99,
      sli: 99.6,
      budget: 1,
      consumed: 0.4,
      burnRate1h: 0,
      state: 'ok',
      percentile: 'p95',
      thresholdMs: 300,
    },
    monthlyUptime: 99.98,
    state: 'ok',
    ...overrides,
  };
}

describe('LoadweaverSlosPageComponent', () => {
  let fixture: ComponentFixture<LoadweaverSlosPageComponent>;
  let facade: ReturnType<typeof facadeStub>;

  beforeEach(async () => {
    facade = facadeStub(
      {
        slos$: [
          slo(),
          slo({
            project: 'blog',
            service: 'front',
            latency: undefined,
            availability: { target: 99.5, sli: 98, budget: 0.5, consumed: 4, burnRate1h: 20, state: 'burning' },
            state: 'burning',
          }),
        ],
        loading$: false,
        error$: null,
        counts$: { total: 2, ok: 1, burning: 1, exhausted: 0, noData: 0 },
      },
      ['load'],
    );

    await TestBed.configureTestingModule({
      imports: [LoadweaverSlosPageComponent],
      providers: [
        provideRouter([]),
        { provide: ConsoleSlosFacade, useValue: facade },
        {
          provide: ConsoleAccessFacade,
          useValue: accessStub({ userId: 'u', clusterRole: null, projects: { shop: 'viewer' } }),
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LoadweaverSlosPageComponent);
    fixture.detectChanges();
  });

  const el = () => fixture.nativeElement as HTMLElement;

  it('loads every readable SLO and shows the most urgent first with budget rings', () => {
    expect(facade['load']).toHaveBeenCalledWith(null);

    const cards = el().querySelectorAll('[data-testid^="slo-"][data-testid*="/"]');

    expect(Array.from(cards).map((c) => c.getAttribute('data-testid'))).toEqual([
      'slo-blog/web/front',
      'slo-shop/web/api',
    ]);
    expect(el().querySelectorAll('fpc-progress-ring')).toHaveLength(3);
    expect(el().textContent).toContain('99.98 %');
    expect(el().textContent).toContain('p95 ≤ 300 ms');
  });

  it('filters by project (API) and state (client)', () => {
    const component = fixture.componentInstance;

    expect(component.projects()).toEqual(['blog', 'shop']);

    component.onProjectChange('shop');
    expect(facade['load']).toHaveBeenLastCalledWith('shop');

    component.state.set('burning');
    expect(component.shown().map((s) => s.service)).toEqual(['front']);
  });
});
