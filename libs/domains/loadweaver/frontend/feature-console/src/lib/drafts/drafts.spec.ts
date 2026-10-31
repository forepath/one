import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { type Draft, DraftsService, type Plan } from '@forepath/loadweaver/frontend/data-access-console';
import { of, throwError } from 'rxjs';

import { DraftTrayService } from '../nav/draft-tray.component';
import { SavedViewsStore } from '../views/saved-views.store';
import { WorkspaceDraftStore } from '../workspace/workspace-draft.store';
import { LoadweaverDraftDetailPageComponent } from './draft-detail-page.component';
import { draftOwnerLabel, draftProjects, draftTitle, filterDrafts, sortDrafts } from './drafts';
import { LoadweaverDraftsPageComponent } from './drafts-page.component';

function draft(overrides: Partial<Draft> = {}): Draft {
  return {
    id: 'd1',
    title: 'Scale web',
    owner: 'alice',
    projects: ['shop'],
    clusterScope: null,
    ops: [
      {
        op: 'upsert',
        kind: 'Deployment',
        name: 'web',
        project: 'shop',
        baseGeneration: 1,
        by: 'alice',
        at: '2026-10-27T10:00:00Z',
      },
    ],
    version: 3,
    status: 'open',
    planId: null,
    createdAt: '2026-10-27T09:00:00Z',
    updatedAt: '2026-10-27T10:00:00Z',
    ...overrides,
  };
}

function storeStub(drafts: Draft[]) {
  const active = signal<Draft | null>(null);

  return {
    drafts: signal(drafts),
    active,
    preview: signal(null),
    conflicts: signal([]),
    busy: signal(false),
    error: signal<string | null>(null),
    loadError: signal<string | null>(null),
    open: jest.fn(async (id: string | null) => active.set(drafts.find((d) => d.id === id) ?? null)),
    create: jest.fn(),
    runPreview: jest.fn(async () => null),
    submit: jest.fn(async () => ({ id: 'p9' }) as Plan),
    discard: jest.fn(async () => true),
    dismissError: jest.fn(),
  };
}

describe('drafts model', () => {
  it('collects touched projects, sorts newest first and filters', () => {
    const a = draft({
      id: 'a',
      projects: [],
      ops: [{ ...draft().ops[0], project: 'web' }],
      updatedAt: '2026-10-27T08:00:00Z',
    });
    const b = draft({ id: 'b', title: 'Other', owner: 'bob' });

    expect(draftProjects(a)).toEqual(['web']);
    expect(sortDrafts([a, b]).map((d) => d.id)).toEqual(['b', 'a']);
    expect(filterDrafts([a, b], 'bob').map((d) => d.id)).toEqual(['b']);
    expect(filterDrafts([a, b], 'deployment web')).toHaveLength(2);
  });

  it('labels owners by email / actor type and gives untitled drafts their creation time (D11, LW-14)', () => {
    expect(draftOwnerLabel(draft({ owner: '6f1c1b0e-0000-4000-8000-000000000001', ownerEmail: 'a@x.test' }))).toBe(
      'a@x.test',
    );
    expect(draftOwnerLabel(draft({ owner: 'api-key', ownerEmail: null }))).toBe('API key');
    expect(filterDrafts([draft({ ownerEmail: 'carol@x.test' })], 'carol')).toHaveLength(1);

    const when = (iso: string) => `at ${iso}`;

    expect(draftTitle(draft({ title: 'Scale web' }), when)).toBe('Scale web');
    expect(draftTitle(draft({ title: 'Untitled draft', createdAt: 'T1' }), when)).toBe('Untitled draft from at T1');
    expect(draftTitle(draft({ title: '  ', createdAt: 'T2' }), when)).toBe('Untitled draft from at T2');
  });
});

describe('LoadweaverDraftsPageComponent', () => {
  it('lists open drafts live and loads submitted ones on demand', async () => {
    const store = storeStub([draft()]);
    const api = { list: jest.fn(() => of([draft({ id: 'd2', title: 'Old', status: 'submitted', planId: 'p1' })])) };

    TestBed.configureTestingModule({
      imports: [LoadweaverDraftsPageComponent],
      providers: [
        provideRouter([]),
        { provide: WorkspaceDraftStore, useValue: store },
        { provide: DraftsService, useValue: api },
        {
          provide: SavedViewsStore,
          useValue: { views: () => signal([]), load: jest.fn(), error: signal(null), available: () => true },
        },
      ],
    });

    const fixture = TestBed.createComponent(LoadweaverDraftsPageComponent);
    const element = fixture.nativeElement as HTMLElement;

    fixture.detectChanges();
    expect(element.querySelector('[data-testid="drafts-list"]')?.textContent).toContain('Scale web');
    expect(element.querySelector('[data-testid="drafts-list"]')?.textContent).toContain('alice');
    expect(api.list).not.toHaveBeenCalled();

    // 3.38 D1: one data table — State column (readable label), name link, status as an applied drawer filter.
    expect(
      element
        .querySelector('[data-testid="drafts-list"] [data-testid="fpc-data-table-state"]')
        ?.getAttribute('aria-label'),
    ).toBe('Open');
    expect(element.querySelector('[data-testid="drafts-list"] a.fpc-data-table__link')?.getAttribute('href')).toBe(
      '/activity/drafts/d1',
    );
    fixture.componentInstance.filterState.patch({ status: 'submitted' });
    fixture.componentInstance.filterState.apply();
    expect(fixture.componentInstance.filterState.activeCount()).toBe(1);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(api.list).toHaveBeenCalledWith('submitted');
    expect(element.querySelector('[data-testid="drafts-list"]')?.textContent).toContain('Old');
  });
});

describe('LoadweaverDraftsPageComponent bulk discard', () => {
  it('discards every selected open draft through the single-draft endpoint and reports per draft', async () => {
    const store = storeStub([draft(), draft({ id: 'd2', title: 'Theirs', version: 5 })]);
    const api = {
      list: jest.fn(),
      discard: jest.fn((id: string) =>
        id === 'd2'
          ? throwError(() => ({ status: 403, error: { message: 'forbidden' } }))
          : of(draft({ status: 'discarded' })),
      ),
    };

    TestBed.configureTestingModule({
      imports: [LoadweaverDraftsPageComponent],
      providers: [
        provideRouter([]),
        { provide: WorkspaceDraftStore, useValue: store },
        { provide: DraftsService, useValue: api },
        {
          provide: SavedViewsStore,
          useValue: { views: () => signal([]), load: jest.fn(), error: signal(null), available: () => true },
        },
      ],
    });

    const fixture = TestBed.createComponent(LoadweaverDraftsPageComponent);
    const page = fixture.componentInstance;

    fixture.detectChanges();
    page.selected.set(['d1', 'd2']);
    await page.discardSelected();
    expect(api.discard).toHaveBeenCalledWith('d1', 3);
    expect(api.discard).toHaveBeenCalledWith('d2', 5);
    expect(store.drafts().map((d) => d.id)).toEqual(['d2']);
    expect(page.bulkResult()?.tone).toBe('warning');
    expect(page.selected()).toEqual([]);
  });
});

describe('LoadweaverDraftsPageComponent errors', () => {
  it('shows an alert instead of a blank list when the drafts could not be loaded', async () => {
    const store = storeStub([]);
    const api = { list: jest.fn(() => throwError(() => new Error('relay refused'))) };

    store.loadError.set('Not available through the fleet');
    TestBed.configureTestingModule({
      imports: [LoadweaverDraftsPageComponent],
      providers: [
        provideRouter([]),
        { provide: WorkspaceDraftStore, useValue: store },
        { provide: DraftsService, useValue: api },
        {
          provide: SavedViewsStore,
          useValue: { views: () => signal([]), load: jest.fn(), error: signal(null), available: () => true },
        },
      ],
    });

    const fixture = TestBed.createComponent(LoadweaverDraftsPageComponent);
    const element = fixture.nativeElement as HTMLElement;

    fixture.detectChanges();
    expect(element.querySelector('[data-testid="drafts-error"]')?.textContent).toContain(
      'Not available through the fleet',
    );
    expect(element.querySelector('[data-testid="drafts-empty"]')).toBeNull();

    fixture.componentInstance.status.set('discarded');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(element.querySelector('[data-testid="drafts-error"]')?.textContent).toContain('relay refused');
  });
});

describe('LoadweaverDraftDetailPageComponent', () => {
  it('opens the draft in the tray, submits it as a plan and discards it after a confirm', async () => {
    const store = storeStub([draft()]);
    const tray = { open: signal(false) };

    TestBed.configureTestingModule({
      imports: [LoadweaverDraftDetailPageComponent],
      providers: [
        provideRouter([]),
        { provide: WorkspaceDraftStore, useValue: store },
        { provide: DraftsService, useValue: { get: jest.fn() } },
        { provide: DraftTrayService, useValue: tray },
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ id: 'd1' })) } },
      ],
    });

    const router = TestBed.inject(Router);
    const navigate = jest.spyOn(router, 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(LoadweaverDraftDetailPageComponent);
    const page = fixture.componentInstance;

    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="draft-ops"]')?.textContent).toContain(
      'Deployment shop/web',
    );
    // 3.38: one lane (facts + "Changes" list header + the changes table), back in the breadcrumbs slot.
    expect(
      (fixture.nativeElement as HTMLElement)
        .querySelector('[data-testid="draft-ops"] a.fpc-data-table__link')
        ?.getAttribute('href'),
    ).toBe('/resources/deployment/shop/web');
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="draft-lane"] fpc-list-header'),
    ).not.toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelector('ul.list-group')).toBeNull();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="draft-back"].fpc-md__back'),
    ).not.toBeNull();

    // Destructive discard and Copy ID in More, the primary (submit) last; no red inline button (LW-06).
    const header = (fixture.nativeElement as HTMLElement).querySelector('fpc-page-header') as HTMLElement;
    const ids = [...header.querySelectorAll('[data-testid^="draft-"]')].map((e) => e.getAttribute('data-testid'));

    expect(ids.filter((id) => id !== 'draft-status' && id !== 'draft-back').at(-1)).toBe('draft-submit');
    expect(header.querySelector('.btn-danger')).toBeNull();
    expect(header.querySelector('[data-testid="draft-more"]')).not.toBeNull();

    await page.openInTray();
    expect(store.open).toHaveBeenCalledWith('d1');
    expect(tray.open()).toBe(true);

    await page.submit();
    expect(store.submit).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(['/activity/plans', 'p9']);

    page.discardOpen.set(true);
    await page.discard();
    expect(page.discardOpen()).toBe(false);
    expect(store.discard).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(['/activity/drafts']);
  });
});
