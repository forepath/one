import { Component, input, output } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import {
  ConsoleAccessFacade,
  ConsolePlansFacade,
  ConsoleTopologyFacade,
  type TopologyGraph,
} from '@forepath/loadweaver/frontend/data-access-console';
import { FpcGraphCanvasComponent } from '@forepath/shared/frontend/ui-components';

import { accessStub, facadeStub, testPlan } from '../testing';
import { LoadweaverTopologyPageComponent } from './topology-page.component';

/** Cytoscape stays out of the page tests: a stub with the canvas' inputs and outputs. */
// The stub replaces the shared canvas, so it keeps its selector.
// eslint-disable-next-line @angular-eslint/component-selector
@Component({ selector: 'fpc-graph-canvas', template: '', standalone: true })
class GraphCanvasStubComponent {
  readonly elements = input<unknown[]>([]);
  readonly edges = input<unknown[]>([]);
  readonly hiddenKinds = input<unknown>(null);
  readonly highlight = input<unknown>(null);
  readonly selectedId = input<string | null>(null);
  readonly ariaLabel = input('');
  readonly elementSelect = output<unknown>();
  readonly edgeSelect = output<unknown>();
  readonly selectionClear = output<void>();
  readonly fit = jest.fn();
  readonly center = jest.fn();
}

const graph: TopologyGraph = {
  elements: [
    { id: 'site:fra', kind: 'site', label: 'fra', data: { health: 'healthy' } },
    { id: 'node:n1', kind: 'node', label: 'n1', parent: 'site:fra', data: { health: 'healthy' } },
    {
      id: 'replica:shop/web/api/0',
      kind: 'replica',
      label: 'api/0',
      parent: 'node:n1',
      project: 'shop',
      data: { deployment: 'web', service: 'api', state: 'running' },
    },
    {
      id: 'replica:shop/web/api/1',
      kind: 'replica',
      label: 'api/1',
      parent: 'node:n1',
      project: 'shop',
      data: { deployment: 'web', service: 'api', state: 'draining', draining: true },
    },
    { id: 'hostname:shop.example.com', kind: 'hostname', label: 'shop.example.com', data: {} },
  ],
  edges: [
    {
      id: 'flow:x',
      kind: 'flow',
      source: 'external:203.0.113.9',
      target: 'replica:shop/web/api/0',
      layer: 'policies',
      data: { decision: 'denied', policy: 'shop/deny-ssh', bytesPerSecond: 2048, protocol: 'tcp', port: 22 },
    },
    { id: 'tunnel:n1|n2', kind: 'tunnel', source: 'node:n1', target: 'node:n2', layer: 'tunnels', data: {} },
  ],
  at: '2026-10-18T10:00:00.000Z',
  overlay: { 'replica:shop/web/api/0': 'update' },
};

describe('LoadweaverTopologyPageComponent', () => {
  let fixture: ComponentFixture<LoadweaverTopologyPageComponent>;
  let facade: ReturnType<typeof facadeStub>;
  let plans: ReturnType<typeof facadeStub>;

  async function create(clusterRole: boolean, query: Record<string, string> = {}) {
    facade = facadeStub(
      {
        graph$: graph,
        loading$: false,
        error$: null,
        at$: graph.at,
        overlay$: graph.overlay,
        liveConnected$: true,
        liveError$: null,
        traceHost$: null,
        traceSteps$: [],
        traceLoading$: false,
        traceError$: null,
      },
      ['load', 'connectLive', 'disconnectLive', 'trace', 'clearTrace'],
    );
    plans = facadeStub({ plans$: [testPlan(), testPlan({ id: 'applied', status: 'applied' })], loading$: false }, [
      'load',
    ]);

    await TestBed.configureTestingModule({
      imports: [LoadweaverTopologyPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap(query) } },
        },
        { provide: ConsoleTopologyFacade, useValue: facade },
        { provide: ConsolePlansFacade, useValue: plans },
        {
          provide: ConsoleAccessFacade,
          useValue: accessStub(
            clusterRole
              ? { userId: 'u', clusterRole: 'infra-operator', projects: {} }
              : { userId: 'u', clusterRole: null, projects: { shop: 'developer' } },
          ),
        },
      ],
    })
      .overrideComponent(LoadweaverTopologyPageComponent, {
        remove: { imports: [FpcGraphCanvasComponent] },
        add: { imports: [GraphCanvasStubComponent] },
      })
      .compileComponents();

    jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture = TestBed.createComponent(LoadweaverTopologyPageComponent);
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const canvas = () =>
    fixture.debugElement.query((d) => d.componentInstance instanceof GraphCanvasStubComponent)
      .componentInstance as GraphCanvasStubComponent;

  it('starts live with traffic for cluster roles and stops the stream when left', async () => {
    await create(true);

    expect(facade['load']).toHaveBeenCalledWith({ flows: true });
    expect(facade['connectLive']).toHaveBeenCalled();
    expect(canvas().elements()).toHaveLength(5);
    expect(canvas().edges()).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'flow:x', kind: 'denied', animated: true, weight: 2 })]),
    );
    expect(el().querySelector('[data-testid="topology-flow-totals"]')?.textContent).toContain('1 denied');

    fixture.destroy();
    expect(facade['disconnectLive']).toHaveBeenCalled();
  });

  it('gives project members the map without traffic or timeline', async () => {
    await create(false);

    expect(facade['load']).toHaveBeenCalledWith({ flows: false });
    expect(facade['connectLive']).not.toHaveBeenCalled();
    expect(el().querySelector('[data-testid="topology-modes"]')?.textContent).not.toContain('Timeline');
    expect(el().querySelector('#lw-topology-layer-traffic')).toBeNull();
  });

  it('hides switched-off layers through the canvas kinds', async () => {
    await create(true);
    fixture.componentInstance.toggleLayer('tunnels', false);
    fixture.componentInstance.toggleLayer('dns', false);
    fixture.detectChanges();

    expect(canvas().hiddenKinds()).toEqual(['tunnel', 'exposure', 'hostname']);
  });

  it('opens a deep-linked timeline and loads the flows at that time', async () => {
    await create(true, { mode: 'timeline', at: '2026-10-18T08:30:00.000Z' });

    expect(facade['disconnectLive']).toHaveBeenCalled();
    expect(facade['load']).toHaveBeenCalledWith({ flows: true, at: '2026-10-18T08:30:00.000Z' });
    expect(el().querySelector('[data-testid="topology-timeline"]')).not.toBeNull();
  });

  it('overlays a pending plan', async () => {
    await create(true, { plan: testPlan().id });

    expect(plans['load']).toHaveBeenCalledWith({ status: 'pending' });
    expect(facade['load']).toHaveBeenCalledWith({ plan: testPlan().id });
    expect(canvas().highlight()).toEqual({ 'replica:shop/web/api/0': 'update' });
    expect(el().querySelectorAll('[data-testid="topology-plan"] option')).toHaveLength(2);
  });

  it('shows details and links of a selected replica and of a blocked flow', async () => {
    await create(true);
    fixture.componentInstance.onElementSelect({ id: 'replica:shop/web/api/0', kind: 'replica', data: {} });
    fixture.detectChanges();

    const links = () => el().querySelector('[data-testid="topology-links"]') as HTMLElement;

    expect(el().querySelector('[data-testid="topology-details"]')?.textContent).toContain('running');
    expect(links().querySelector('a[href="/health/replica/shop/web/api/0"]')).not.toBeNull();
    expect(links().querySelector('a[href^="/logs?"]')?.getAttribute('href')).toContain('replica=shop%2Fweb%2Fapi%2F0');

    fixture.componentInstance.onEdgeSelect({ id: 'flow:x', kind: 'denied', source: '', target: '', data: {} });
    fixture.detectChanges();

    expect(el().querySelector('[data-testid="topology-details"]')?.textContent).toContain('2.0 KiB/s');
    expect(links().querySelector('a[href^="/policies/deny-ssh"]')).not.toBeNull();
    expect(links().querySelector('a[href^="/logs?"]')?.getAttribute('href')).toContain('policy=shop%2Fdeny-ssh');
  });

  it('marks a draining replica with a status badge (M6 gate)', async () => {
    await create(true);
    fixture.componentInstance.onElementSelect({ id: 'replica:shop/web/api/1', kind: 'replica', data: {} });
    fixture.detectChanges();

    expect(el().querySelector('[data-testid="topology-draining"]')?.textContent?.trim()).toBe('draining');

    fixture.componentInstance.onElementSelect({ id: 'replica:shop/web/api/0', kind: 'replica', data: {} });
    fixture.detectChanges();

    expect(el().querySelector('[data-testid="topology-draining"]')).toBeNull();
  });

  it('traces a hostname and highlights the steps', async () => {
    await create(true);
    fixture.componentInstance.hostInput.set(' Shop.Example.com ');
    fixture.componentInstance.trace();

    expect(facade['trace']).toHaveBeenCalledWith('shop.example.com');

    facade['traceHost$'].next('shop.example.com');
    facade['traceSteps$'].next([
      { kind: 'hostname', id: 'hostname:shop.example.com', label: 'shop.example.com' },
      { kind: 'replica', id: 'replica:shop/web/api/0', label: 'api/0 on n1' },
    ]);
    fixture.detectChanges();

    expect(el().querySelector('[data-testid="topology-trace"]')?.textContent).toContain('api/0 on n1');
    expect(canvas().highlight()).toEqual({
      'hostname:shop.example.com': 'update',
      'replica:shop/web/api/0': 'update',
    });
  });
});
