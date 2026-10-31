import type { TopologyChange, TopologyEdge } from '@forepath/loadweaver/frontend/data-access-console';
import type { FpcGraphEdge, FpcGraphElement } from '@forepath/shared/frontend/ui-components';

import { topologyEdgeKind, topologyStatus } from '../topology/topology-format';
import { bundleEdges, workspaceLayout, workspacePositions, type WorkspaceBox } from './workspace-layout';
import { workspaceAncestors, workspaceItemChange, workspaceStatus, type WorkspaceModel } from './workspace-model';

/** Canvas kinds of Workspace items: map kinds keep their topology style, stacks / VMs get their own. */
const CANVAS_KIND: Record<string, string> = { stack: 'stack', vm: 'vm', replica: 'replica' };

export interface WorkspaceCanvas {
  /** Layout boxes (model coordinates): drop targets of drag-to-place. */
  boxes: ReadonlyMap<string, WorkspaceBox>;
  elements: FpcGraphElement[];
  edges: FpcGraphEdge[];
  positions: Record<string, { x: number; y: number }>;
  highlight: Record<string, TopologyChange> | null;
}

/**
 * The map as canvas inputs (3.36): the visible items with their grouped-layout positions, bundled edges (flows
 * weighted by KiB/s, animated while live), items that don't match the search / filters dimmed, and the overlay of a
 * plan / draft / trace mapped onto items (aggregates) and edges.
 */
export function workspaceCanvas(
  model: WorkspaceModel,
  visible: ReadonlySet<string>,
  options: {
    animated: boolean;
    overlay: Readonly<Record<string, TopologyChange>> | null;
    matching: ReadonlySet<string> | null;
    edges?: readonly TopologyEdge[];
    /**
     * The layout to place items with (3.36 P5: computed over every drawn item, so collapsed compounds sit in the
     * middle of their expanded area and nothing jumps between zoom levels); default: a layout of `visible`.
     */
    boxes?: ReadonlyMap<string, WorkspaceBox>;
  },
): WorkspaceCanvas {
  const boxes = options.boxes ?? workspaceLayout(model, visible);
  const elements: FpcGraphElement[] = [];
  const highlight: Record<string, TopologyChange> = {};
  // Matches and their containers stay lit; everything else is faded.
  const lit = options.matching
    ? new Set([...options.matching].flatMap((id) => [id, ...workspaceAncestors(model, id)]))
    : null;

  for (const item of model.items) {
    if (!visible.has(item.id)) continue;

    const change = workspaceItemChange(item, options.overlay);

    if (change) highlight[item.id] = change;

    const dimmed = !!lit && !lit.has(item.id);

    elements.push({
      id: item.id,
      kind: CANVAS_KIND[item.kind] ?? item.kind,
      label: item.kind === 'stack' && item.elements.length > 1 ? `${item.label} ×${item.elements.length}` : item.label,
      parent: item.parent && visible.has(item.parent) ? item.parent : null,
      classes: dimmed ? ['fpc-dimmed'] : null,
      // Health as a small status dot (3.38: tone only for status, never a fill).
      status: topologyStatus(item.health),
      data: {
        project: item.project,
        health: item.health,
        status: workspaceStatus(item),
        type: item.typeName,
      },
    });
  }

  const edges = bundleEdges(model, visible, options.edges ?? model.edges).map((e) => {
    const flow = e.kind === 'flow';
    const rate = Number(e.data['bytesPerSecond'] ?? 0);
    const change = options.overlay ? e.edges.map((id) => options.overlay?.[id]).find(Boolean) : undefined;

    if (change) highlight[e.id] = change;

    return {
      id: e.id,
      source: e.source,
      target: e.target,
      kind: topologyEdgeKind({ ...(e as unknown as TopologyEdge), kind: e.kind as TopologyEdge['kind'] }),
      ...(e.count > 1 ? { label: `×${e.count}` } : {}),
      ...(flow ? { weight: rate / 1024, animated: options.animated } : {}),
      data: { ...e.data, layer: e.layer, bundled: e.edges },
    };
  });

  return {
    boxes,
    elements,
    edges,
    positions: workspacePositions(model, boxes, visible),
    highlight: Object.keys(highlight).length ? highlight : null,
  };
}
