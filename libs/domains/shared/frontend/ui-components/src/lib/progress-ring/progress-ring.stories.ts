import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';

import { FpcProgressRingComponent } from './progress-ring.component';

const meta: Meta<FpcProgressRingComponent> = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** Compact determinate gauges (capacity, quota, rollout progress) in cards, tables and headers.

**When not to:** Wide progress with segments or striped animation: use \`fpc-progress\`. Indeterminate waits: use \`fpc-spinner\`.

Colours follow the brand through \`--bs-<tone>\`; switch **Color set** and **Theme** in the toolbar.`,
      },
    },
  },

  title: 'Feedback/Progress Ring',
  component: FpcProgressRingComponent,
  decorators: [moduleMetadata({ imports: [FpcProgressRingComponent] })],
  argTypes: {
    tone: {
      control: 'select',
      options: ['primary', 'success', 'warning', 'danger', 'info'],
    },
  },
  args: {
    value: 62,
    max: 100,
    size: 64,
    strokeWidth: 6,
    tone: 'primary',
    label: 'Disk usage',
    showLabel: true,
    centerLabel: null,
  },
  render: (args) => ({
    props: args,
    template: `<fpc-progress-ring
            [value]="value"
            [max]="max"
            [size]="size"
            [strokeWidth]="strokeWidth"
            [tone]="tone"
            [label]="label"
            [showLabel]="showLabel"
            [centerLabel]="centerLabel"
        />`,
  }),
};

export default meta;

type Story = StoryObj<FpcProgressRingComponent>;

export const Default: Story = {};

export const Tones: Story = {
  render: () => ({
    template: `<div class="d-flex gap-3 align-items-center">
      <fpc-progress-ring [value]="20" tone="primary" label="Primary" />
      <fpc-progress-ring [value]="45" tone="info" label="Info" />
      <fpc-progress-ring [value]="70" tone="success" label="Success" />
      <fpc-progress-ring [value]="85" tone="warning" label="Warning" />
      <fpc-progress-ring [value]="97" tone="danger" label="Danger" />
    </div>`,
  }),
};

export const Small: Story = { args: { size: 24, strokeWidth: 3, showLabel: false } };

export const Large: Story = { args: { size: 120, strokeWidth: 10, value: 3, max: 5, centerLabel: '3 / 5' } };
