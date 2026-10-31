import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';

import { FpcButtonComponent } from '../button/button.component';
import { FpcListComponent } from '../list/list.component';
import { FpcListItemComponent } from '../list-item/list-item.component';
import { FpcListHeaderComponent } from './list-header.component';

const meta: Meta<FpcListHeaderComponent> = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** The title bar of a page's item collection (list or table): name, count (\`count / total\` while searching) and optional trailing controls.

**Pairs with:** \`fpc-list\`, \`fpc-search-field\`.`,
      },
    },
  },

  title: 'Data Display/List Header',
  component: FpcListHeaderComponent,
  decorators: [
    moduleMetadata({
      imports: [FpcListHeaderComponent, FpcListComponent, FpcListItemComponent, FpcButtonComponent],
    }),
  ],
  args: {
    title: 'Clusters',
    count: 3,
    total: 3,
    sticky: true,
  },
  render: (args) => ({
    props: args,
    template: `<div style="max-width: 32rem">
            <fpc-list-header [title]="title" [count]="count" [total]="total" [sticky]="sticky" />
            <fpc-list [flush]="true">
                <fpc-list-item><span fpcListItemTitle>prod-eu</span></fpc-list-item>
                <fpc-list-item><span fpcListItemTitle>prod-us</span></fpc-list-item>
                <fpc-list-item><span fpcListItemTitle>staging</span></fpc-list-item>
            </fpc-list>
        </div>`,
  }),
};

export default meta;

type Story = StoryObj<FpcListHeaderComponent>;

export const Default: Story = {};

export const Filtered: Story = {
  args: { count: 1, total: 3 },
};
