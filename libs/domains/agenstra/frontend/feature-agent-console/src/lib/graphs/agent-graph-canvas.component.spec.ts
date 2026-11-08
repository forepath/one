import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { AgentGraphDocument, AgentGraphNode } from '@forepath/agenstra/shared/util-opencode-config';

import { AgentGraphCanvasComponent } from './agent-graph-canvas.component';

function starDocument(count: number): AgentGraphDocument {
  const nodes: AgentGraphNode[] = [{ id: 'env', type: 'environment', label: 'env' } as AgentGraphNode];
  const edges: AgentGraphDocument['edges'] = [];

  for (let i = 0; i < count; i++) {
    nodes.push({ id: `file:${i}`, type: 'file', label: `file ${i}` } as AgentGraphNode);
    edges.push({ from: 'env', to: `file:${i}`, type: 'contains' } as AgentGraphDocument['edges'][number]);
  }

  return {
    version: 1,
    scope: 'environment',
    layer: 'all',
    generatedAt: '2026-11-08T00:00:00.000Z',
    nodes,
    edges,
    truncated: false,
    totalNodes: nodes.length,
    totalEdges: edges.length,
  };
}

/** Internal state the spec checks (jsdom has no 2D canvas, so drawing itself is covered by the renderer spec). */
interface CanvasInternals {
  scene: { snapshot: { count: number } } | null;
  sceneHidden: boolean;
}

describe('AgentGraphCanvasComponent', () => {
  let fixture: ComponentFixture<AgentGraphCanvasComponent>;
  let component: AgentGraphCanvasComponent;
  const internals = () => component as unknown as CanvasInternals;
  const status = () => (fixture.nativeElement as HTMLElement).querySelector('[role="status"]')?.textContent?.trim();

  async function settle(): Promise<void> {
    for (let i = 0; i < 400 && (component.layoutRunning() || !internals().scene); i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    fixture.detectChanges();
  }

  beforeEach(() => {
    // jsdom has no 2D context (it would log "not implemented"); the component handles a missing one.
    jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    TestBed.configureTestingModule({ imports: [AgentGraphCanvasComponent] });
    fixture = TestBed.createComponent(AgentGraphCanvasComponent);
    component = fixture.componentInstance;
  });

  it('draws nothing while pages are still loading and lays the complete document out once', async () => {
    fixture.componentRef.setInput('loading', true);
    fixture.componentRef.setInput('document', starDocument(5));
    fixture.detectChanges();

    expect(status()).toBe('Loading graph…');

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(internals().scene).toBeNull();
    expect(component.layoutRunning()).toBe(false);

    fixture.componentRef.setInput('document', starDocument(20));
    fixture.componentRef.setInput('loading', false);
    fixture.detectChanges();
    await settle();

    expect(internals().scene?.snapshot.count).toBe(21);
    expect(internals().sceneHidden).toBe(false);
    expect(component.layoutRunning()).toBe(false);
    expect(status()).toBeUndefined();
    expect(component.legend()).toEqual([
      { type: 'file', count: 20 },
      { type: 'environment', count: 1 },
    ]);
  });

  it('hides a laid out graph again when a new view starts loading', async () => {
    fixture.componentRef.setInput('document', starDocument(3));
    fixture.detectChanges();
    await settle();
    expect(internals().sceneHidden).toBe(false);

    fixture.componentRef.setInput('loading', true);
    fixture.detectChanges();

    expect(internals().sceneHidden).toBe(true);
  });

  it('clears the selection with Escape', async () => {
    const selected: (string | null)[] = [];

    component.nodeSelected.subscribe((id) => selected.push(id));
    fixture.componentRef.setInput('document', starDocument(3));
    fixture.detectChanges();
    await settle();

    (fixture.nativeElement as HTMLElement)
      .querySelector('canvas')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(selected).toEqual([null]);
  });
});
