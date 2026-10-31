import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';
import { FpcSplitPaneComponent } from './split-pane.component';

const meta: Meta = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** A resizable side column (resource tree 240–480 px, inspectors) next to the main content; drag, arrow keys, Enter collapses; persisted with \`storageKey\`.`,
      },
    },
  },
  title: 'Layout/Split Pane',
  decorators: [moduleMetadata({ imports: [FpcSplitPaneComponent] })],
  render: () => ({
    props: {},
    template: `<div style="height: 240px; border: 1px solid var(--bs-border-color)">
  <fpc-split-pane [min]="160" [max]="480" separatorLabel="Resize the tree">
    <div fpcSplitPaneStart class="p-3">Tree</div>
    <div fpcSplitPaneEnd class="p-3">Content</div>
  </fpc-split-pane>
</div>`,
  }),
};

export default meta;

export const Default: StoryObj = {};
