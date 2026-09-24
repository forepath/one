import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';

import { FpcProgressComponent } from './progress.component';

const meta: Meta<FpcProgressComponent> = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** Determinate or multi-segment progress (uploads, wizards).

**When not to:** Indeterminate wait without value → \`fpc-spinner\`.`,
      },
    },
  },

  title: 'Feedback/Progress',
  component: FpcProgressComponent,
  decorators: [moduleMetadata({ imports: [FpcProgressComponent] })],
  argTypes: {
    variant: {
      control: 'select',
      options: ['primary', 'secondary', 'success', 'danger', 'warning', 'info'],
    },
  },
  args: {
    value: 65,
    max: 100,
    variant: 'primary',
    striped: false,
    animated: false,
    showLabel: true,
    height: '1rem',
  },
  render: (args) => ({
    props: args,
    template: `<fpc-progress
            [value]="value"
            [max]="max"
            [variant]="variant"
            [striped]="striped"
            [animated]="animated"
            [showLabel]="showLabel"
            [height]="height"
            ariaLabel="Storage used"
        />`,
  }),
};

export default meta;

type Story = StoryObj<FpcProgressComponent>;

export const Default: Story = {};

export const Striped: Story = { args: { striped: true } };

export const Animated: Story = { args: { animated: true, variant: 'info' } };

export const Danger: Story = { args: { value: 93, variant: 'danger' } };

export const Thin: Story = { args: { height: '0.375rem', showLabel: false } };

export const CustomLabel: Story = { args: { label: '13 of 20 seats' } };
