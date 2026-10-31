import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AutoscalingService, type AutoscaledService } from '@forepath/loadweaver/frontend/data-access-console';
import { of, throwError } from 'rxjs';

import {
  autoscaledOf,
  autoscaleScopeOfHealthKey,
  autoscaleTarget,
  autoscaleTone,
  autoscaleValue,
} from './autoscaling-format';
import { LoadweaverAutoscalingPanelComponent } from './autoscaling-panel.component';

const api: AutoscaledService = {
  id: 'shop/web/api',
  project: 'shop',
  deployment: 'web',
  service: 'api',
  min: 2,
  max: 8,
  metric: 'cpu',
  customMetric: null,
  target: 50,
  replicas: 6,
  desiredReplicas: 6,
  status: {
    metric: 'cpu',
    target: 50,
    min: 2,
    max: 8,
    value: 100,
    desired: 8,
    action: 'hold',
    reason: 'cpu 100 % / target 50 %',
    blocked: 'project shop quota: CPU 1.75 would exceed 1.5',
    atMax: false,
    evaluatedAt: '2026-10-19T10:00:00.000Z',
  },
  lastScaleAt: '2026-10-19T09:59:45.000Z',
  lastReason: '4 → 6: cpu 100 % / target 50 % (limited: project shop quota: CPU 1.75 would exceed 1.5)',
  lastValue: 100,
};
const front: AutoscaledService = {
  ...api,
  id: 'shop/site/front',
  deployment: 'site',
  service: 'front',
  metric: 'requests',
  target: 20,
  status: null,
  lastScaleAt: null,
  lastReason: null,
};

describe('autoscaling format', () => {
  it('formats targets and values in their units', () => {
    expect(autoscaleTarget(api)).toBe('50 % of the request');
    expect(autoscaleTarget(front)).toBe('20/s per replica');
    expect(autoscaleTarget({ metric: 'custom', target: 300 })).toBe('300');
    expect(autoscaleValue(api)).toBe('100 %');
    expect(autoscaleValue(front)).toBe('–');
    expect(
      autoscaleValue({ ...front, status: { ...(api.status as NonNullable<typeof api.status>), value: 12.345 } }),
    ).toBe('12.3/s');
  });

  it('tones blocked, scaling, steady and unevaluated services', () => {
    expect(autoscaleTone(api)).toBe('warning');
    expect(autoscaleTone(front)).toBe('secondary');
    expect(autoscaleTone({ status: { ...(api.status as NonNullable<typeof api.status>), blocked: null } })).toBe(
      'success',
    );
    expect(
      autoscaleTone({ status: { ...(api.status as NonNullable<typeof api.status>), blocked: null, action: 'up' } }),
    ).toBe('info');
  });

  it('filters by deployment / service and maps health keys', () => {
    expect(autoscaledOf([front, api], 'web').map((s) => s.id)).toEqual(['shop/web/api']);
    expect(autoscaledOf([front, api], null).map((s) => s.id)).toEqual(['shop/site/front', 'shop/web/api']);
    expect(autoscaledOf([front, api], 'web', 'worker')).toEqual([]);
    expect(autoscaleScopeOfHealthKey('service/shop/web/api')).toEqual({
      project: 'shop',
      deployment: 'web',
      service: 'api',
    });
    expect(autoscaleScopeOfHealthKey('deployment/shop/web')).toEqual({
      project: 'shop',
      deployment: 'web',
      service: null,
    });
    expect(autoscaleScopeOfHealthKey('node/n1')).toBeNull();
    expect(autoscaleScopeOfHealthKey(null)).toBeNull();
  });
});

describe('LoadweaverAutoscalingPanelComponent', () => {
  let fixture: ComponentFixture<LoadweaverAutoscalingPanelComponent>;
  let list: jest.Mock;

  const create = async (deployment: string) => {
    await TestBed.configureTestingModule({
      imports: [LoadweaverAutoscalingPanelComponent],
      providers: [{ provide: AutoscalingService, useValue: { list } }],
    }).compileComponents();

    fixture = TestBed.createComponent(LoadweaverAutoscalingPanelComponent);
    fixture.componentRef.setInput('project', 'shop');
    fixture.componentRef.setInput('deployment', deployment);
    fixture.detectChanges();
  };
  const el = () => fixture.nativeElement as HTMLElement;

  it('shows replicas, metric vs. target, the last scaling and the blocked reason', async () => {
    list = jest.fn(() => of([api, front]));
    await create('web');

    expect(list).toHaveBeenCalledWith('shop');

    const text = el().querySelector('[data-testid="autoscaling-panel"]')?.textContent ?? '';

    expect(el().querySelector('[data-testid="autoscaling-api"]')).not.toBeNull();

    expect(text).toContain('6 replicas (2..8)');
    expect(text).toContain('cpu 100 %');
    expect(text).toContain('target 50 % of the request');
    expect(text).toContain('4 → 6: cpu 100 % / target 50 %');
    expect(el().querySelector('[data-testid="autoscaling-blocked"]')?.textContent).toContain(
      'Scale-up blocked: project shop quota: CPU 1.75 would exceed 1.5',
    );
    expect(el().querySelector('[data-testid="autoscaling-front"]')).toBeNull();
  });

  it('renders nothing for deployments without autoscaled services, and errors as alerts', async () => {
    list = jest.fn(() => of([api]));
    await create('other');
    expect(el().querySelector('[data-testid="autoscaling-panel"]')).toBeNull();

    fixture.componentInstance.all.set([]);
    list.mockReturnValue(throwError(() => new Error('boom')));
    fixture.componentInstance.load('shop');
    fixture.detectChanges();
    expect(fixture.componentInstance.error()).toBeTruthy();
  });

  it('renders the Autoscaling lane of an object tab with an empty state (3.38)', async () => {
    list = jest.fn(() => of([api]));
    await TestBed.configureTestingModule({
      imports: [LoadweaverAutoscalingPanelComponent],
      providers: [{ provide: AutoscalingService, useValue: { list } }],
    }).compileComponents();
    fixture = TestBed.createComponent(LoadweaverAutoscalingPanelComponent);
    fixture.componentRef.setInput('project', 'shop');
    fixture.componentRef.setInput('deployment', 'other');
    fixture.componentRef.setInput('lane', true);
    fixture.detectChanges();

    expect(el().querySelector('loadweaver-lane')?.textContent).toContain('Autoscaling');
    expect(el().querySelector('[data-testid="autoscaling-empty"]')).not.toBeNull();

    fixture.componentRef.setInput('deployment', 'web');
    fixture.detectChanges();
    expect(el().querySelector('[data-testid="autoscaling-panel"] fpc-data-table')).not.toBeNull();
    expect(el().querySelector('dl.row')).toBeNull();
  });
});
