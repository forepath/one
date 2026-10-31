import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import {
  ConsoleAccessFacade,
  ConsoleEndpointService,
  ConsoleSearchFacade,
  type SearchResult,
} from '@forepath/loadweaver/frontend/data-access-console';

import { ConsoleNavService } from '../nav/console-nav.service';
import { accessStub, facadeStub } from '../testing';
import { LoadweaverSearchActionConfirmComponent } from './search-action-confirm.component';
import { LoadweaverSearchPaletteComponent, PALETTE_LIMIT } from './search-palette.component';

function result(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    id: 'Deployment:shop/web',
    kind: 'Deployment',
    title: 'Deployment shop/web',
    project: 'shop',
    link: '/projects/shop/deployments/web',
    favourite: false,
    ...overrides,
  };
}

const drain = { title: 'Drain node n2', kind: 'api' as const, request: { method: 'POST', path: '/nodes/n2/drain' } };

describe('LoadweaverSearchPaletteComponent', () => {
  let fixture: ComponentFixture<LoadweaverSearchPaletteComponent>;
  let facade: ReturnType<typeof facadeStub>;
  let router: Router;

  beforeEach(async () => {
    facade = facadeStub(
      {
        results$: [
          result(),
          result({ id: 'Node:n2', kind: 'Node', title: 'Node n2', project: null, link: '/resources/node/n2' }),
        ],
        actions$: [drain, { title: 'Create plan', kind: 'navigate', link: '/create' }],
        favourites$: [],
        favouritesLoaded$: false,
        recent$: [],
        loading$: false,
        error$: null,
        actionResult$: null,
        running$: null,
        query$: '',
      },
      ['search', 'loadFavourites', 'setFavourite', 'visit', 'runAction', 'clearActionResult'],
    );

    await TestBed.configureTestingModule({
      imports: [LoadweaverSearchPaletteComponent],
      providers: [
        provideRouter([]),
        { provide: ConsoleSearchFacade, useValue: facade },
        { provide: ConsoleEndpointService, useValue: { fleetMode: false } },
        { provide: ConsoleAccessFacade, useValue: accessStub() },
        { provide: ConsoleNavService, useValue: { url: signal('/resources/node/n1') } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LoadweaverSearchPaletteComponent);
    router = TestBed.inject(Router);
    jest.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    jest.spyOn(router, 'navigate').mockResolvedValue(true);
    fixture.detectChanges();
  });

  function keydown(init: KeyboardEventInit): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true });

    document.dispatchEvent(event);

    return event;
  }

  it('opens with Ctrl / Cmd + K (only when enabled) and loads the favourites once', () => {
    const component = fixture.componentInstance;

    fixture.componentRef.setInput('enabled', false);
    keydown({ key: 'k', ctrlKey: true });
    expect(component.open()).toBe(false);

    fixture.componentRef.setInput('enabled', true);
    const event = keydown({ key: 'K', metaKey: true });

    expect(component.open()).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(facade['loadFavourites']).toHaveBeenCalledTimes(1);

    keydown({ key: 'k', ctrlKey: true });
    expect(component.open()).toBe(false);

    // Reopening asks again (favourites belong to whoever is signed in now).
    facade['favouritesLoaded$'].next(true);
    keydown({ key: 'k', ctrlKey: true });
    expect(facade['loadFavourites']).toHaveBeenCalledTimes(2);
    keydown({ key: 'k', ctrlKey: true });
    keydown({ key: 'k' });
    expect(component.open()).toBe(false);
  });

  it('searches as the query changes and groups actions before results by kind', () => {
    const component = fixture.componentInstance;

    component.show();
    component.onQueryChange('web');

    expect(facade['search']).toHaveBeenCalledWith('web', PALETTE_LIMIT);
    expect(component.sections().map((s) => s.id)).toEqual(['actions', 'kind:Deployment', 'kind:Node']);
  });

  it('opens a result on activation, recording the visit (the object page reveals it in the tree)', () => {
    const component = fixture.componentInstance;

    component.show();
    component.onQueryChange('web');
    fixture.detectChanges();

    const group = component.groups().find((g) => g.id === 'kind:Deployment');
    const item = group?.items[0];

    expect(item?.label).toBe('Deployment shop/web');
    component.onActivate({ item: item!, group: group!, newTab: false });

    expect(facade['visit']).toHaveBeenCalledWith(result());
    expect(router.navigateByUrl).toHaveBeenCalledWith('/resources/deployment/shop/web');
    expect(component.open()).toBe(false);
  });

  it('offers the open object page tabs as commands', () => {
    const component = fixture.componentInstance;

    component.show();
    expect(
      component
        .groups()
        .find((g) => g.id === 'tabs')
        ?.items.map((i) => i.id),
    ).toContain('tab:logs');

    const tabs = component.groups().find((g) => g.id === 'tabs')!;

    component.onActivate({ item: tabs.items.find((i) => i.id === 'tab:logs')!, group: tabs, newTab: false });
    expect(router.navigate).toHaveBeenCalledWith([], { queryParams: { tab: 'logs' } });
  });

  it('narrows results with scope tokens and searches the text part only', () => {
    const component = fixture.componentInstance;

    component.show();
    component.onQueryChange('in:project/shop kind:Deployment web');

    expect(facade['search']).toHaveBeenLastCalledWith('web', PALETTE_LIMIT);
    expect(component.sections().map((s) => s.id)).toEqual(['actions', 'kind:Deployment']);
  });

  it('navigates link actions and confirms API actions before running them', () => {
    const component = fixture.componentInstance;

    component.show();
    component.onQueryChange('n2');
    component.pick({ type: 'action', id: 'a', action: { title: 'Create plan', kind: 'navigate', link: '/create' } });
    expect(router.navigateByUrl).toHaveBeenCalledWith('/create');

    component.pick({ type: 'action', id: 'b', action: drain });
    fixture.detectChanges();
    expect(component.pendingAction()).toEqual(drain);
    expect(facade['runAction']).not.toHaveBeenCalled();
    expect(document.body.querySelector('[data-testid="search-action-request"]')?.textContent).toContain(
      'POST /nodes/n2/drain',
    );

    const confirm = fixture.debugElement.query(
      (d) => d.componentInstance instanceof LoadweaverSearchActionConfirmComponent,
    ).componentInstance as LoadweaverSearchActionConfirmComponent;

    confirm.confirm();
    expect(facade['runAction']).toHaveBeenCalledWith(drain);
    expect(component.pendingAction()).toBeNull();
  });

  it('stars results and opens the full results page', () => {
    const component = fixture.componentInstance;

    component.star(result());
    expect(facade['setFavourite']).toHaveBeenCalledWith('Deployment:shop/web', true);
    component.star(result({ favourite: true }));
    expect(facade['setFavourite']).toHaveBeenLastCalledWith('Deployment:shop/web', false);

    component.show();
    component.onQueryChange(' web ');
    component.showAll();
    expect(router.navigate).toHaveBeenCalledWith(['/search'], { queryParams: { q: 'web' } });
  });

  it('shows the outcome of an action', () => {
    facade['actionResult$'].next({ title: 'Drain node n2', ok: false, error: 'forbidden' });
    fixture.detectChanges();

    expect(document.body.textContent).toContain('Drain node n2: forbidden');
  });
});
