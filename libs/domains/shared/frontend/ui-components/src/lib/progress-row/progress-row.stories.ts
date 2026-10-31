import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';

import { FpcProgressRowComponent } from './progress-row.component';

const meta: Meta<FpcProgressRowComponent> = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** Live progress of one operation (apply, rollout, import) as a compact full-width row
under the page header or in a modal footer: slim bar, status text, percent / count.

**When not to:** Progress per row of a list: put a bare \`fpc-progress\` (height 0.375–0.5rem) in a table cell.`,
      },
    },
  },
  title: 'Feedback/Progress row',
  component: FpcProgressRowComponent,
  decorators: [moduleMetadata({ imports: [FpcProgressRowComponent] })],
  argTypes: {
    state: { control: 'select', options: ['running', 'success', 'failed', 'paused', 'idle'] },
    layout: { control: 'select', options: ['stacked', 'inline'] },
  },
  args: {
    value: 42,
    max: 100,
    state: 'running',
    label: 'Applying layer dns on node-2',
    status: null,
    valueText: null,
    layout: 'stacked',
  },
  render: (args) => ({
    props: args,
    template: `<fpc-progress-row
      [value]="value"
      [max]="max"
      [state]="state"
      [label]="label"
      [status]="status"
      [valueText]="valueText"
      [layout]="layout"
    >
      <span fpcProgressRowAside class="text-body-secondary">12:04:31</span>
    </fpc-progress-row>`,
  }),
};

export default meta;

type Story = StoryObj<FpcProgressRowComponent>;

export const Running: Story = {};

export const Inline: Story = { args: { layout: 'inline' } };

export const WithStatusBadge: Story = { args: { status: 'Applying', layout: 'inline' } };

export const Failed: Story = { args: { state: 'failed', value: 60, label: 'Layer dns failed on node-2' } };

export const Done: Story = {
  args: { state: 'success', value: 5, max: 5, valueText: '5 / 5', label: 'All nodes applied' },
};
