import { ComponentFixture, TestBed } from '@angular/core/testing';
import type cytoscape from 'cytoscape';

import { FpcGraphCanvasComponent, fpcGraphEdgeId, fpcGraphEdgeWidth } from './graph-canvas.component';
import type { FpcGraphEdge, FpcGraphElement } from './graph-canvas.types';

const ELEMENTS: FpcGraphElement[] = [
  { id: 'site-a', kind: 'site', label: 'Site A' },
  { id: 'node-1', kind: 'node', label: 'node-1', parent: 'site-a' },
  { id: 'node-2', kind: 'node', label: 'node-2', parent: 'site-a' },
  { id: 'web-1', kind: 'replica', label: 'web', parent: 'node-1', data: { status: 'running' } },
  { id: 'db-1', kind: 'replica', label: 'db', parent: 'node-2' },
];

const EDGES: FpcGraphEdge[] = [
  { source: 'web-1', target: 'db-1', kind: 'traffic', weight: 7, animated: true },
  { id: 'deny', source: 'db-1', target: 'web-1', kind: 'denied' },
];

describe('FpcGraphCanvasComponent', () => {
  let fixture: ComponentFixture<FpcGraphCanvasComponent>;
  let component: FpcGraphCanvasComponent;

  function cy(): cytoscape.Core {
    const instance = component.instance;

    if (!instance) {
      throw new Error('cytoscape not initialised');
    }

    return instance;
  }

  function setInputs(inputs: Record<string, unknown>): void {
    for (const [name, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(name, value);
    }

    fixture.detectChanges();
  }

  beforeEach(async () => {
    fixture = TestBed.createComponent(FpcGraphCanvasComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('layout', 'grid');
    fixture.componentRef.setInput('elements', ELEMENTS);
    fixture.componentRef.setInput('edges', EDGES);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  afterEach(() => fixture.destroy());

  it('creates a headless cytoscape instance in jsdom with all elements', () => {
    expect(cy().nodes()).toHaveLength(5);
    expect(cy().edges()).toHaveLength(2);
    expect(cy().getElementById('web-1').parent().first().id()).toBe('node-1');
    expect(cy().getElementById('web-1->db-1:traffic').nonempty()).toBe(true);
    expect(cy().getElementById('site-a').hasClass('fpc-kind-site')).toBe(true);
    expect(cy().getElementById('deny').hasClass('fpc-kind-denied')).toBe(true);
    expect(cy().getElementById('web-1->db-1:traffic').hasClass('fpc-edge--animated')).toBe(true);
    expect(cy().getElementById('web-1->db-1:traffic').data('_width')).toBe(fpcGraphEdgeWidth(7));
  });

  it('updates data incrementally without re-creating elements or re-running the layout', () => {
    const instance = cy();
    const web = instance.getElementById('web-1');
    const layoutSpy = jest.spyOn(instance, 'elements');

    setInputs({
      elements: ELEMENTS.map((element) =>
        element.id === 'web-1' ? { ...element, label: 'web (2)', data: { status: 'degraded' } } : element,
      ),
    });

    expect(component.instance).toBe(instance);
    expect(instance.getElementById('web-1')).toBe(web);
    expect(web.data('label')).toBe('web (2)');
    expect(web.data('status')).toBe('degraded');
    expect(layoutSpy).not.toHaveBeenCalled();
  });

  it('adds, removes and re-parents elements and re-runs the layout on structural change', () => {
    const instance = cy();
    const layoutSpy = jest.spyOn(instance, 'elements');

    setInputs({
      elements: [
        ...ELEMENTS.filter((element) => element.id !== 'node-2' && element.id !== 'db-1'),
        { id: 'vol-1', kind: 'volume', label: 'data', parent: 'node-1' },
        { id: 'db-1', kind: 'replica', label: 'db', parent: 'node-1' },
      ],
      edges: [{ source: 'db-1', target: 'vol-1', kind: 'mount' }],
    });

    expect(instance.getElementById('node-2').empty()).toBe(true);
    expect(instance.getElementById('vol-1').nonempty()).toBe(true);
    expect(instance.getElementById('db-1').parent().first().id()).toBe('node-1');
    expect(instance.edges().map((edge) => edge.id())).toEqual(['db-1->vol-1:mount']);
    expect(layoutSpy).toHaveBeenCalled();
  });

  it('skips edges with unknown endpoints and ignores unknown parents', () => {
    setInputs({
      elements: [{ id: 'orphan', parent: 'missing' }],
      edges: [{ source: 'orphan', target: 'nowhere' }],
    });

    expect(cy().getElementById('orphan').isOrphan()).toBe(true);
    expect(cy().edges()).toHaveLength(0);
  });

  it('applies highlight overlays and hidden layers as classes', () => {
    setInputs({
      highlight: new Map([
        ['node-1', 'update'],
        ['deny', 'delete'],
      ]),
      hiddenKinds: ['volume', 'denied'],
    });

    expect(cy().getElementById('node-1').hasClass('fpc-change-update')).toBe(true);
    expect(cy().getElementById('deny').hasClass('fpc-change-delete')).toBe(true);
    expect(cy().getElementById('deny').hasClass('fpc-hidden')).toBe(true);

    setInputs({ highlight: { 'web-1': 'create' }, hiddenKinds: new Set<string>() });

    expect(cy().getElementById('node-1').hasClass('fpc-change-update')).toBe(false);
    expect(cy().getElementById('web-1').hasClass('fpc-change-create')).toBe(true);
    expect(cy().getElementById('deny').hasClass('fpc-hidden')).toBe(false);
  });

  it('keeps the controlled selection in sync', () => {
    setInputs({ selectedId: 'node-1' });
    expect(
      cy()
        .$(':selected')
        .map((element) => element.id()),
    ).toEqual(['node-1']);

    setInputs({ selectedId: 'deny' });
    expect(
      cy()
        .$(':selected')
        .map((element) => element.id()),
    ).toEqual(['deny']);

    setInputs({ selectedId: null });
    expect(cy().$(':selected')).toHaveLength(0);
  });

  it('emits element, edge and clear events on tap', () => {
    const elementSpy = jest.fn();
    const edgeSpy = jest.fn();
    const clearSpy = jest.fn();

    component.elementSelect.subscribe(elementSpy);
    component.edgeSelect.subscribe(edgeSpy);
    component.selectionClear.subscribe(clearSpy);

    cy().getElementById('web-1').emit('tap');
    cy().getElementById('deny').emit('tap');
    cy().emit('tap');

    expect(elementSpy).toHaveBeenCalledWith({ id: 'web-1', kind: 'replica', data: { status: 'running' } });
    expect(edgeSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'deny', kind: 'denied', source: 'db-1', target: 'web-1' }),
    );
    expect(clearSpy).toHaveBeenCalledTimes(1);
  });

  it('exposes fit / center and destroys cytoscape on destroy', () => {
    const instance = cy();
    const destroySpy = jest.spyOn(instance, 'destroy');

    expect(() => component.fit()).not.toThrow();
    expect(() => component.center('node-1')).not.toThrow();
    expect(() => component.center('unknown')).not.toThrow();

    fixture.destroy();

    expect(destroySpy).toHaveBeenCalled();
    expect(component.instance).toBeNull();
  });
});

describe('graph canvas helpers', () => {
  it('derives edge ids', () => {
    expect(fpcGraphEdgeId({ source: 'a', target: 'b' })).toBe('a->b');
    expect(fpcGraphEdgeId({ source: 'a', target: 'b', kind: 'monitor' })).toBe('a->b:monitor');
    expect(fpcGraphEdgeId({ id: 'x', source: 'a', target: 'b' })).toBe('x');
  });

  it('scales edge widths', () => {
    expect(fpcGraphEdgeWidth(undefined)).toBe(1.5);
    expect(fpcGraphEdgeWidth(0)).toBe(1.5);
    expect(fpcGraphEdgeWidth(1)).toBe(2);
    expect(fpcGraphEdgeWidth(1_000_000)).toBe(8);
  });
});
