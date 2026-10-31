import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';
import { FpcDockPanelComponent } from './dock-panel.component';

const meta: Meta = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** A bottom dock in the content column (tasks, events): header always visible, body resizable from the top edge and collapsible; persisted with \`storageKey\`.`,
      },
    },
  },
  title: 'Layout/Dock Panel',
  decorators: [moduleMetadata({ imports: [FpcDockPanelComponent] })],
  render: () => ({
    props: {},
    template: `<div style="height: 360px; display: flex; flex-direction: column; border: 1px solid var(--bs-border-color)">
  <div class="flex-grow-1 p-3">Page content</div>
  <fpc-dock-panel title="Tasks" [collapsed]="false" [height]="160">
    <span fpcDockPanelHeader class="badge text-bg-primary">2 running</span>
    <div class="p-3 small">Plan apply 7c1… 40 %</div>
  </fpc-dock-panel>
</div>`,
  }),
};

export default meta;

export const Default: StoryObj = {};
