import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import {
  ConsoleAccessFacade,
  ConsoleEndpointService,
  ConsoleSearchFacade,
  type AccessMe,
  type SearchResult,
} from '@forepath/loadweaver/frontend/data-access-console';
import { BehaviorSubject } from 'rxjs';

import { accessStub, facadeStub } from '../testing';
import { LoadweaverSearchPageComponent, SEARCH_PAGE_LIMIT } from './search-page.component';

function result(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    id: 'Node:n1',
    kind: 'Node',
    title: 'Node n1',
    project: null,
    link: '/nodes/n1',
    favourite: true,
    ...overrides,
  };
}

describe('LoadweaverSearchPageComponent', () => {
  let fixture: ComponentFixture<LoadweaverSearchPageComponent>;
  let facade: ReturnType<typeof facadeStub>;
  let params: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let router: Router;
  let endpoints: { fleetMode: boolean };
  let access: ReturnType<typeof accessStub>;

  beforeEach(async () => {
    endpoints = { fleetMode: false };
    access = accessStub({ userId: 'u1', clusterRole: 'auditor', projects: {} });
    params = new BehaviorSubject(convertToParamMap({ q: 'n1' }));
    facade = facadeStub(
      {
        results$: [
          result(),
          result({ id: 'Service:shop/web/api', kind: 'Service', title: 'Service shop/web/api', favourite: false }),
        ],
        actions$: [],
        favourites$: ['Node:n1'],
        favouritesLoaded$: false,
        recent$: [],
        loading$: false,
        error$: null,
      },
      ['search', 'loadFavourites', 'setFavourite', 'visit', 'runAction'],
    );

    await TestBed.configureTestingModule({
      imports: [LoadweaverSearchPageComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { queryParamMap: params, snapshot: { queryParamMap: params.value } } },
        { provide: ConsoleSearchFacade, useValue: facade },
        { provide: ConsoleEndpointService, useValue: endpoints },
        { provide: ConsoleAccessFacade, useValue: access },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LoadweaverSearchPageComponent);
    router = TestBed.inject(Router);
    jest.spyOn(router, 'navigate').mockResolvedValue(true);
    jest.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    fixture.detectChanges();
  });

  const el = () => fixture.nativeElement as HTMLElement;

  it('searches the query of the URL and shows favourites first', () => {
    expect(facade['loadFavourites']).toHaveBeenCalled();
    expect(facade['search']).toHaveBeenCalledWith('n1', SEARCH_PAGE_LIMIT);
    expect(el().querySelector('[data-testid="search-section-favourites"]')?.textContent).toContain('Node n1');
    expect(el().querySelectorAll('[data-testid="search-entry"]')).toHaveLength(2);

    params.next(convertToParamMap({ q: 'api' }));
    expect(facade['search']).toHaveBeenLastCalledWith('api', SEARCH_PAGE_LIMIT);
  });

  it('fleet mode: favourites only when the cluster verifies the fleet (per person, 2026-10-27)', () => {
    endpoints.fleetMode = true;
    (facade['loadFavourites'] as jest.Mock).mockClear();
    (access['me$'] as unknown as { next(v: AccessMe): void }).next({
      userId: null,
      clusterRole: 'auditor',
      projects: {},
      fleetIdentity: false,
    });

    const fleet = TestBed.createComponent(LoadweaverSearchPageComponent);
    const html = () => fleet.nativeElement as HTMLElement;

    fleet.detectChanges();
    expect(facade['loadFavourites']).not.toHaveBeenCalled();
    expect(html().querySelectorAll('[data-testid="search-entry"]').length).toBeGreaterThan(0);
    expect(html().querySelector('[data-testid="search-star"]')).toBeNull();
    expect(html().querySelector('[data-testid="search-star-hint"]')?.textContent).toContain('trust this fleet');

    (access['me$'] as unknown as { next(v: AccessMe): void }).next({
      userId: 'fleet:fleet-1:u1',
      clusterRole: 'auditor',
      projects: {},
      fleetIdentity: true,
    });
    fleet.detectChanges();
    expect(facade['loadFavourites']).toHaveBeenCalledTimes(1);
    expect(html().querySelector('[data-testid="search-star"]')).not.toBeNull();
    expect(html().querySelector('[data-testid="search-star-hint"]')).toBeNull();
  });

  it('keeps the query in the URL, opens results and stars them', () => {
    const component = fixture.componentInstance;

    const input = el().querySelector('[data-testid="search-page-input"] input') as HTMLInputElement;

    expect(input.value).toBe('n1');
    input.value = 'web';
    input.dispatchEvent(new Event('input'));
    expect(component.query()).toBe('web');
    expect(facade['search']).toHaveBeenLastCalledWith('web', SEARCH_PAGE_LIMIT);
    expect(router.navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({ queryParams: { q: 'web' }, replaceUrl: true }),
    );

    const api = Array.from(el().querySelectorAll<HTMLElement>('[data-testid="search-entry"]')).find((row) =>
      row.textContent?.includes('Service shop/web/api'),
    );

    expect(api?.getAttribute('role')).toBe('option');
    api?.click();
    expect(facade['visit']).toHaveBeenCalledWith(expect.objectContaining({ id: 'Service:shop/web/api' }));
    expect(router.navigateByUrl).toHaveBeenCalledWith('/observe/health/service/shop/web/api');

    (el().querySelector('[data-testid="search-star"] button') as HTMLButtonElement).click();
    expect(facade['setFavourite']).toHaveBeenCalledWith('Node:n1', false);
    expect(facade['visit']).toHaveBeenCalledTimes(1);
  });
});
