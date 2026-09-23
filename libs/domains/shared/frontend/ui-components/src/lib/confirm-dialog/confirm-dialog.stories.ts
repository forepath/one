import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';
import { action } from 'storybook/actions';

import { FpcConfirmDialogComponent } from './confirm-dialog.component';

const meta: Meta<FpcConfirmDialogComponent> = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** Constrained confirm/cancel dialogs for destructive or irreversible actions.

**When not to:** Multi-field editors → \`fpc-modal\`.

\`danger\` / \`warning\` tint the confirm button and the modal corner close (X ink matches that button’s text color).`,
      },
    },
  },

  title: 'Overlays/Confirm Dialog',
  component: FpcConfirmDialogComponent,
  decorators: [moduleMetadata({ imports: [FpcConfirmDialogComponent] })],
  args: {
    open: true,
    title: 'Delete project?',
    message: 'All tickets and time entries stay, but the project link is removed.',
    confirmLabel: 'Delete',
    cancelLabel: 'Keep project',
    danger: true,
    warning: false,
    busy: false,
    confirmed: action('confirmed'),
    cancelled: action('cancelled'),
  },
  render: (args) => ({
    props: args,
    template: `<fpc-confirm-dialog
            [open]="open"
            [title]="title"
            [message]="message"
            [confirmLabel]="confirmLabel"
            [cancelLabel]="cancelLabel"
            [danger]="danger"
            [warning]="warning"
            [busy]="busy"
            (confirmed)="confirmed()"
            (cancelled)="cancelled()"
        />`,
  }),
};

export default meta;

type Story = StoryObj<FpcConfirmDialogComponent>;

export const Destructive: Story = {};

export const Caution: Story = {
  args: {
    danger: false,
    warning: true,
    title: 'Overwrite file?',
    message: 'Unsaved changes in the editor will be discarded.',
    confirmLabel: 'Overwrite',
    cancelLabel: 'Keep editing',
  },
};

export const Neutral: Story = {
  args: {
    danger: false,
    warning: false,
    title: 'Publish offer?',
    message: 'The customer receives an email immediately.',
    confirmLabel: 'Publish',
    cancelLabel: 'Cancel',
  },
};

export const Busy: Story = { args: { busy: true } };
