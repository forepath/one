import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';

import { FpcSpinnerComponent } from './spinner.component';

const meta: Meta<FpcSpinnerComponent> = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** Inline loading indicator (buttons, cells).

**When not to:** Full-viewport blocking → \`fpc-loading-overlay\`.`,
      },
    },
  },

  title: 'Feedback/Spinner',
  component: FpcSpinnerComponent,
  decorators: [moduleMetadata({ imports: [FpcSpinnerComponent] })],
  argTypes: {
    size: { control: 'inline-radio', options: ['sm', 'md', 'lg'] },
    type: { control: 'inline-radio', options: ['border', 'grow'] },
  },
  args: { size: 'md', type: 'border', variant: null, label: 'Loading' },
  render: (args) => ({
    props: args,
    template: `<fpc-spinner [size]="size" [type]="type" [variant]="variant" [label]="label" />`,
  }),
};

export default meta;

type Story = StoryObj<FpcSpinnerComponent>;

export const Border: Story = {};

export const Grow: Story = { args: { type: 'grow' } };

export const Primary: Story = { args: { variant: 'primary' } };

export const Sizes: Story = {
  render: () => ({
    template: `<div class="d-flex align-items-center gap-3">
            <fpc-spinner size="sm" />
            <fpc-spinner size="md" />
            <fpc-spinner size="lg" />
        </div>`,
  }),
};
