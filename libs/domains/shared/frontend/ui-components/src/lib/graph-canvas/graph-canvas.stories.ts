import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';

import { FpcGraphCanvasComponent } from './graph-canvas.component';
import type { FpcGraphEdge, FpcGraphElement } from './graph-canvas.types';

function topology(
  sites = 2,
  nodesPerSite = 3,
  replicasPerNode = 3,
): {
  elements: FpcGraphElement[];
  edges: FpcGraphEdge[];
} {
  const elements: FpcGraphElement[] = [
    { id: 'internet', kind: 'external', label: 'Internet' },
    { id: 'shop.example.com', kind: 'hostname', label: 'shop.example.com' },
  ];
  const edges: FpcGraphEdge[] = [{ source: 'internet', target: 'shop.example.com', kind: 'traffic', animated: true }];

  for (let s = 1; s <= sites; s++) {
    const site = `site-${s}`;

    elements.push({ id: site, kind: 'site', label: `Site ${s}` });

    for (let n = 1; n <= nodesPerSite; n++) {
      const node = `${site}-node-${n}`;

      elements.push({ id: node, kind: 'node', label: `node-${s}${n}`, parent: site });
      elements.push({ id: `${node}-ip`, kind: 'address', label: `10.${s}.0.${n}`, parent: node });

      for (let r = 1; r <= replicasPerNode; r++) {
        const replica = `${node}-web-${r}`;

        elements.push({ id: replica, kind: 'replica', label: `web-${r}`, parent: node, data: { cpu: 0.2 * r } });
        edges.push({ source: 'shop.example.com', target: replica, kind: 'traffic', weight: r * 4, animated: r === 1 });
      }

      elements.push({ id: `${node}-vol`, kind: 'volume', label: 'data', parent: node });
      edges.push({ source: `${node}-web-1`, target: `${node}-vol`, kind: 'mount' });
      edges.push({ source: `${node}-ip`, target: `${node}-web-1`, kind: 'monitor', label: 'probe' });
    }
  }

  edges.push({ id: 'deny-1', source: 'internet', target: 'site-1-node-1-vol', kind: 'denied', label: 'denied' });

  return { elements, edges };
}

const SMALL = topology(2, 2, 2);

const meta: Meta<FpcGraphCanvasComponent> = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** Topology and dependency views (sites → nodes → replicas, volumes, hostnames, network edges), plan previews with create / update / delete overlays.

**When not to:** Charts of numeric series: use the chart theme with ApexCharts.

Wraps Cytoscape.js (built-in layouts \`cose\`, \`breadthfirst\`, \`grid\`, \`concentric\`). Nodes with a \`parent\` render inside it as a box. Inputs are diffed by id, so pushing a new \`elements\` / \`edges\` array on every live update only touches what changed; the layout re-runs only when ids or parents change. Colours are read from the brand CSS variables and refresh when **Theme** or **Color set** changes.

Edge kinds: \`proposed\` / \`monitor\` dashed, \`denied\` red. \`weight\` scales the line width, \`animated\` marches the dashes. Node kinds: \`site\`, \`node\`, \`replica\`, \`group\`, \`volume\`, \`hostname\`, \`address\`, \`external\`.

Fit to the view: right-click the background, or press \`F\` / \`0\` while the canvas has focus (described via \`fitHint\`; no button). Public methods: \`fit()\`, \`center(id)\`, \`relayout()\`.`,
      },
    },
  },

  title: 'Data Display/Graph Canvas',
  component: FpcGraphCanvasComponent,
  decorators: [moduleMetadata({ imports: [FpcGraphCanvasComponent] })],
  argTypes: {
    layout: { control: 'select', options: ['cose', 'breadthfirst', 'grid', 'concentric'] },
    elementSelect: { action: 'elementSelect' },
    edgeSelect: { action: 'edgeSelect' },
    selectionClear: { action: 'selectionClear' },
  },
  args: {
    elements: SMALL.elements,
    edges: SMALL.edges,
    layout: 'cose',
    highlight: null,
    hiddenKinds: null,
    selectedId: null,
  },
  render: (args) => ({
    props: args,
    template: `<fpc-graph-canvas
            style="height: 28rem"
            [elements]="elements"
            [edges]="edges"
            [layout]="layout"
            [highlight]="highlight"
            [hiddenKinds]="hiddenKinds"
            [selectedId]="selectedId"
            (elementSelect)="elementSelect($event)"
            (edgeSelect)="edgeSelect($event)"
            (selectionClear)="selectionClear()"
        />`,
  }),
};

export default meta;

type Story = StoryObj<FpcGraphCanvasComponent>;

export const Default: Story = {};

export const PlanOverlay: Story = {
  args: {
    highlight: {
      'site-2-node-2': 'create',
      'site-2-node-2-web-1': 'create',
      'site-1-node-1-web-2': 'update',
      'site-1-node-2-web-2': 'delete',
    },
    edges: [
      ...SMALL.edges,
      { source: 'shop.example.com', target: 'site-2-node-2-web-1', kind: 'proposed', label: 'proposed' },
    ],
  },
};

export const LayersHidden: Story = {
  name: 'Layers (monitor + volumes hidden)',
  args: { hiddenKinds: ['monitor', 'volume', 'address'] },
};

export const Breadthfirst: Story = { args: { layout: 'breadthfirst' } };

export const Selected: Story = { args: { selectedId: 'site-1-node-1' } };

/** Story-only host that streams updates into the canvas every second. */
@Component({
  selector: 'fpc-graph-canvas-live-demo',
  standalone: true,
  imports: [FpcGraphCanvasComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p class="small text-body-secondary mb-2">
      {{ elements().length }} elements, {{ edges().length }} edges. Edge weights change every second (no relayout);
      every fifth tick a replica is added or removed (relayout).
    </p>
    <fpc-graph-canvas #canvas style="height: 32rem" [elements]="elements()" [edges]="edges()" layout="cose" />
    <div class="mt-2 d-flex gap-2">
      <button type="button" class="btn btn-sm btn-outline-secondary" (click)="canvas.center('shop.example.com')">
        Center hostname
      </button>
    </div>
  `,
})
class GraphCanvasLiveDemoComponent {
  private readonly base = topology(3, 4, 6);
  protected readonly elements = signal(this.base.elements);
  protected readonly edges = signal(this.base.edges);
  private tick = 0;

  constructor() {
    const timer = setInterval(() => this.step(), 1000);

    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  private step(): void {
    this.tick += 1;
    this.edges.update((edges) =>
      edges.map((edge) => (edge.kind === 'traffic' ? { ...edge, weight: Math.round(Math.random() * 40) } : edge)),
    );

    if (this.tick % 5 === 0) {
      const extra = 'site-1-node-1-web-extra';

      this.elements.update((elements) =>
        elements.some((element) => element.id === extra)
          ? elements.filter((element) => element.id !== extra)
          : [...elements, { id: extra, kind: 'replica', label: 'web-extra', parent: 'site-1-node-1' }],
      );
    }
  }
}

export const LiveUpdates: Story = {
  render: () => ({
    moduleMetadata: { imports: [GraphCanvasLiveDemoComponent] },
    template: `<fpc-graph-canvas-live-demo />`,
  }),
};
