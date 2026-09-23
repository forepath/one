import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';
import { action } from 'storybook/actions';

import { FpcAlertComponent } from './alert.component';

const meta: Meta<FpcAlertComponent> = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** Inline page/form feedback (\`showIcon\` on by default; \`flush\` under page headers).

**When not to:** Transient toast → \`fpc-toast\`.`,
      },
    },
  },

  title: 'Feedback/Alert',
  component: FpcAlertComponent,
  decorators: [moduleMetadata({ imports: [FpcAlertComponent] })],
  argTypes: {
    variant: {
      control: 'select',
      options: ['primary', 'secondary', 'success', 'danger', 'warning', 'info', 'light', 'dark'],
    },
  },
  args: {
    open: true,
    variant: 'info',
    heading: null,
    message: 'The next invoice run starts on the first working day of the month.',
    showIcon: true,
    flush: false,
    dismissible: false,
    closed: action('closed'),
  },
  render: (args) => ({
    props: args,
    template: `<fpc-alert
            [open]="open"
            [variant]="variant"
            [heading]="heading"
            [message]="message"
            [showIcon]="showIcon"
            [flush]="flush"
            [dismissible]="dismissible"
            (closed)="closed()"
        />`,
  }),
};

export default meta;

type Story = StoryObj<FpcAlertComponent>;

export const Info: Story = {};

export const Danger: Story = {
  args: { variant: 'danger', heading: 'Payment failed', message: 'The card was declined.' },
};

export const Warning: Story = { args: { variant: 'warning' } };

export const Dismissible: Story = { args: { dismissible: true } };

export const WithoutIcon: Story = { args: { showIcon: false } };

export const Flush: Story = {
  args: {
    flush: true,
    variant: 'warning',
    message: 'Complete your billing profile before placing an order.',
  },
};

export const WithProjectedContent: Story = {
  render: () => ({
    template: `<fpc-alert variant="success" heading="Export ready">
            <p class="mb-0">The DATEV export is available for <a href="#" class="alert-link">download</a>.</p>
        </fpc-alert>`,
  }),
};
