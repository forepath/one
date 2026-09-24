import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';

import { FpcNotificationIndicatorComponent } from './notification-indicator.component';

const meta: Meta<FpcNotificationIndicatorComponent> = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** Attention dots on icons/nav (unread, pending).

**When not to:** Full toast/alert copy → \`fpc-toast\` / \`fpc-alert\`.`,
      },
    },
  },

  title: 'Feedback/Notification Indicator',
  component: FpcNotificationIndicatorComponent,
  decorators: [moduleMetadata({ imports: [FpcNotificationIndicatorComponent] })],
  argTypes: {
    kind: { control: 'select', options: ['default', 'security-warning', 'git', 'unread', 'both'] },
    placement: { control: 'inline-radio', options: ['inline', 'absolute'] },
  },
  args: { kind: 'default', placement: 'inline', ariaLabel: 'Unread notifications' },
  render: (args) => ({
    props: args,
    template: `<span class="d-inline-flex align-items-center gap-2">
            Notifications
            <fpc-notification-indicator [kind]="kind" [placement]="placement" [ariaLabel]="ariaLabel" />
        </span>`,
  }),
};

export default meta;

type Story = StoryObj<FpcNotificationIndicatorComponent>;

export const Unread: Story = {};

export const SecurityWarning: Story = { args: { kind: 'security-warning', ariaLabel: 'Security warning' } };

export const Git: Story = { args: { kind: 'git', ariaLabel: 'Repository activity' } };

export const Both: Story = { args: { kind: 'both', ariaLabel: 'Unread and security warning' } };

export const AbsolutePlacement: Story = {
  args: { placement: 'absolute' },
  render: (args) => ({
    props: args,
    template: `<button class="btn btn-secondary position-relative" type="button">
            <i class="bi bi-bell"></i>
            <fpc-notification-indicator [kind]="kind" placement="absolute" [ariaLabel]="ariaLabel" />
        </button>`,
  }),
};
