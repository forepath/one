import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';

import { FpcButtonComponent } from '../button/button.component';
import { FpcEmptyStateComponent } from './empty-state.component';

const meta: Meta<FpcEmptyStateComponent> = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** Empty lists/boards with optional CTA; stretch inside flex columns when the lane has no rows.

**Search vs collection empty:** When a search/filter is active and the result set is empty, use \`icon="search"\` and message **No search results**. When the collection itself is empty (no query), keep the domain copy (“No X yet”) and the default \`hourglass-split\` icon (or a domain icon such as drop-here).

**Pairs with:** \`fpc-button\` as action.`,
      },
    },
  },

  title: 'Feedback/Empty State',
  component: FpcEmptyStateComponent,
  decorators: [moduleMetadata({ imports: [FpcEmptyStateComponent, FpcButtonComponent] })],
  argTypes: {
    size: { control: 'inline-radio', options: ['sm', 'md', 'lg'] },
  },
  args: {
    icon: 'hourglass-split',
    title: null,
    message: 'No invoices yet',
    size: 'md',
  },
  render: (args) => ({
    props: args,
    template: `<fpc-empty-state [icon]="icon" [title]="title" [message]="message" [size]="size" />`,
  }),
};

export default meta;

type Story = StoryObj<FpcEmptyStateComponent>;

export const Default: Story = {};

export const Small: Story = { args: { size: 'sm' } };

export const WithAction: Story = {
  args: {
    icon: 'info-circle',
    title: 'No invoices yet',
    message: 'Invoices appear here as soon as the first billing run completes',
  },
  render: (args) => ({
    props: args,
    template: `<fpc-empty-state [icon]="icon" [title]="title" [message]="message">
            <fpc-button fpcEmptyStateActions variant="primary">Create invoice</fpc-button>
        </fpc-empty-state>`,
  }),
};

/** Active search / filter with zero hits — use this pair everywhere. */
export const NoSearchResults: Story = {
  args: { icon: 'search', title: null, message: 'No search results', size: 'sm' },
};
