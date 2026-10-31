import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import {
  ConsoleAccessFacade,
  ConsoleUpdatesFacade,
  rolloutWaves,
  type Rollout,
} from '@forepath/loadweaver/frontend/data-access-console';
import { BehaviorSubject } from 'rxjs';

import { accessStub, facadeStub, testRollout } from '../testing';
import { LoadweaverUpdateDetailPageComponent } from './update-detail-page.component';

const running = testRollout({
  status: 'running',
  diff: [
    { node: 'n1', component: 'node-agent', from: '1.1.0', to: '1.2.0', method: 'binary swap' },
    { node: 'n2', component: 'envoy', from: '1.30.0', to: '1.31.0', method: 'hot restart' },
  ],
  notes: ['Envoy restarts with connection draining'],
  warnings: ['n3 is cordoned and is skipped'],
  failureAnalysis: [{ wave: 2, nodes: ['n2'], risk: ['shop/db runs without a replica'] }],
  steps: [
    {
      index: 0,
      wave: 0,
      phase: 'control-plane',
      node: 'n1',
      site: 'fra1',
      kind: 'components',
      state: 'done',
      from: '1.1.0',
      to: '1.2.0',
      error: null,
      gates: [{ name: 'health', ok: true, message: 'healthy' }],
      startedAt: '2026-10-02T10:00:00.000Z',
      finishedAt: '2026-10-02T10:05:00.000Z',
    },
    {
      index: 1,
      wave: 2,
      phase: 'wave',
      node: 'n2',
      site: 'ams1',
      kind: 'host',
      state: 'verifying',
      from: '1.1.0',
      to: '1.2.0',
      error: 'error rate above the baseline',
      gates: [{ name: 'error-rate', ok: false, message: '5xx 4 %' }],
      startedAt: '2026-10-02T10:06:00.000Z',
      finishedAt: null,
    },
  ],
});

describe('LoadweaverUpdateDetailPageComponent', () => {
  let fixture: ComponentFixture<LoadweaverUpdateDetailPageComponent>;
  let facade: ReturnType<typeof facadeStub>;

  async function setup(rollout: Rollout, clusterRole: 'cluster-admin' | 'auditor' = 'cluster-admin') {
    facade = facadeStub(
      {
        selected$: rollout,
        selectedWaves$: rolloutWaves(rollout),
        selectedLoading$: false,
        selectedError$: null,
        acting$: null,
        actionError$: null,
      },
      ['open', 'act', 'clearActionError'],
    );

    await TestBed.configureTestingModule({
      imports: [LoadweaverUpdateDetailPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: new BehaviorSubject(convertToParamMap({ id: rollout.id })),
            snapshot: { paramMap: convertToParamMap({ id: rollout.id }) },
          },
        },
        { provide: ConsoleUpdatesFacade, useValue: facade },
        { provide: ConsoleAccessFacade, useValue: accessStub({ userId: 'u', clusterRole, projects: {} }) },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LoadweaverUpdateDetailPageComponent);
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const click = (testId: string) => {
    (el().querySelector(`[data-testid="${testId}"] button`) as HTMLButtonElement).click();
    fixture.detectChanges();
  };

  it('shows the diff, notes, warnings, failure analysis and steps per wave', async () => {
    await setup(running);

    expect(facade['open']).toHaveBeenCalledWith('r1');
    expect(el().textContent).toContain('n3 is cordoned and is skipped');
    expect(el().querySelector('[data-testid="update-notes"]')?.textContent).toContain('connection draining');

    const diff = el().querySelector('[data-testid="update-diff"]')?.textContent ?? '';

    expect(diff).toContain('node-agent');
    expect(diff).toContain('hot restart');
    fixture.componentInstance.selectDiff('component');
    fixture.detectChanges();
    expect(fixture.componentInstance.diffGroups().map((g) => g.key)).toEqual(['envoy', 'node-agent']);

    // Wave steps: one table grouped by wave (decision 2), the wave's risks above it.
    const steps = el().querySelector('[data-testid="update-steps"]')?.textContent ?? '';

    expect(el().querySelector('[data-testid="update-wave-risk-2"]')?.textContent).toContain(
      'shop/db runs without a replica',
    );
    expect(steps).toContain('error-rate');
    expect(steps).toContain('5xx 4 %');
    expect(steps).toContain('error rate above the baseline');
    expect(
      el().querySelector('[data-testid="update-steps"] [data-testid="fpc-data-table-group"]')?.textContent,
    ).toContain('Control plane');
  });

  it('offers pause and roll back while running, with a confirmation', async () => {
    await setup(running);

    expect(el().querySelector('[data-testid="update-action-approve"]')).toBeNull();
    click('update-action-rollback');
    expect(fixture.componentInstance.confirm()?.danger).toBe(true);
    fixture.componentInstance.confirmed();
    expect(facade['act']).toHaveBeenCalledWith('r1', 'rollback');
  });

  it('approves only after the dialog, as an emergency when checked', async () => {
    await setup(testRollout());

    click('update-action-approve');
    expect(fixture.componentInstance.approveOpen()).toBe(true);
    expect(facade['act']).not.toHaveBeenCalled();
    fixture.componentInstance.emergency.set(true);
    fixture.componentInstance.approve();
    expect(facade['act']).toHaveBeenCalledWith('r1', 'approve', true);

    click('update-action-approve');
    expect(fixture.componentInstance.emergency()).toBe(false);
    fixture.componentInstance.approve();
    expect(facade['act']).toHaveBeenLastCalledWith('r1', 'approve', false);
  });

  it('has no actions for read-only roles', async () => {
    await setup(testRollout(), 'auditor');

    expect(fixture.componentInstance.actions()).toEqual([]);
    expect(el().textContent).toContain('waits for a cluster admin');
  });

  it('polls while the rollout is active', async () => {
    jest.useFakeTimers();

    try {
      await setup(running);
      (facade['open'] as jest.Mock).mockClear();
      jest.advanceTimersByTime(5_000);
      expect(facade['open']).toHaveBeenCalledWith('r1', true);

      (facade['selected$'] as BehaviorSubject<Rollout>).next(testRollout({ status: 'completed' }));
      (facade['open'] as jest.Mock).mockClear();
      jest.advanceTimersByTime(5_000);
      expect(facade['open']).not.toHaveBeenCalled();
    } finally {
      fixture.destroy();
      jest.useRealTimers();
    }
  });
});
