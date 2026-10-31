import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';
import { FpcTreeComponent } from './tree.component';

const meta: Meta = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** Resource / object trees (Proxmox-style navigation), virtualized with lazy children, health dots, draft marks, count badges and a context-menu event. **Pairs with:** \`fpc-split-pane\`, \`fpc-context-menu\`, \`fpc-search-field\` (filter with \`fpcFilterTree\`).`,
      },
    },
  },
  title: 'Navigation/Tree',
  decorators: [moduleMetadata({ imports: [FpcTreeComponent] })],
  render: () => ({
    props: {
      nodes: [
        {
          id: 'cluster',
          label: 'Cluster',
          icon: 'hdd-stack',
          status: 'success',
          badge: 5,
          children: [
            {
              id: 'site:eu',
              label: 'eu-central',
              icon: 'geo-alt',
              children: [
                { id: 'node:n1', label: 'n1', icon: 'hdd-network', status: 'success' },
                { id: 'node:n2', label: 'n2', icon: 'hdd-network', status: 'warning', mark: true, hint: 'draining' },
              ],
            },
            { id: 'site:us', label: 'us-east', icon: 'geo-alt', hasChildren: true },
          ],
        },
      ],
    },
    template: `<div style="height: 320px; width: 300px; border: 1px solid var(--bs-border-color)">
  <fpc-tree ariaLabel="Resources" [nodes]="nodes" [expanded]="['cluster', 'site:eu']" />
</div>`,
  }),
};

export default meta;

export const Default: StoryObj = {};
