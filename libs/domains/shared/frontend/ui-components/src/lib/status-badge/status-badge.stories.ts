import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';

import { FpcStatusBadgeComponent } from './status-badge.component';

const meta: Meta<FpcStatusBadgeComponent> = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** Circular icon wells for status/presence in lists and boards.

**When not to:** Text chips or filter pills → \`fpc-badge\`.`,
      },
    },
  },

  title: 'Data Display/Status Badge',
  component: FpcStatusBadgeComponent,
  decorators: [moduleMetadata({ imports: [FpcStatusBadgeComponent] })],
  argTypes: {
    tone: {
      control: 'select',
      options: ['primary', 'secondary', 'success', 'danger', 'warning', 'info', 'light', 'dark', 'neutral'],
    },
    size: { control: 'inline-radio', options: ['sm', 'md', 'lg'] },
  },
  args: { tone: 'success', size: 'md', ariaLabel: 'Paid' },
  render: (args) => ({
    props: args,
    template: `<fpc-status-badge [tone]="tone" [size]="size" [ariaLabel]="ariaLabel">
            <i class="bi bi-check-lg"></i>
        </fpc-status-badge>`,
  }),
};

export default meta;

type Story = StoryObj<FpcStatusBadgeComponent>;

export const Success: Story = {};

export const Danger: Story = { args: { tone: 'danger', ariaLabel: 'Failed' } };

export const Neutral: Story = { args: { tone: 'neutral', ariaLabel: 'Draft' } };

export const Sizes: Story = {
  render: () => ({
    template: `<div class="d-flex align-items-center gap-3">
            <fpc-status-badge size="sm" tone="info"><i class="bi bi-info"></i></fpc-status-badge>
            <fpc-status-badge size="md" tone="warning"><i class="bi bi-exclamation"></i></fpc-status-badge>
            <fpc-status-badge size="lg" tone="primary"><i class="bi bi-rocket"></i></fpc-status-badge>
        </div>`,
  }),
};

export const WithInitial: Story = {
  render: () => ({
    template: `<fpc-status-badge tone="secondary" ariaLabel="Status A">A</fpc-status-badge>`,
  }),
};
