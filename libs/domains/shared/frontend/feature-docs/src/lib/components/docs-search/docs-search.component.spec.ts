import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';

import { DocsSearchService, type SearchResult } from '../../services';
import { DocsSearchComponent } from './docs-search.component';

describe('DocsSearchComponent', () => {
  let fixture: ComponentFixture<DocsSearchComponent>;
  let component: DocsSearchComponent;
  const router = { navigate: jest.fn(), serializeUrl: jest.fn(() => '/x'), createUrlTree: jest.fn() };
  const results = signal<SearchResult[]>([]);
  const service = {
    searchQuery: signal(''),
    searchResults: results,
    loadSearchIndex: jest.fn(() => of({})),
    search: jest.fn(),
    clearSearch: jest.fn(() => results.set([])),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    results.set([]);
    TestBed.configureTestingModule({
      imports: [DocsSearchComponent],
      providers: [
        { provide: DocsSearchService, useValue: service },
        { provide: Router, useValue: router },
      ],
    });
    fixture = TestBed.createComponent(DocsSearchComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  const key = (init: KeyboardEventInit, target: EventTarget = document.body) => {
    const event = new KeyboardEvent('keydown', { ...init, cancelable: true });

    Object.defineProperty(event, 'target', { value: target });
    component.onDocumentKeydown(event);

    return event;
  };

  it('renders the field-like top-bar trigger that opens the palette', () => {
    const trigger = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="docs-search-trigger"]',
    ) as HTMLButtonElement;

    expect(trigger.classList.contains('fpc-top-bar__search')).toBe(true);
    trigger.click();
    expect(component.paletteOpen()).toBe(true);
  });

  it('opens with Ctrl / ⌘ + K and "/" (not while typing in a field)', () => {
    expect(key({ key: 'k', ctrlKey: true }).defaultPrevented).toBe(true);
    expect(component.paletteOpen()).toBe(true);

    component.onPaletteOpenChange(false);
    key({ key: '/' }, document.createElement('input'));
    expect(component.paletteOpen()).toBe(false);

    key({ key: '/' });
    expect(component.paletteOpen()).toBe(true);
  });

  it('lists the results as palette entries and opens the picked page', () => {
    results.set([
      { entry: { path: '/docs/setup', title: 'Setup', summary: 'Install it' }, score: 1, highlights: [] } as never,
    ]);

    const [group] = component.groups();

    expect(group.items).toEqual([expect.objectContaining({ id: '/docs/setup', label: 'Setup', hint: 'Install it' })]);

    component.openPalette();
    component.onActivate({ item: group.items[0], group, newTab: false });

    expect(router.navigate).toHaveBeenCalledWith(['/docs/setup']);
    expect(component.paletteOpen()).toBe(false);
    expect(service.clearSearch).toHaveBeenCalled();
  });

  it('leads to the full results page with the query', () => {
    component.onQueryChange('install');
    component.onViewAllResults();

    expect(router.navigate).toHaveBeenCalledWith(['/search'], { queryParams: { q: 'install' } });
  });
});
