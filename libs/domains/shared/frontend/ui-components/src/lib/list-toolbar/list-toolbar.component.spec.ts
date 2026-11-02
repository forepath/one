import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';

import type { FpcFilterChip } from '../filter-chips/filter-chips.component';
import { fpcDecodeFilterParam, fpcEncodeFilterParam, fpcListQueryState } from './list-query-state';
import { FpcListToolbarComponent } from './list-toolbar.component';

@Component({
  standalone: true,
  imports: [FpcListToolbarComponent],
  template: `
    <fpc-list-toolbar
      [(open)]="open"
      title="Filters"
      [filterable]="filterable()"
      [activeCount]="query.activeCount()"
      [chips]="chips()"
      (applied)="query.apply()"
      (cleared)="query.clear()"
      (chipRemove)="removed.set($event.id)"
    >
      <input fpcListToolbarLead class="lead-search" aria-label="Search" />
      <button fpcListToolbarActions type="button" class="views">Views</button>
      <select class="status" [value]="query.draft().status" (change)="onStatus($event)">
        <option value="">All</option>
        <option value="failed">Failed</option>
      </select>
      <input class="note" />
    </fpc-list-toolbar>
    <p class="outside">outside</p>
  `,
})
class HostComponent {
  open = signal(false);
  filterable = signal(true);
  status = signal('');
  search = signal('');
  removed = signal<string | null>(null);
  chips = signal<FpcFilterChip[]>([]);
  query = fpcListQueryState({ filters: { status: this.status }, search: this.search, open: this.open, debounceMs: 0 });

  onStatus(event: Event): void {
    this.query.patch({ status: (event.target as HTMLSelectElement).value });
  }
}

function setup() {
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  const fixture = TestBed.createComponent(HostComponent);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const toggle = () => el.querySelector('[data-testid="fpc-list-toolbar-toggle"]') as HTMLButtonElement;

  return { fixture, el, host: fixture.componentInstance, toggle };
}

describe('FpcListToolbarComponent', () => {
  it('puts search (lead), toggle and actions in one strip; the drawer opens below it with Apply', () => {
    const { fixture, el, toggle } = setup();
    const strip = el.querySelector('.fpc-list-toolbar__strip') as HTMLElement;

    expect(strip.querySelector('.fpc-list-toolbar__lead .lead-search')).not.toBeNull();
    expect(strip.querySelector('.fpc-list-toolbar__actions .views')).not.toBeNull();
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(el.querySelector('.status')).toBeNull();

    toggle().click();
    fixture.detectChanges();
    const body = el.querySelector('.fpc-list-toolbar__body') as HTMLElement;
    expect(toggle().getAttribute('aria-controls')).toBe(body.id);
    expect(body.querySelector('.fpc-filter-grid .status')).not.toBeNull();
    // Live filters: no Apply button / footer.
    expect(body.querySelector('[data-testid="fpc-list-toolbar-apply"]')).toBeNull();
    expect(body.querySelector('.fpc-list-toolbar__footer')).toBeNull();
    expect(body.querySelector('.lead-search')).toBeNull();
  });

  it('applies drawer values live (drawer stays open); the count badge and Clear all follow the applied filters', () => {
    const { fixture, el, host, toggle } = setup();

    toggle().click();
    fixture.detectChanges();
    expect(toggle().textContent).not.toContain('1');
    const select = el.querySelector('.status') as HTMLSelectElement;
    select.value = 'failed';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    fixture.detectChanges();
    expect(host.status()).toBe('failed');
    expect(host.open()).toBe(true);
    expect(toggle().textContent).toContain('1');

    (el.querySelector('[data-testid="fpc-list-toolbar-clear"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(host.status()).toBe('');
    expect(el.querySelector('[data-testid="fpc-list-toolbar-clear"]')).toBeNull();
  });

  it('closes with Enter in a field, Esc and outside click; applied values stay', () => {
    const { fixture, el, host, toggle } = setup();

    toggle().click();
    fixture.detectChanges();
    host.query.patch({ status: 'failed' });
    (el.querySelector('.note') as HTMLInputElement).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
    fixture.detectChanges();
    expect(host.status()).toBe('failed');
    expect(host.open()).toBe(false);

    toggle().click();
    fixture.detectChanges();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(host.open()).toBe(false);
    expect(host.status()).toBe('failed');

    toggle().click();
    fixture.detectChanges();
    expect(host.query.draft().status).toBe('failed');
    (el.querySelector('.outside') as HTMLElement).dispatchEvent(new Event('pointerdown', { bubbles: true }));
    fixture.detectChanges();
    expect(host.open()).toBe(false);
  });

  it('is a plain search strip without filters and shows removable chips inline', () => {
    const { fixture, el, host } = setup();

    host.filterable.set(false);
    host.chips.set([{ id: 'kind', field: 'kind', value: 'Node' }]);
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="fpc-list-toolbar-toggle"]')).toBeNull();
    expect(el.querySelector('.fpc-list-toolbar__strip fpc-filter-chips')?.textContent).toContain('kind:Node');
    (el.querySelector('.fpc-filter-chips__remove') as HTMLButtonElement).click();
    expect(host.removed()).toBe('kind');
    // Chips count as active: Clear all shows.
    expect(el.querySelector('[data-testid="fpc-list-toolbar-clear"]')).not.toBeNull();
  });
});

describe('fpcListQueryState', () => {
  it('seeds from and writes the applied filters + search to the URL', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/?f=status%3Dfailed&q=web');
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const host = fixture.componentInstance;

    expect(host.status()).toBe('failed');
    expect(host.search()).toBe('web');
    expect(host.query.activeCount()).toBe(1);

    host.query.clear();
    host.search.set('');
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 5));
    await fixture.whenStable();
    expect(router.url).toBe('/');

    host.query.patch({ status: 'failed' });
    host.query.apply();
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 5));
    await fixture.whenStable();
    expect(router.url).toBe('/?f=status%3Dfailed');
  });

  it('round-trips the filter param', () => {
    const encoded = fpcEncodeFilterParam({ project: ['a', 'b c'], status: ['failed'], empty: [] });

    expect(encoded).toBe('project=a|b%20c;status=failed');
    expect(fpcDecodeFilterParam(encoded)).toEqual({ project: ['a', 'b c'], status: ['failed'] });
    expect(fpcEncodeFilterParam({})).toBeNull();
  });
});

@Component({ standalone: true, template: '' })
class PagedHostComponent {
  status = signal('');
  search = signal('');
  page = signal(1);
  pageSize = signal(25);
  sort = signal<{ column: string; direction: 'asc' | 'desc' } | null>(null);
  query = fpcListQueryState({
    filters: { status: this.status },
    search: this.search,
    page: this.page,
    pageSize: this.pageSize,
    sort: this.sort,
    debounceMs: 0,
  });
}

describe('fpcListQueryState paging', () => {
  it('seeds page / size / sort from the URL, writes them back and resets the page on Apply / search', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/?p=3&n=50&s=name:desc');
    const fixture = TestBed.createComponent(PagedHostComponent);
    fixture.detectChanges();
    const host = fixture.componentInstance;

    expect(host.page()).toBe(3);
    expect(host.pageSize()).toBe(50);
    expect(host.sort()).toEqual({ column: 'name', direction: 'desc' });

    host.query.patch({ status: 'failed' });
    host.query.apply();
    expect(host.page()).toBe(1);

    host.page.set(2);
    fixture.detectChanges();
    host.search.set('web');
    fixture.detectChanges();
    expect(host.page()).toBe(1);

    host.page.set(4);
    host.pageSize.set(25);
    host.sort.set(null);
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 5));
    await fixture.whenStable();
    expect(router.parseUrl(router.url).queryParams).toEqual({ f: 'status=failed', q: 'web', p: '4' });
  });
});
