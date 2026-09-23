import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';
import { action } from 'storybook/actions';

import { FpcToastComponent } from './toast.component';

const meta: Meta<FpcToastComponent> = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** Transient success/error messages.

**Pairs with:** \`fpc-toast-container\` for stacking.`,
      },
    },
  },

  title: 'Feedback/Toast',
  component: FpcToastComponent,
  decorators: [moduleMetadata({ imports: [FpcToastComponent] })],
  argTypes: {
    variant: { control: 'select', options: ['default', 'primary', 'success', 'danger', 'warning', 'info'] },
  },
  args: {
    open: true,
    variant: 'success',
    title: 'Invoice sent',
    message: 'INV-2026-004 was emailed to the customer.',
    dismissible: true,
    delay: 0,
    closed: action('closed'),
  },
  render: (args) => ({
    props: args,
    template: `<fpc-toast
            [open]="open"
            [variant]="variant"
            [title]="title"
            [message]="message"
            [dismissible]="dismissible"
            [delay]="delay"
            (closed)="closed()"
        />`,
  }),
};

export default meta;

type Story = StoryObj<FpcToastComponent>;

export const Success: Story = {};

export const Danger: Story = {
  args: { variant: 'danger', title: 'Payment failed', message: 'The card was declined.' },
};

export const WithoutTitle: Story = { args: { title: null, variant: 'default' } };

export const AutoDismiss: Story = { args: { delay: 4000, title: 'Saved', message: 'Closes in 4 seconds.' } };

export const NotDismissible: Story = { args: { dismissible: false } };
