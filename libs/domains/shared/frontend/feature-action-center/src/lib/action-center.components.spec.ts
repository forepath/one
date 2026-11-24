import { LOCALE_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import {
  ActionCenterFacade,
  type ActionCenterGroup,
  type ActionCenterSilence,
  type ActionCenterView,
} from '@forepath/shared/frontend/data-access-action-center';
import { BehaviorSubject, of } from 'rxjs';

import { ActionCenterPanelComponent } from './action-center-panel/action-center-panel.component';
import { ActionCenterStackComponent } from './action-center-stack/action-center-stack.component';
import { ActionCenterToggleComponent } from './action-center-toggle/action-center-toggle.component';
import { paramText, provideActionCenterPresenters } from './presenters/action-center-presenter.types';
import { ActionCenterPresentersService } from './presenters/action-center-presenters.service';

function group(partial: Partial<ActionCenterGroup> = {}): ActionCenterGroup {
  return {
    type: 'test.invoices.unsent',
    category: 'receivables',
    severity: 'warning',
    kind: 'task',
    audience: 'administrative',
    total: 3,
    openCount: 3,
    params: {},
    items: [
      { id: 'i1', params: { number: 'R-1' }, occurredAt: '2026-11-24T09:00:00Z', silencedBy: null },
      { id: 'i2', params: { number: 'R-2' }, occurredAt: '2026-11-23T09:00:00Z', silencedBy: null },
      { id: 'i3', params: { number: 'R-3' }, occurredAt: '2026-11-22T09:00:00Z', silencedBy: 's-1' },
    ],
    silencedBy: null,
    ...partial,
  };
}

const presenters = provideActionCenterPresenters(() => ({
  categories: { receivables: 'Receivables', setup: 'Suggested next steps' },
  types: {
    'test.invoices.unsent': {
      icon: 'send',
      title: 'Invoices not sent yet',
      description: 'Send them.',
      link: () => ({ commands: ['/administration/billing'] }),
      itemTitle: (item) => paramText(item.params, 'number'),
      itemLink: (item) => ({
        commands: ['/administration/billing'],
        queryParams: { 'inv-q': paramText(item.params, 'number') },
      }),
    },
    'test.setup.issuer': {
      icon: 'building',
      title: 'Complete company details',
      link: () => ({ commands: ['/settings'] }),
    },
  },
}));

function createFacade(view: ActionCenterView | null) {
  const views = new BehaviorSubject(view);

  return {
    view$: views,
    connection$: of('live'),
    loading$: of(false),
    saving$: of(false),
    error$: of(null),
    panelOpen$: new BehaviorSubject(true),
    openCount$: of(view?.counts.open ?? 0),
    canSilenceForEveryone$: of(view?.canSilenceForEveryone ?? false),
    setupGroups$: of(view?.groups.filter((entry) => entry.kind === 'setup') ?? []),
    // Like the real selector: only categories with groups.
    taskCategories$: of(
      view?.groups.some((entry) => entry.kind === 'task')
        ? [{ category: 'receivables', groups: view.groups.filter((entry) => entry.kind === 'task') }]
        : [],
    ),
    silences$: of(view?.silences ?? []),
    setPanelOpen: jest.fn(),
    togglePanel: jest.fn(),
    silence: jest.fn(),
    removeSilence: jest.fn(),
    clearError: jest.fn(),
  };
}

const silence: ActionCenterSilence = {
  id: 's-1',
  itemType: 'test.invoices.unsent',
  itemId: 'i3',
  audience: 'everyone',
  until: null,
  createdAt: '2026-11-20T00:00:00Z',
  createdByUserId: 'u',
  removable: false,
};
const view: ActionCenterView = {
  generatedAt: '2026-11-24T10:00:00Z',
  role: 'manager',
  canSilenceForEveryone: false,
  counts: { open: 3, setup: 1, silenced: 1 },
  groups: [
    group({ type: 'test.setup.issuer', category: 'setup', kind: 'setup', total: 1, openCount: 1, items: [] }),
    group({ openCount: 2 }),
  ],
  silences: [silence],
};

describe('ActionCenterPresentersService', () => {
  it('renders texts from the presenters and falls back for unknown types', () => {
    TestBed.configureTestingModule({
      providers: [ActionCenterPresentersService, presenters, { provide: LOCALE_ID, useValue: 'en-US' }],
    });
    const service = TestBed.inject(ActionCenterPresentersService);
    const g = group();

    expect(service.title(g)).toBe('Invoices not sent yet');
    expect(service.itemTitle(g, g.items[0])).toBe('R-1');
    expect(service.itemLink(g, g.items[0])).toEqual({
      commands: ['/administration/billing'],
      queryParams: { 'inv-q': 'R-1' },
    });
    expect(service.categoryLabel('receivables')).toBe('Receivables');
    expect(service.presenter('test.unknown.type')).toEqual({ icon: 'bell', title: 'test.unknown.type' });
    expect(service.format.money('12.5', 'EUR')).toBe('€12.50');
  });
});

describe('ActionCenterStackComponent', () => {
  let fixture: ComponentFixture<ActionCenterStackComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ActionCenterStackComponent],
      providers: [provideRouter([]), ActionCenterPresentersService, presenters],
    });
    fixture = TestBed.createComponent(ActionCenterStackComponent);
    fixture.componentRef.setInput('group', group({ openCount: 2 }));
    fixture.detectChanges();
  });

  const host = () => fixture.nativeElement as HTMLElement;
  const query = (testId: string) => host().querySelector(`[data-testid="${testId}"]`) as HTMLElement | null;

  it('renders a stack of cards with the open count and the newest record', () => {
    expect(host().classList).toContain('ac-stack--stacked');
    expect(host().getAttribute('data-severity')).toBe('warning');
    expect(query('action-center-stack-title')?.textContent).toContain('Invoices not sent yet');
    expect(query('action-center-stack-count')?.textContent?.trim()).toBe('2');
    expect(query('action-center-stack-preview')?.textContent).toContain('R-1');
  });

  it('expands to the open records only and emits item navigation', () => {
    const navigate = jest.fn();

    fixture.componentInstance.navigate.subscribe(navigate);
    (query('action-center-stack-toggle')?.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();

    const items = host().querySelectorAll('[data-testid="action-center-item"]');

    expect(host().classList).not.toContain('ac-stack--stacked');
    expect(query('action-center-stack-toggle')?.querySelector('button')?.className).toContain('btn-secondary');
    expect(items).toHaveLength(2);
    (items[1] as HTMLElement).click();
    expect(navigate).toHaveBeenCalledWith({ commands: ['/administration/billing'], queryParams: { 'inv-q': 'R-2' } });
  });

  it('emits silences for the group and single items', () => {
    const silenceSpy = jest.fn();

    fixture.componentInstance.silence.subscribe(silenceSpy);
    (fixture.componentInstance as unknown as { silenceGroup: (choice: unknown) => void }).silenceGroup({
      audience: 'self',
      durationMs: null,
    });
    (fixture.componentInstance as unknown as { silenceItem: (item: unknown, choice: unknown) => void }).silenceItem(
      group().items[0],
      { audience: 'self', durationMs: 86_400_000 },
    );

    expect(silenceSpy.mock.calls.map(([request]) => request)).toEqual([
      { itemType: 'test.invoices.unsent', itemId: null, audience: 'self', durationMs: null },
      { itemType: 'test.invoices.unsent', itemId: 'i1', audience: 'self', durationMs: 86_400_000 },
    ]);
  });

  it('renders setup suggestions as a single highlighted card', () => {
    fixture.componentRef.setInput(
      'group',
      group({ type: 'test.setup.issuer', kind: 'setup', total: 1, openCount: 1, items: [] }),
    );
    fixture.componentRef.setInput('highlight', true);
    fixture.detectChanges();

    expect(host().classList).toContain('ac-stack--highlight');
    expect(host().classList).not.toContain('ac-stack--stacked');
    expect(query('action-center-stack-count')).toBeNull();
    expect(query('action-center-stack-open')?.querySelector('button')?.getAttribute('title')).toBe('Set up');
    expect(query('action-center-stack-open')?.querySelector('.bi-eye')).not.toBeNull();
  });
});

describe('ActionCenterPanelComponent', () => {
  function setup(current: ActionCenterView | null) {
    const facade = createFacade(current);

    TestBed.configureTestingModule({
      imports: [ActionCenterPanelComponent],
      providers: [
        provideRouter([]),
        ActionCenterPresentersService,
        presenters,
        { provide: ActionCenterFacade, useValue: facade },
      ],
    });

    const router = TestBed.inject(Router);

    jest.spyOn(router, 'navigate').mockResolvedValue(true);

    const fixture = TestBed.createComponent(ActionCenterPanelComponent);

    fixture.detectChanges();

    return { fixture, facade, router, host: fixture.nativeElement as HTMLElement };
  }

  it('shows the setup suggestions above the task categories', () => {
    const { host } = setup(view);
    const stacks = [...host.querySelectorAll('shared-action-center-stack')].map((el) => el.getAttribute('data-type'));

    expect(host.querySelector('[data-testid="action-center-setup"]')).not.toBeNull();
    expect(stacks).toEqual(['test.setup.issuer', 'test.invoices.unsent']);
    expect(host.querySelector('[data-testid="action-center-connection"]')).toBeNull();
    expect(host.querySelector('[data-testid="action-center-close"]')).toBeNull();
    expect(host.querySelector('[data-testid="action-center-open-count"]')).toBeNull();
  });

  it('navigates to a chosen to-do with its query params', () => {
    const { fixture, router } = setup(view);

    (fixture.componentInstance as unknown as { navigate: (link: unknown) => void }).navigate({
      commands: ['/administration/billing'],
      queryParams: { 'inv-q': 'R-1' },
    });

    expect(router.navigate).toHaveBeenCalledWith(['/administration/billing'], { queryParams: { 'inv-q': 'R-1' } });
  });

  it('turns stack silence requests into silences with an end date', () => {
    const { fixture, facade } = setup(view);
    const before = Date.now();

    (fixture.componentInstance as unknown as { silence: (request: unknown) => void }).silence({
      itemType: 'test.invoices.unsent',
      itemId: 'i1',
      audience: 'self',
      durationMs: 86_400_000,
    });

    const request = facade.silence.mock.calls[0][0];

    expect(request).toEqual(
      expect.objectContaining({ itemType: 'test.invoices.unsent', itemId: 'i1', audience: 'self' }),
    );
    expect(Date.parse(request.until) - before).toBeGreaterThanOrEqual(86_400_000 - 1_000);
  });

  it('lists silences; everyone silences are not removable for managers', () => {
    const { fixture, host } = setup(view);

    (fixture.componentInstance as unknown as { activeTab: { set: (tab: string) => void } }).activeTab.set('silenced');
    fixture.detectChanges();

    const rows = host.querySelectorAll('[data-testid="action-center-silence"]');

    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain('Invoices not sent yet: R-3');
    expect(rows[0].textContent).toContain('For everyone');
    expect(host.querySelector('[data-testid="action-center-lift-silence"]')).toBeNull();
  });

  it('searches open to-dos and silences alike', () => {
    const { fixture, host } = setup(view);
    const component = fixture.componentInstance as unknown as {
      search: { set: (value: string) => void };
      activeTab: { set: (tab: string) => void };
    };

    component.search.set('R-2');
    fixture.detectChanges();
    expect([...host.querySelectorAll('shared-action-center-stack')].map((el) => el.getAttribute('data-type'))).toEqual([
      'test.invoices.unsent',
    ]);

    component.search.set('nothing like this');
    fixture.detectChanges();
    expect(host.textContent).toContain('No matching to-dos');

    component.activeTab.set('silenced');
    component.search.set('invoices not sent');
    fixture.detectChanges();
    expect(host.querySelectorAll('[data-testid="action-center-silence"]')).toHaveLength(1);

    component.search.set('company details');
    fixture.detectChanges();
    expect(host.querySelectorAll('[data-testid="action-center-silence"]')).toHaveLength(0);
    expect(host.textContent).toContain('No matching to-dos');
  });

  it('filters by area; only the toolbar counter shows the active filter', () => {
    const { fixture, host } = setup(view);
    const component = fixture.componentInstance as unknown as {
      setCategory: (value: string) => void;
      clearFilters: () => void;
    };

    component.setCategory('setup');
    fixture.detectChanges();
    expect([...host.querySelectorAll('shared-action-center-stack')].map((el) => el.getAttribute('data-type'))).toEqual([
      'test.setup.issuer',
    ]);
    expect(host.querySelector('.fpc-list-toolbar__chips')).toBeNull();
    expect(host.querySelector('[data-testid="fpc-list-toolbar-toggle"]')?.textContent).toContain('1');

    component.clearFilters();
    fixture.detectChanges();
    expect(host.querySelectorAll('shared-action-center-stack')).toHaveLength(2);
  });

  it('shows the empty state when everything is done', () => {
    const { host } = setup({ ...view, counts: { open: 0, setup: 0, silenced: 0 }, groups: [], silences: [] });

    expect(host.textContent).toContain('All done');
  });

  it('closes on Escape, but not while a menu inside it is open', () => {
    const { fixture, host, facade } = setup(view);
    const trigger = document.createElement('button');

    trigger.setAttribute('aria-haspopup', 'menu');
    trigger.setAttribute('aria-expanded', 'true');
    host.appendChild(trigger);
    host.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(facade.setPanelOpen).not.toHaveBeenCalled();

    trigger.remove();
    host.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(facade.setPanelOpen).toHaveBeenCalledWith(false);
    void fixture;
  });
});

describe('ActionCenterToggleComponent', () => {
  it('shows the open count and toggles the panel', () => {
    const facade = createFacade(view);

    TestBed.configureTestingModule({
      imports: [ActionCenterToggleComponent],
      providers: [{ provide: ActionCenterFacade, useValue: facade }],
    });

    const fixture = TestBed.createComponent(ActionCenterToggleComponent);

    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('[data-testid="top-bar-action-center-count"]')?.textContent?.trim()).toBe('3');
    expect(host.querySelector('.bi-lightbulb-fill')).not.toBeNull();
    (host.querySelector('button') as HTMLButtonElement).click();
    expect(facade.togglePanel).toHaveBeenCalled();
  });

  it('hides the badge when nothing is open', () => {
    TestBed.configureTestingModule({
      imports: [ActionCenterToggleComponent],
      providers: [{ provide: ActionCenterFacade, useValue: createFacade(null) }],
    });

    const fixture = TestBed.createComponent(ActionCenterToggleComponent);

    fixture.detectChanges();

    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="top-bar-action-center-count"]'),
    ).toBeNull();
  });
});
