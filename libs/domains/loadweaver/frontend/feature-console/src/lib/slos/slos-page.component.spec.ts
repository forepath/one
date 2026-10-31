import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { ConsoleAccessFacade, ConsoleSlosFacade, type Slo } from '@forepath/loadweaver/frontend/data-access-console';

import { LW_SECTION_SCOPE } from '../section/section-scope';
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

  async function create(
    scope: Record<string, string> | null = null,
    slos: Slo[] = [
      slo(),
      slo({
        project: 'blog',
        service: 'front',
        latency: undefined,
        availability: { target: 99.5, sli: 98, budget: 0.5, consumed: 4, burnRate1h: 20, state: 'burning' },
        state: 'burning',
      }),
    ],
  ) {
    facade = facadeStub(
      {
        slos$: slos,
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
        ...(scope ? [{ provide: LW_SECTION_SCOPE, useValue: { params: signal(scope) } }] : []),
        {
          provide: ConsoleAccessFacade,
          useValue: accessStub({ userId: 'u', clusterRole: null, projects: { shop: 'viewer' } }),
        },
      ],
    }).compileComponents();

    navigate = jest.spyOn(TestBed.inject(Router), 'navigate');
    fixture = TestBed.createComponent(LoadweaverSlosPageComponent);
    fixture.detectChanges();
  }

  let navigate: jest.SpyInstance;

  beforeEach(() => create());

  const el = () => fixture.nativeElement as HTMLElement;

  it('loads every readable SLO and shows the most urgent first as table rows with budget bars', () => {
    expect(facade['load']).toHaveBeenCalledWith(null);

    const table = el().querySelector('[data-testid="slos-list"]');
    const links = [...(table?.querySelectorAll('a.fpc-data-table__link') ?? [])].map((a) => a.textContent?.trim());

    expect(links).toEqual(['blog/web/front', 'shop/web/api']);
    expect(table?.querySelectorAll('fpc-progress')).toHaveLength(3);
    expect(el().querySelector('fpc-panel')).toBeNull();
    expect(table?.querySelector('[data-testid="fpc-data-table-state"]')?.getAttribute('aria-label')).toBe('Burning');
    expect(el().textContent).toContain('99.98 %');
    expect(el().textContent).toContain('p95 ≤ 300 ms');
  });

  it('shows no read-only note while the control plane is writable', () => {
    expect(el().querySelector('[data-testid="slos-read-only"]')).toBeNull();
  });

  it('says the SLOs are as of the last stored sample while the control plane is read-only (3.43)', async () => {
    TestBed.resetTestingModule();
    await create(null, [slo({ asOf: '2026-10-31T08:00:00.000Z' })]);

    const note = el().querySelector('[data-testid="slos-read-only"]')?.textContent ?? '';

    expect(note).toContain('as of');
    expect(note).toContain('(read-only)');
    expect(note).toContain('10/31/26');
  });

  it('filters by project (API) and state (client)', () => {
    const component = fixture.componentInstance;

    expect(component.projects()).toEqual(['blog', 'shop']);

    component.filterState.patch({ project: 'shop' });
    component.filterState.apply();
    expect(facade['load']).toHaveBeenLastCalledWith('shop');

    component.state.set('burning');
    expect(component.shown().map((s) => s.service)).toEqual(['front']);
  });

  it('puts health / logs in ⋮, links the SLO to its health page and searches the SLOs', () => {
    const component = fixture.componentInstance;

    expect(component.rowMenu().map((i) => i.id)).toEqual(['health', 'logs']);
    expect(el().querySelector('a.fpc-data-table__link')?.getAttribute('href')).toContain('/observe/health/service/');
    expect(el().querySelector('fpc-list-header')).toBeNull();

    component.search.set('BLOG');
    fixture.detectChanges();
    expect(component.shown().map((s) => s.service)).toEqual(['front']);

    component.search.set('nothing-like-this');
    fixture.detectChanges();
    expect(el().querySelector('[data-testid="fpc-data-table-no-matches"]')).not.toBeNull();
  });

  it('embedded in a project tab: loads the scope project, hides the picker and header, no URL writes', async () => {
    TestBed.resetTestingModule();
    await create({ project: 'shop' });

    expect(facade['load']).toHaveBeenCalledWith('shop');
    expect(el().querySelector('fpc-page-header')).toBeNull();
    expect(el().querySelector('[data-testid="slos-refresh"]')).not.toBeNull();
    expect(fixture.componentInstance.filterState.activeCount()).toBe(0);

    fixture.componentInstance.filterState.clear();
    expect(fixture.componentInstance.project()).toBe('shop');
    (el().querySelector('.fpc-list-toolbar__toggle') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el().querySelector('[data-testid="slos-project"]')).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });
});
