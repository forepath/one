import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';
import { action } from 'storybook/actions';

import { FpcListAppendFooterComponent } from './list-append-footer.component';

const meta: Meta<FpcListAppendFooterComponent> = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** Footer under infinite lists (load more / end sentinel).

**Pairs with:** \`fpcInfiniteScroll\`.`,
      },
    },
  },

  title: 'Data Display/List Append Footer',
  component: FpcListAppendFooterComponent,
  decorators: [moduleMetadata({ imports: [FpcListAppendFooterComponent] })],
  args: { loading: false, error: false, retryLabel: 'Retry loading more', retry: action('retry') },
  render: (args) => ({
    props: args,
    template: `<fpc-list-append-footer
            [loading]="loading"
            [error]="error"
            [retryLabel]="retryLabel"
            (retry)="retry()"
        />`,
  }),
};

export default meta;

type Story = StoryObj<FpcListAppendFooterComponent>;

export const Idle: Story = {};

export const Loading: Story = { args: { loading: true } };

export const Failed: Story = { args: { error: true } };
