import type cytoscape from 'cytoscape';

import type { FpcBrandPalette } from '../brand-tokens/brand-tokens';

/** Converts a kind string into a safe Cytoscape class suffix. */
export function fpcGraphKindClass(kind: string): string {
  return `fpc-kind-${kind.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

type StyleBlock = { selector: string; style: Record<string, unknown> };

/**
 * Cytoscape stylesheet built from the active brand palette. Compound parents render as boxes,
 * node kinds get distinct shapes, edge kinds distinct line styles, and `fpc-change-*` classes the
 * create / update / delete overlay of a plan preview.
 */
export function fpcGraphStylesheet(palette: FpcBrandPalette): cytoscape.StylesheetJson {
  const muted = palette.secondaryColor;
  const blocks: StyleBlock[] = [
    {
      selector: 'node',
      style: {
        label: 'data(label)',
        color: palette.bodyColor,
        'font-family': palette.fontFamily,
        'font-size': 11,
        'text-valign': 'bottom',
        'text-halign': 'center',
        'text-margin-y': 4,
        'text-wrap': 'ellipsis',
        'text-max-width': '120px',
        'background-color': palette.bodyBg,
        'border-color': muted,
        'border-width': 1.5,
        shape: 'round-rectangle',
        width: 36,
        height: 28,
        'underlay-padding': 6,
        'underlay-opacity': 0,
        'underlay-shape': 'round-rectangle',
        'transition-property': 'border-color, background-color, underlay-opacity',
        'transition-duration': 150,
      },
    },
    {
      selector: ':parent',
      style: {
        shape: 'round-rectangle',
        'background-color': palette.tertiaryBg,
        'background-opacity': 0.6,
        'border-color': palette.borderColor,
        'border-width': 1,
        padding: 16,
        'text-valign': 'top',
        'text-halign': 'center',
        'text-margin-y': -4,
        'font-weight': 600,
      },
    },
    {
      selector: `node.${fpcGraphKindClass('site')}`,
      style: { 'border-color': palette.primary, 'border-width': 2, 'background-opacity': 0.35 },
    },
    {
      selector: `node.${fpcGraphKindClass('group')}`,
      style: { 'border-style': 'dashed', 'border-color': muted, 'background-opacity': 0.25 },
    },
    {
      selector: `node.${fpcGraphKindClass('node')}`,
      style: { 'border-color': palette.primary, 'border-width': 2, width: 44, height: 32 },
    },
    {
      selector: `node.${fpcGraphKindClass('replica')}`,
      style: {
        shape: 'ellipse',
        'background-color': palette.primary,
        'border-color': palette.primary,
        width: 22,
        height: 22,
        'underlay-shape': 'ellipse',
      },
    },
    {
      selector: `node.${fpcGraphKindClass('volume')}`,
      style: { shape: 'barrel', 'background-color': palette.info, 'border-color': palette.info, width: 26, height: 30 },
    },
    {
      selector: `node.${fpcGraphKindClass('hostname')}`,
      style: { shape: 'tag', 'border-color': palette.success, 'border-width': 2, width: 40, height: 22 },
    },
    {
      selector: `node.${fpcGraphKindClass('address')}`,
      style: { shape: 'diamond', 'background-color': muted, 'border-color': muted, width: 20, height: 20 },
    },
    {
      selector: `node.${fpcGraphKindClass('external')}`,
      style: {
        shape: 'hexagon',
        'background-color': palette.tertiaryBg,
        'border-color': palette.secondary,
        'border-style': 'dashed',
        width: 34,
        height: 30,
      },
    },
    {
      selector: 'edge',
      style: {
        width: 'data(_width)',
        'line-color': muted,
        'target-arrow-color': muted,
        'target-arrow-shape': 'triangle',
        'arrow-scale': 0.8,
        'curve-style': 'bezier',
        label: 'data(label)',
        color: palette.secondaryColor,
        'font-family': palette.fontFamily,
        'font-size': 10,
        'text-rotation': 'autorotate',
        'text-background-color': palette.bodyBg,
        'text-background-opacity': 0.85,
        'text-background-padding': '2px',
        'line-opacity': 0.9,
      },
    },
    {
      selector: `edge.${fpcGraphKindClass('proposed')}, edge.${fpcGraphKindClass('monitor')}`,
      style: { 'line-style': 'dashed', 'line-dash-pattern': [6, 4] },
    },
    {
      selector: `edge.${fpcGraphKindClass('monitor')}`,
      style: { 'line-color': palette.info, 'target-arrow-color': palette.info },
    },
    {
      selector: `edge.${fpcGraphKindClass('proposed')}`,
      style: { 'line-color': palette.primary, 'target-arrow-color': palette.primary },
    },
    {
      selector: `edge.${fpcGraphKindClass('denied')}`,
      style: { 'line-color': palette.danger, 'target-arrow-color': palette.danger, 'target-arrow-shape': 'tee' },
    },
    {
      selector: 'edge.fpc-edge--animated',
      style: { 'line-style': 'dashed', 'line-dash-pattern': [8, 4] },
    },
    // Plan overlay
    {
      selector: 'node.fpc-change-create',
      style: {
        'border-color': palette.success,
        'border-width': 3,
        'underlay-color': palette.success,
        'underlay-opacity': 0.2,
      },
    },
    {
      selector: 'node.fpc-change-update',
      style: {
        'border-color': palette.warning,
        'border-width': 3,
        'underlay-color': palette.warning,
        'underlay-opacity': 0.2,
      },
    },
    {
      selector: 'node.fpc-change-delete',
      style: {
        'border-color': palette.danger,
        'border-width': 3,
        'border-style': 'dashed',
        'underlay-color': palette.danger,
        'underlay-opacity': 0.2,
        opacity: 0.6,
      },
    },
    {
      selector: 'edge.fpc-change-create',
      style: { 'line-color': palette.success, 'target-arrow-color': palette.success },
    },
    {
      selector: 'edge.fpc-change-update',
      style: { 'line-color': palette.warning, 'target-arrow-color': palette.warning },
    },
    {
      selector: 'edge.fpc-change-delete',
      style: {
        'line-color': palette.danger,
        'target-arrow-color': palette.danger,
        'line-style': 'dashed',
        opacity: 0.6,
      },
    },
    // Selection
    {
      selector: 'node:selected',
      style: {
        'border-color': palette.primary,
        'border-width': 3,
        'underlay-color': palette.primary,
        'underlay-opacity': 0.25,
      },
    },
    {
      selector: 'edge:selected',
      style: {
        'line-color': palette.primary,
        'target-arrow-color': palette.primary,
        'underlay-color': palette.primary,
        'underlay-opacity': 0.2,
        'underlay-padding': 4,
      },
    },
    {
      selector: 'core',
      style: {
        'selection-box-color': palette.primary,
        'selection-box-border-color': palette.primary,
        'active-bg-color': palette.primary,
        'active-bg-opacity': 0.15,
      },
    },
    {
      selector: 'node:active',
      style: { 'overlay-color': palette.primary, 'overlay-opacity': 0.12, 'overlay-padding': 4 },
    },
    // Layers
    { selector: '.fpc-hidden', style: { display: 'none' } },
  ];

  return blocks as unknown as cytoscape.StylesheetJson;
}
