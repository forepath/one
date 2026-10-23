import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { ConsoleAccessFacade, ConsolePlansFacade } from '@forepath/loadweaver/frontend/data-access-console';

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

  it('filters by status and project', () => {
    const component = fixture.componentInstance;

    component.status.set('applying');
    expect(component.filtered().map((p) => p.status)).toEqual(['applying']);

    component.status.set('');
    component.project.set('shop');
    expect(component.filtered().map((p) => p.status)).toEqual(['pending']);
  });

  it('asks the server for the filtered plans', () => {
    const component = fixture.componentInstance;

    component.setStatus('failed');
    expect(facade['load']).toHaveBeenLastCalledWith({ limit: 100, status: 'failed' });

    component.setProject('shop');
    expect(facade['load']).toHaveBeenLastCalledWith({ limit: 100, status: 'failed', project: 'shop' });

    component.setStatus('');
    expect(facade['load']).toHaveBeenLastCalledWith({ limit: 100, project: 'shop' });
  });

  it('opens a plan', () => {
    const navigate = jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    fixture.componentInstance.open(testPlan());

    expect(navigate).toHaveBeenCalledWith(['/plans', testPlan().id]);
  });

  it('shows where a plan came from', () => {
    const source = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="plan-source"]');

    expect(source?.textContent).toContain('Git');
    expect(source?.textContent).toContain('abcdef01');
    expect(source?.textContent).toContain('#4');
  });
});
