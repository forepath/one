import type cytoscape from 'cytoscape';

import type { FpcBrandPalette } from '../brand-tokens/brand-tokens';

/** Converts a kind string into a safe Cytoscape class suffix. */
export function fpcGraphKindClass(kind: string): string {
  return `fpc-kind-${kind.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

type StyleBlock = { selector: string; style: Record<string, unknown> };

/** Options of the stylesheet that don't come from the brand palette. */
export interface FpcGraphStyleOptions {
  /** Compact density (`body.fpc-density-compact`): tighter container padding. */
  compact?: boolean;
}

/** Status tones drawn as dots (`fpc-status-*` classes, see `FpcGraphElement.status`). */
export const FPC_GRAPH_STATUS_TONES = ['success', 'warning', 'danger', 'secondary'] as const;

/** Type scale of the canvas (px; the app font): labels of leaves, of containers, of edges. */
export const FPC_GRAPH_FONT = { label: 11, container: 11, edge: 10 } as const;

/** Stroke scale (px): hairline structure, emphasized structure, plan / trace marks, selection. */
export const FPC_GRAPH_STROKE = { hairline: 1, strong: 1.5, mark: 2, hover: 2, selected: 3 } as const;

/**
 * A small status dot as an SVG data URI (filled with the tone, ringed with the canvas background so it reads on
 * any fill). Used as the element's background image at its top-right corner.
 */
export function fpcGraphStatusDot(color: string, ring: string): string {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'>` +
    `<circle cx='6' cy='6' r='4.5' fill='${color}' stroke='${ring}' stroke-width='1.5'/></svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/**
 * Cytoscape stylesheet built from the active brand palette (light / dark from the `--bs-*` variables).
 *
 * Calm by design (3.38): neutral greys for structure (hairline borders in the Bootstrap border colour, flattened
 * onto the body background by `fpcReadBrandPalette`; tinted container fills like panels), the brand primary only for
 * hover / selection (a border colour, never a shadow / halo), tone colours only for status (small dots via `fpc-status-*`) and for
 * plan marks (create / update / delete) and denied flows. One type scale, one stroke scale, muted edges with one
 * arrowhead. Hierarchy: sites (outer containers) > nodes / groups (inner containers) > workloads (leaves).
 */
export function fpcGraphStylesheet(
  palette: FpcBrandPalette,
  options: FpcGraphStyleOptions = {},
): cytoscape.StylesheetJson {
  const muted = palette.secondaryColor;
  const structure = palette.borderColor;
  const pad = options.compact ? 10 : 14;
  const font = palette.fontFamily;
  const tone: Record<(typeof FPC_GRAPH_STATUS_TONES)[number], string> = {
    success: palette.success,
    warning: palette.warning,
    danger: palette.danger,
    secondary: palette.secondary,
  };
  const blocks: StyleBlock[] = [
    {
      selector: 'node',
      style: {
        label: 'data(label)',
        // At rest everything is quiet: muted labels, light tinted fills, hairlines in the border colour. Contrast and
        // the brand accent come only with hover / focus / selection / trace (below).
        color: muted,
        'font-family': font,
        'font-size': FPC_GRAPH_FONT.label,
        'text-valign': 'bottom',
        'text-halign': 'center',
        'text-margin-y': 4,
        'text-wrap': 'ellipsis',
        'text-max-width': '112px',
        'min-zoomed-font-size': 6,
        'background-color': palette.tertiaryBg,
        'border-color': structure,
        'border-width': FPC_GRAPH_STROKE.hairline,
        shape: 'round-rectangle',
        width: 32,
        height: 24,
        'underlay-padding': 4,
        'underlay-opacity': 0,
        'underlay-shape': 'round-rectangle',
        // No tap / press overlay either: interaction shows as a primary border only.
        'overlay-opacity': 0,
        'transition-property': 'border-color, background-color',
        'transition-duration': 150,
      },
    },
    {
      // Containers (sites, nodes, groups): panel-like boxes, title at the top in the secondary colour.
      selector: ':parent',
      style: {
        shape: 'round-rectangle',
        'corner-radius': 6,
        'background-color': palette.tertiaryBg,
        'background-opacity': 0.4,
        'border-color': structure,
        'border-width': FPC_GRAPH_STROKE.hairline,
        padding: pad,
        color: muted,
        'font-size': FPC_GRAPH_FONT.container,
        'font-weight': 600,
        'text-valign': 'top',
        'text-halign': 'center',
        'text-margin-y': -4,
        'text-max-width': '200px',
      },
    },
    {
      // Sites: the outer level — a slightly stronger fill, the hierarchy's top.
      selector: `node.${fpcGraphKindClass('site')}`,
      style: { 'background-opacity': 0.6 },
    },
    {
      selector: `node.${fpcGraphKindClass('group')}`,
      style: { 'border-style': 'dashed', 'background-opacity': 0.2 },
    },
    {
      // Nodes: inner containers (or a leaf when empty) on the body background.
      selector: `node.${fpcGraphKindClass('node')}`,
      style: { 'background-color': palette.bodyBg, 'background-opacity': 0.7, width: 40, height: 28 },
    },
    {
      // Workloads: small neutral leaves; the kind reads from the shape, the state from the dot.
      selector: `node.${fpcGraphKindClass('replica')}`,
      style: {
        shape: 'ellipse',
        'background-color': palette.tertiaryBg,
        'border-color': structure,
        'border-width': FPC_GRAPH_STROKE.hairline,
        width: 18,
        height: 18,
        'underlay-shape': 'ellipse',
      },
    },
    {
      // A service's replicas on one node (Loadweaver Workspace, 3.36).
      selector: `node.${fpcGraphKindClass('stack')}`,
      style: {
        'background-color': palette.tertiaryBg,
        'border-color': structure,
        'border-width': FPC_GRAPH_STROKE.hairline,
        width: 112,
        height: 30,
        'text-valign': 'center',
        'text-margin-y': 0,
        'text-max-width': '100px',
      },
    },
    {
      selector: `node.${fpcGraphKindClass('vm')}`,
      style: {
        'background-color': palette.tertiaryBg,
        'border-color': structure,
        'border-width': FPC_GRAPH_STROKE.hairline,
        'border-style': 'double',
        width: 112,
        height: 30,
        'text-valign': 'center',
        'text-margin-y': 0,
        'text-max-width': '100px',
      },
    },
    {
      selector: `node.${fpcGraphKindClass('volume')}`,
      style: {
        shape: 'barrel',
        'background-color': palette.tertiaryBg,
        'border-color': structure,
        'border-width': FPC_GRAPH_STROKE.hairline,
        width: 22,
        height: 26,
      },
    },
    {
      selector: `node.${fpcGraphKindClass('hostname')}`,
      style: {
        shape: 'tag',
        'border-color': structure,
        'border-width': FPC_GRAPH_STROKE.hairline,
        width: 34,
        height: 20,
      },
    },
    {
      selector: `node.${fpcGraphKindClass('address')}`,
      style: {
        shape: 'diamond',
        'background-color': palette.tertiaryBg,
        'border-color': structure,
        'border-width': FPC_GRAPH_STROKE.hairline,
        width: 16,
        height: 16,
      },
    },
    {
      selector: `node.${fpcGraphKindClass('external')}`,
      style: {
        shape: 'hexagon',
        'background-color': palette.tertiaryBg,
        'border-color': structure,
        'border-width': FPC_GRAPH_STROKE.hairline,
        'border-style': 'dashed',
        width: 30,
        height: 26,
      },
    },
    // Status: a small dot at the top-right corner, the fill stays neutral.
    ...FPC_GRAPH_STATUS_TONES.map((name) => ({
      selector: `node.fpc-status-${name}`,
      style: {
        'background-image': fpcGraphStatusDot(tone[name], palette.bodyBg),
        'background-width': 9,
        'background-height': 9,
        'background-fit': 'none',
        'background-clip': 'none',
        'background-image-containment': 'over',
        'background-position-x': '100%',
        'background-position-y': '0%',
        'background-offset-x': 3,
        'background-offset-y': -3,
        'bounds-expansion': 4,
      },
    })),
    {
      selector: 'edge',
      style: {
        width: 'data(_width)',
        'line-color': muted,
        'line-opacity': 0.35,
        'target-arrow-color': muted,
        'target-arrow-shape': 'triangle',
        'arrow-scale': 0.6,
        // Straight (the star orders sites for few crossings, 2026-10-29); only parallel edges between the same pair
        // fan out into gentle arcs, `control-point-step-size` apart, arrowheads along the curve.
        'curve-style': 'bezier',
        'control-point-step-size': 24,
        label: 'data(label)',
        color: muted,
        'font-family': font,
        'font-size': FPC_GRAPH_FONT.edge,
        'min-zoomed-font-size': 6,
        'text-rotation': 'autorotate',
        'text-background-color': palette.bodyBg,
        'text-background-opacity': 0.9,
        'text-background-padding': '2px',
        'text-background-shape': 'roundrectangle',
      },
    },
    {
      selector: `edge.${fpcGraphKindClass('proposed')}, edge.${fpcGraphKindClass('monitor')}`,
      style: { 'line-style': 'dashed', 'line-dash-pattern': [6, 4] },
    },
    {
      // A plan's proposed policy edge: the plan's "create" tone.
      selector: `edge.${fpcGraphKindClass('proposed')}`,
      style: { 'line-color': palette.success, 'target-arrow-color': palette.success, 'line-opacity': 0.9 },
    },
    {
      // Planned workload moves (migration arrows of a plan / draft preview): the strongest neutral, dashed.
      selector: `edge.${fpcGraphKindClass('migration')}`,
      style: {
        'line-style': 'dashed',
        'line-dash-pattern': [8, 4],
        'line-color': palette.bodyColor,
        'target-arrow-color': palette.bodyColor,
        'line-opacity': 0.8,
        width: FPC_GRAPH_STROKE.mark,
      },
    },
    {
      selector: `edge.${fpcGraphKindClass('denied')}`,
      style: {
        'line-color': palette.danger,
        'target-arrow-color': palette.danger,
        'target-arrow-shape': 'tee',
        'line-opacity': 0.9,
      },
    },
    {
      // Hovering / selecting an element brings its edges forward (`fpc-related`, set by the canvas).
      selector: 'edge.fpc-related',
      style: { 'line-opacity': 0.85 },
    },
    {
      selector: 'edge.fpc-edge--animated',
      style: { 'line-style': 'dashed', 'line-dash-pattern': [8, 4] },
    },
    // Plan overlay: tone borders + a faint halo; deletions fade.
    ...(
      [
        ['create', palette.success],
        ['update', palette.warning],
        ['delete', palette.danger],
      ] as const
    ).flatMap(([change, color]) => [
      {
        selector: `node.fpc-change-${change}`,
        style: {
          'border-color': color,
          'border-width': FPC_GRAPH_STROKE.mark,
          'underlay-color': color,
          'underlay-opacity': 0.14,
          ...(change === 'delete' ? { 'border-style': 'dashed', opacity: 0.6 } : {}),
        },
      },
      {
        selector: `edge.fpc-change-${change}`,
        style: {
          'line-color': color,
          'target-arrow-color': color,
          'line-opacity': 0.9,
          ...(change === 'delete' ? { 'line-style': 'dashed', opacity: 0.6 } : {}),
        },
      },
    ]),
    // Hover / selection: only the border turns primary, no shadow / halo / overlay (the plan marks' tone halos above
    // stay; they are state, not interaction). Hover is 2 px (a hairline scaled to the fitted zoom rendered ~0.3 px and was
    // invisible, round 2); selection is the same primary border at 3 px, so the two stay distinguishable.
    {
      selector: 'node.fpc-hover',
      style: {
        color: palette.bodyColor,
        'border-color': palette.primary,
        'border-width': FPC_GRAPH_STROKE.hover,
      },
    },
    {
      selector: 'node:selected',
      style: {
        color: palette.bodyColor,
        'border-color': palette.primary,
        'border-width': FPC_GRAPH_STROKE.selected,
      },
    },
    {
      selector: 'edge:selected',
      style: {
        'line-color': palette.primary,
        'target-arrow-color': palette.primary,
        'line-opacity': 1,
      },
    },
    {
      selector: 'core',
      style: {
        'selection-box-color': palette.primary,
        'selection-box-border-color': palette.primary,
        'active-bg-opacity': 0,
      },
    },
    {
      // Pressing an element (mouse down / tap): no overlay, the primary border is the whole feedback.
      selector: 'node:active, edge:active',
      style: { 'overlay-opacity': 0 },
    },
    // Search / filter misses stay in place, faded (`fpc-dimmed` class).
    { selector: '.fpc-dimmed', style: { opacity: 0.25 } },
    // Layers
    { selector: '.fpc-hidden', style: { display: 'none' } },
  ];

  return blocks as unknown as cytoscape.StylesheetJson;
}
