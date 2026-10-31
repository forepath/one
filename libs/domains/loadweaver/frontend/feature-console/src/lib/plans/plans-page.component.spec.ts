import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import {
  ConsoleAccessFacade,
  ConsolePlansFacade,
  PlansService,
} from '@forepath/loadweaver/frontend/data-access-console';
import { of, throwError } from 'rxjs';

import { accessStub, facadeStub, testPlan } from '../testing';
import { LoadweaverPlansPageComponent } from './plans-page.component';

describe('LoadweaverPlansPageComponent', () => {
  let fixture: ComponentFixture<LoadweaverPlansPageComponent>;
  let facade: ReturnType<typeof facadeStub>;

  beforeEach(async () => {
    facade = facadeStub(
      {
        plans$: [
          testPlan({
            source: { kind: 'git', connection: 'c', commit: 'abcdef0123456789', ref: 'refs/heads/main', pr: 4 },
          }),
          testPlan({
            id: '4f2a1b4c-0000-4000-8000-000000000002',
            status: 'applying',
            changes: [
              {
                action: 'create',
                kind: 'Site',
                name: 'fra1',
                project: null,
                baseGeneration: 0,
                before: null,
                after: {},
              },
            ],
            progress: {
              phase: 'apply',
              baseRevision: 1,
              targets: null,
              step: 'Applying: waiting for n1',
              percent: 40,
              startedAt: '2026-10-01T10:00:00.000Z',
              nodes: {},
            },
          }),
        ],
        loading$: false,
        error$: null,
        live$: true,
        projects$: ['shop'],
      },
      ['load', 'connectLive', 'disconnectLive'],
    );

    await TestBed.configureTestingModule({
      imports: [LoadweaverPlansPageComponent],
      providers: [
        provideRouter([]),
        { provide: PlansService, useValue: { discard: jest.fn() } },
        { provide: ConsolePlansFacade, useValue: facade },
        { provide: ConsoleAccessFacade, useValue: accessStub() },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LoadweaverPlansPageComponent);
    fixture.detectChanges();
  });

  it('loads the plans and follows them live while shown', () => {
    expect(facade['load']).toHaveBeenCalledWith({ limit: 100 });
    expect(facade['connectLive']).toHaveBeenCalled();

    fixture.destroy();

    expect(facade['disconnectLive']).toHaveBeenCalled();
  });

  it('lists plans with status, summary and progress', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('Deployment shop/web');
    expect(text).toContain('Site fra1');
    expect(text).toContain('40 %');
    expect(text).toContain('Live');
  });

  it('shows a title bar with the count and searches the plans', () => {
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('fpc-list-header')).toBeNull();

    fixture.componentInstance.search.set('fra1');
    fixture.detectChanges();
    expect(fixture.componentInstance.visible().map((p) => p.id)).toEqual(['4f2a1b4c-0000-4000-8000-000000000002']);
    expect(el.querySelector('fpc-list-header')).toBeNull();

    fixture.componentInstance.search.set('no-such-plan');
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="fpc-data-table-no-matches"]')).not.toBeNull();
  });

  it('renders the plans as a data table: state icon, link, ⋮ with Copy ID, no raw id', () => {
    const el = fixture.nativeElement as HTMLElement;
    const state = el.querySelector('[data-testid="fpc-data-table-state"]');

    expect(state?.getAttribute('aria-label')).toBe('Pending');
    expect(el.querySelector('a.fpc-data-table__link')?.getAttribute('href')).toContain('/activity/plans/');
    expect(el.textContent).not.toContain(testPlan().id.slice(0, 8));
    expect(fixture.componentInstance.rowMenu(testPlan()).map((item) => item.id)).toEqual([
      'open',
      'discard',
      'copy-id',
    ]);
  });

  it('discards the selected pending plans one by one and reports each result', async () => {
    const service = TestBed.inject(PlansService);
    const discard = (service.discard as jest.Mock)
      .mockImplementationOnce(() => of(testPlan()))
      .mockImplementationOnce(() => throwError(() => ({ status: 403, error: { message: 'Not yours' } })));
    const component = fixture.componentInstance;

    component.selected.set([testPlan().id]);
    expect(component.canDiscardSelection()).toBe(true);
    component.selected.set([testPlan().id, '4f2a1b4c-0000-4000-8000-000000000002']);
    expect(component.canDiscardSelection()).toBe(false); // one is applying

    component.selected.set([testPlan().id]);
    await component.discardSelected();
    expect(discard).toHaveBeenCalledTimes(1);
    expect(component.bulkResult()?.tone).toBe('success');
  });

  it('filters by status and project', () => {
    const component = fixture.componentInstance;

    component.status.set('applying');
    expect(component.filtered().map((p) => p.status)).toEqual(['applying']);

    component.status.set('');
    component.project.set('shop');
    expect(component.filtered().map((p) => p.status)).toEqual(['pending']);
  });

  it('asks the server for the filtered plans as soon as a filter changes (live filters, 2026-10-29)', () => {
    const component = fixture.componentInstance;
    const filters = component.filterState;

    filters.patch({ status: 'failed' });
    expect(component.status()).toBe('failed');
    expect(facade['load']).toHaveBeenLastCalledWith({ limit: 100, status: 'failed' });
    expect(filters.activeCount()).toBe(1);

    filters.patch({ project: 'shop' });
    expect(facade['load']).toHaveBeenLastCalledWith({ limit: 100, status: 'failed', project: 'shop' });

    filters.clear();
    expect(facade['load']).toHaveBeenLastCalledWith({ limit: 100 });
    expect(filters.activeCount()).toBe(0);
  });

  it('opens a plan', () => {
    const navigate = jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    fixture.componentInstance.open(testPlan());

    expect(navigate).toHaveBeenCalledWith(['/activity/plans', testPlan().id]);
  });

  it('shows where a plan came from', () => {
    const source = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="plan-source"]');

    expect(source?.textContent).toContain('Git');
    expect(source?.textContent).toContain('abcdef01');
    expect(source?.textContent).toContain('#4');
  });
});
