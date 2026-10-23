import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import {
  ConsoleAccessFacade,
  ConsoleAuditFacade,
  ConsoleAuditService,
  type AccessMe,
  type AuditEntry,
} from '@forepath/loadweaver/frontend/data-access-console';
import { of, throwError } from 'rxjs';

import { accessStub, facadeStub } from '../testing';
import { LoadweaverAuditPageComponent } from './audit-page.component';

function entry(seq: string, overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    seq,
    at: '2026-10-18T09:12:03.000Z',
    actorType: 'user',
    actorId: 'u1',
    action: 'terminal.open',
    target: 'replica/shop/web/api/0',
    project: 'shop',
    details: { node: 'n1', recorded: true, session: '2a4c1d0e-5b7f-4e2a-9c3d-8f1e6a0b2c4d' },
    hash: 'ab'.repeat(32),
    ...overrides,
  };
}

describe('LoadweaverAuditPageComponent', () => {
  let fixture: ComponentFixture<LoadweaverAuditPageComponent>;
  let facade: ReturnType<typeof facadeStub>;
  let navigate: jest.SpyInstance;
  const service = { export: jest.fn() };

  async function create(query: Record<string, string> = {}, me: AccessMe | null = null) {
    facade = facadeStub(
      {
        entries$: [entry('120'), entry('119', { action: 'files.write', target: 'replica/shop/web/api/0' })],
        page$: 0,
        hasNext$: true,
        hasPrevious$: false,
        loading$: false,
        error$: null,
        verification$: null,
        verifiedAt$: null,
        verifying$: false,
        verifyError$: null,
      },
      ['search', 'next', 'previous', 'verify'],
    );
    service.export.mockReset();

    // `accessStub` has no `clusterRole$`.
    const access = Object.assign(accessStub(me ?? { userId: 'u', clusterRole: null, projects: { shop: 'admin' } }), {
      clusterRole$: of(me?.clusterRole ?? null),
    });

    await TestBed.configureTestingModule({
      imports: [LoadweaverAuditPageComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(query) } } },
        { provide: ConsoleAuditFacade, useValue: facade },
        { provide: ConsoleAuditService, useValue: service },
        { provide: ConsoleAccessFacade, useValue: access },
      ],
    }).compileComponents();

    navigate = jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture = TestBed.createComponent(LoadweaverAuditPageComponent);
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const component = () => fixture.componentInstance;

  it('searches with the filter from the URL and writes it back', async () => {
    await create({ project: 'shop', action: 'terminal.*', from: '2026-10-18T08:00:00.000Z' });

    expect(facade['search']).toHaveBeenCalledWith(
      { project: 'shop', action: 'terminal.*', from: new Date('2026-10-18T08:00:00.000Z').toISOString() },
      50,
    );
    expect(navigate.mock.calls[0][1].queryParams).toMatchObject({ project: 'shop', action: 'terminal.*', actor: null });
    expect(el().querySelector('[data-testid="audit-table"]')?.textContent).toContain('files.write');
    // The panel counts the filled filters and holds the project filter.
    expect(el().querySelector('.fpc-collapsible-filter-panel .badge')?.textContent?.trim()).toBe('3');
    (el().querySelector('.fpc-collapsible-filter-panel__toggle') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect((el().querySelector('#lw-audit-project') as HTMLSelectElement | null)?.tagName).toBe('SELECT');
    // Project admins don't verify the chain.
    expect(el().querySelector('[data-testid="audit-verify"]')).toBeNull();
  });

  it('pages, shows entry details and narrows the search', async () => {
    await create();
    (el().querySelector('[data-testid="audit-paging"] .fpc-pager__next') as HTMLButtonElement).click();
    expect(facade['next']).toHaveBeenCalled();

    (el().querySelector('[data-testid="audit-table"] tbody tr') as HTMLElement).click();
    fixture.detectChanges();

    const details = el().querySelector('[data-testid="audit-entry-details"]');

    expect(details?.textContent).toContain('"recorded": true');
    expect(details?.textContent).toContain('ab'.repeat(32));
    expect(details?.querySelector('a[href^="/live"]')).not.toBeNull();

    component().narrow('actor', 'u1');
    expect(facade['search']).toHaveBeenLastCalledWith({ actor: 'u1' }, 50);
  });

  it('verifies the chain for auditors and shows the result', async () => {
    await create({}, { userId: 'a', clusterRole: 'auditor', projects: {} });

    expect(el().querySelector('[data-testid="audit-verify"]')).not.toBeNull();
    component().verify();
    expect(facade['verify']).toHaveBeenCalled();

    facade['verification$'].next({
      ok: false,
      checked: 120,
      brokenAt: '87',
      anchors: { checked: 3, mismatched: ['87'], available: true },
    });
    fixture.detectChanges();

    const result = el().querySelector('[data-testid="audit-verification"]');

    expect(result?.querySelector('.alert')?.classList).toContain('alert-danger');
    expect(result?.textContent).toContain('#87');
  });

  it('exports the applied filter', async () => {
    await create({ project: 'shop' });
    service.export.mockReturnValueOnce(of('seq,at\n')).mockReturnValueOnce(throwError(() => new Error('too large')));
    Object.assign(window.URL, { createObjectURL: jest.fn(() => 'blob:x'), revokeObjectURL: jest.fn() });
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    component().export('csv');
    expect(service.export).toHaveBeenCalledWith({ project: 'shop' }, 'csv');

    component().export('ndjson');
    expect(component().exportError()).toBe('too large');
  });
});
