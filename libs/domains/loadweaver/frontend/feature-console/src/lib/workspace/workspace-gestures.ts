import type { Plan, TopologyEdge } from '@forepath/loadweaver/frontend/data-access-console';
import { parseDocument } from 'yaml';

import type { WorkspaceBox } from './workspace-layout';
import { nearestVisible } from './workspace-layout';
import type { WorkspaceItem, WorkspaceModel } from './workspace-model';

/**
 * Visual gestures of the Workspace (3.36 P4): drag-to-place (edits the placement constraint in the draft, a pin reason
 * for node pins per 3.12), drawing a policy between two ends, and the migration arrows of a plan / preview.
 */

/** Node / site labels every node carries (the scheduler matches placement selectors against them). */
export const NODE_LABEL = 'loadweaver.com/node';
export const SITE_LABEL = 'loadweaver.com/site';

export interface PlacementTarget {
  node?: string;
  site?: string;
}

/** The node (preferred) or site box under a point, ignoring the dragged item and its own subtree. */
export function dropTarget(
  model: WorkspaceModel,
  boxes: ReadonlyMap<string, WorkspaceBox>,
  point: { x: number; y: number },
  dragged: string,
): PlacementTarget | null {
  const inside = (id: string) => {
    const b = boxes.get(id);

    return !!b && point.x >= b.x && point.x <= b.x + b.width && point.y >= b.y && point.y <= b.y + b.height;
  };
  const candidates = model.items.filter((i) => (i.kind === 'node' || i.kind === 'site') && i.id !== dragged);
  const node = candidates.find((i) => i.kind === 'node' && inside(i.id));

  if (node) return { node: node.label };

  const site = candidates.find((i) => i.kind === 'site' && inside(i.id));

  return site ? { site: site.label } : null;
}

/** Whether a gesture can move this item: service stacks / services and VMs (their resource is edited). */
export function movable(item: WorkspaceItem | undefined | null): boolean {
  return !!item && (item.kind === 'stack' || item.kind === 'service' || item.kind === 'vm') && !!item.resource;
}

/** Node pins reduce resilience (3.12): they need a reason; site constraints don't. */
export function needsPinReason(target: PlacementTarget): boolean {
  return !!target.node;
}

function selector(target: PlacementTarget): { matchLabels: Record<string, string> } {
  return { matchLabels: target.node ? { [NODE_LABEL]: target.node } : { [SITE_LABEL]: target.site as string } };
}

/**
 * The resource document with the item's placement set to the target: a deployment's service gets
 * `x-loadweaver.placement.selector` (+ `x-loadweaver.pinned.reason` for node pins) inside its compose file, a VM
 * `spec.placement.selector`. Comments and the rest of the document stay as they are.
 */
export function withPlacement(
  document: string,
  item: WorkspaceItem,
  target: PlacementTarget,
  reason: string | null = null,
): string {
  const doc = parseDocument(document);

  if (item.kind === 'vm') {
    doc.setIn(['spec', 'placement', 'selector'], selector(target));

    return doc.toString({ lineWidth: 0 });
  }

  const service = item.data['service'] as string | undefined;
  const compose = doc.getIn(['spec', 'compose']);

  if (!service || typeof compose !== 'string') return document;

  const composeDoc = parseDocument(compose);

  composeDoc.setIn(['services', service, 'x-loadweaver', 'placement', 'selector'], selector(target));

  if (target.node && reason) composeDoc.setIn(['services', service, 'x-loadweaver', 'pinned', 'reason'], reason);
  else if (!target.node) composeDoc.deleteIn(['services', service, 'x-loadweaver', 'pinned']);

  doc.setIn(['spec', 'compose'], composeDoc.toString({ lineWidth: 0 }));

  return doc.toString({ lineWidth: 0 });
}

/**
 * Migration arrows (3.36 P4): the `move` workload changes of a plan / preview as edges from the moving replica (or its
 * visible ancestor) to the target node; the computed moves of a placement edit show up this way.
 */
export function migrationEdges(
  model: WorkspaceModel,
  visible: ReadonlySet<string>,
  changes: Plan['workloadChanges'] | null | undefined,
): TopologyEdge[] {
  const out = new Map<string, TopologyEdge>();

  for (const c of changes ?? []) {
    if (c.action !== 'move' || !c.replica || !c.to) continue;

    const vm = model.items.find((i) => i.kind === 'vm' && i.elements.includes(`replica:${c.replica}`));
    const source = nearestVisible(model, visible, vm?.id ?? `replica:${c.replica}`);
    const target = nearestVisible(model, visible, `node:${c.to}`);

    if (!source || !target || source === target) continue;

    const id = `migration:${source}->${target}`;
    const edge = out.get(id);

    if (edge) edge.data['replicas'] = (edge.data['replicas'] as string[]).concat(c.replica);
    else
      out.set(id, {
        id,
        kind: 'migration' as TopologyEdge['kind'],
        source,
        target,
        layer: 'policies',
        data: { replicas: [c.replica], from: c.from ?? null, method: c.method ?? null },
      });
  }

  return [...out.values()];
}
