import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  ConsoleEndpointService,
  ConsoleSavedViewsService,
  type SavedView,
} from '@forepath/loadweaver/frontend/data-access-console';
import { of, throwError } from 'rxjs';

import { compatibleViewValue, sameViewState, savedViewBinding, stableViewJson, viewName } from './saved-views';
import { LoadweaverSavedViewsComponent } from './saved-views.component';
import { SavedViewsStore } from './saved-views.store';

function view(overrides: Partial<SavedView> = {}): SavedView {
  return {
    id: 'v1',
    scope: 'plans',
    name: 'Mine',
    state: { search: 'alice', status: 'pending' },
    createdAt: '2026-10-27T10:00:00Z',
    updatedAt: '2026-10-27T10:00:00Z',
    ...overrides,
  };
}

describe('saved views model', () => {
  it('binds signals: reads the state, applies compatible values and resets the rest', () => {
    const search = signal('');
    const status = signal<string>('');
    const columns = signal<string[] | null>(null);
    const binding = savedViewBinding({ search, status, columns });

    search.set('x');
    expect(binding.state()).toEqual({ search: 'x', status: '', columns: null });

    binding.apply({ search: 'alice', status: 42, columns: ['name'] });
    expect(search()).toBe('alice');
    expect(status()).toBe('');
    expect(columns()).toEqual(['name']);

    binding.apply({});
    expect(search()).toBe('');
    expect(columns()).toBeNull();
  });

  it('compares states independent of key order and density; validates names', () => {
    expect(stableViewJson({ b: 1, a: [{ d: 1, c: 2 }] })).toBe('{"a":[{"c":2,"d":1}],"b":1}');
    expect(sameViewState({ a: 1, b: 'x', density: 'compact' }, { b: 'x', a: 1 })).toBe(true);
    expect(sameViewState({ a: 1 }, { a: 2 })).toBe(false);
    expect(compatibleViewValue('', 3)).toBe(false);
    expect(compatibleViewValue([], ['a'])).toBe(true);
    expect(compatibleViewValue(null, 'x')).toBe(true);
    expect(viewName('  ')).toBeNull();
    expect(viewName(' Mine ')).toBe('Mine');
  });
});

describe('SavedViewsStore', () => {
  it('loads per scope, saves (update by name), renames and removes', async () => {
    const api = {
      list: jest.fn(() => of([view({ id: 'v2', name: 'Zed' }), view()])),
      create: jest.fn((request: { scope: string; name: string; state: Record<string, unknown> }) =>
        of(view({ id: 'v3', ...request })),
      ),
      update: jest.fn((id: string, request: { name?: string; state?: Record<string, unknown> }) =>
        of(view({ id, ...request })),
      ),
      remove: jest.fn(() => of(undefined)),
    };

    TestBed.configureTestingModule({ providers: [{ provide: ConsoleSavedViewsService, useValue: api }] });

    const store = TestBed.inject(SavedViewsStore);

    await store.load('plans');
    expect(
      store
        .views('plans')()
        .map((v) => v.name),
    ).toEqual(['Mine', 'Zed']);

    await store.save('plans', 'Mine', { search: 'bob' });
    expect(api.update).toHaveBeenCalledWith('v1', { state: { search: 'bob' } });
    await store.save('plans', 'New', { search: '' });
    expect(api.create).toHaveBeenCalledWith({ scope: 'plans', name: 'New', state: { search: '' } });
    expect(store.views('plans')()).toHaveLength(3);

    await store.rename(store.views('plans')()[0], 'Alpha');
    expect(api.update).toHaveBeenLastCalledWith('v1', { name: 'Alpha' });

    await store.remove(view({ id: 'v2' }));
    expect(
      store
        .views('plans')()
        .map((v) => v.id),
    ).toEqual(['v1', 'v3']);
    expect(store.views('tree')()).toEqual([]);
  });
});

describe('SavedViewsStore without a cluster API (fleet views, LW-25)', () => {
  it('loads nothing (no request to the placeholder relay path)', async () => {
    const api = { list: jest.fn(() => of([view()])) };

    TestBed.configureTestingModule({
      providers: [
        { provide: ConsoleSavedViewsService, useValue: api },
        { provide: ConsoleEndpointService, useValue: { hasClusterApi: () => false } },
      ],
    });

    const store = TestBed.inject(SavedViewsStore);

    expect(store.available()).toBe(false);
    await store.load('fleet-overview');
    expect(api.list).not.toHaveBeenCalled();
    expect(store.views('fleet-overview')()).toEqual([]);
    expect(store.error()).toBeNull();
  });
});

describe('SavedViewsStore when the fleet relay refuses the views (LW-25)', () => {
  it('hides the views for that cluster without an error (403: the cluster does not trust the fleet)', async () => {
    const active = signal<string | null>('c-1');
    const api = { list: jest.fn(() => throwError(() => ({ status: 403, error: { message: 'approvals need …' } }))) };

    TestBed.configureTestingModule({
      providers: [
        { provide: ConsoleSavedViewsService, useValue: api },
        {
          provide: ConsoleEndpointService,
          useValue: { fleetMode: true, activeClusterId: active, hasClusterApi: () => active() !== null },
        },
      ],
    });

    const store = TestBed.inject(SavedViewsStore);

    expect(store.available()).toBe(true);
    await store.load('plans');
    expect(store.error()).toBeNull();
    expect(store.available()).toBe(false);
    await store.load('audit');
    expect(api.list).toHaveBeenCalledTimes(1);
    // Another cluster asks again.
    active.set('c-2');
    expect(store.available()).toBe(true);
  });
});

describe('LoadweaverSavedViewsComponent', () => {
  it('marks the matching view, applies one (a stored density is ignored) and saves the current state', async () => {
    const views = signal([
      view(),
      view({ id: 'v2', name: 'Compact', state: { search: '', status: '', density: 'comfortable' } }),
    ]);
    const store = {
      views: () => views,
      load: jest.fn(),
      save: jest.fn(async () => view()),
      rename: jest.fn(),
      remove: jest.fn(async () => true),
      error: signal(null),
      available: () => true,
    };
    const search = signal('alice');
    const status = signal('pending');

    TestBed.configureTestingModule({
      imports: [LoadweaverSavedViewsComponent],
      providers: [{ provide: SavedViewsStore, useValue: store }],
    });

    const fixture = TestBed.createComponent(LoadweaverSavedViewsComponent);
    const component = fixture.componentInstance;

    fixture.componentRef.setInput('scope', 'plans');
    fixture.componentRef.setInput('binding', savedViewBinding({ search, status }));
    fixture.detectChanges();
    expect(store.load).toHaveBeenCalledWith('plans');
    expect(component.active()?.id).toBe('v1');
    const host = fixture.nativeElement as HTMLElement;
    const trigger = host.querySelector<HTMLButtonElement>('button[aria-label="Views"]');

    // One slot everywhere (3.38): square icon-only dark trigger; name in the tooltip, a dot marks the applied view.
    expect(trigger).not.toBeNull();
    expect(trigger?.textContent?.trim()).toBe('');
    expect(trigger?.classList).toContain('btn-sm');
    expect(trigger?.classList).toContain('fpc-button__btn--icon');
    expect(trigger?.classList).toContain('btn-dark');
    // The menu body uses shared buttons, no raw Bootstrap buttons.
    expect(host.querySelector('.lw-views button.btn:not(.fpc-button__btn)')).toBeNull();
    expect(trigger?.getAttribute('title')).toBe('Views: Mine');
    expect(host.querySelector('[data-testid="saved-views-active"]')).not.toBeNull();

    expect(trigger?.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger?.getAttribute('aria-expanded')).toBe('false');
    expect(trigger?.hasAttribute('aria-controls')).toBe(false);

    trigger?.click();
    fixture.detectChanges();
    expect(host.textContent).toContain('Mine');
    expect(trigger?.getAttribute('aria-expanded')).toBe('true');
    expect(trigger?.getAttribute('aria-controls')).toBe(host.querySelector('[role="menu"]')?.id);
    expect(trigger?.getAttribute('aria-controls')).toBeTruthy();
    trigger?.click();
    fixture.detectChanges();

    component.apply(views()[1]);
    expect(search()).toBe('');
    expect(component.active()?.id).toBe('v2');

    component.startSave();
    component.draftName = 'Fresh';
    await component.save();
    expect(store.save).toHaveBeenCalledWith('plans', 'Fresh', { search: '', status: '' });
    expect(component.saving()).toBe(false);

    component.deleting.set('v1');
    await component.remove(views()[0]);
    expect(store.remove).toHaveBeenCalled();
  });

  it('renders a square dark icon-only trigger in a page-header actions slot', () => {
    @Component({
      standalone: true,
      imports: [LoadweaverSavedViewsComponent],
      template: `<loadweaver-saved-views fpcPageHeaderActions scope="audit" [binding]="binding" />`,
    })
    class HostComponent {
      readonly binding = savedViewBinding({ search: signal('') });
    }

    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        {
          provide: SavedViewsStore,
          useValue: { views: () => signal([]), load: jest.fn(), error: signal(null), available: () => true },
        },
      ],
    });

    const fixture = TestBed.createComponent(HostComponent);

    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const trigger = host.querySelector<HTMLButtonElement>('button[aria-label="Views"]');

    expect(trigger?.classList).toContain('fpc-button__btn--icon');
    expect(trigger?.classList).toContain('btn-dark');
    expect(trigger?.getAttribute('title')).toBe('Views');
    expect(host.querySelector('[data-testid="saved-views-active"]')).toBeNull();
  });

  it('renders nothing where views cannot be stored (fleet views without an active cluster, LW-25)', () => {
    TestBed.configureTestingModule({
      imports: [LoadweaverSavedViewsComponent],
      providers: [
        {
          provide: SavedViewsStore,
          useValue: { views: () => signal([]), load: jest.fn(), error: signal(null), available: () => false },
        },
      ],
    });

    const fixture = TestBed.createComponent(LoadweaverSavedViewsComponent);

    fixture.componentRef.setInput('scope', 'fleet-overview');
    fixture.componentRef.setInput('binding', savedViewBinding({ search: signal('') }));
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="saved-views"]')).toBeNull();
  });
});
