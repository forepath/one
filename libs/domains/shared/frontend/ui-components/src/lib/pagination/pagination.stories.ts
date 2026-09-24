import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';
import { action } from 'storybook/actions';

import { FpcPaginationComponent } from './pagination.component';

/** Storybook does not derive the implicit `Change` output of `model()` inputs, so it is declared here. */
type PaginationStoryArgs = FpcPaginationComponent & { pageChange: (value: number) => void };

const meta: Meta<PaginationStoryArgs> = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** Page controls for large tables and admin lists.

**When not to:** Infinite scroll feeds → \`fpcInfiniteScroll\`.`,
      },
    },
  },

  title: 'Navigation/Pagination',
  component: FpcPaginationComponent,
  decorators: [moduleMetadata({ imports: [FpcPaginationComponent] })],
  argTypes: {
    size: { control: 'inline-radio', options: ['sm', 'md', 'lg'] },
  },
  args: {
    page: 4,
    totalPages: 12,
    maxVisible: 7,
    size: 'md',
    disabled: false,
    pageChange: action('pageChange'),
  },
  render: (args) => ({
    props: args,
    template: `<fpc-pagination
            [page]="page"
            [totalPages]="totalPages"
            [maxVisible]="maxVisible"
            [size]="size"
            [disabled]="disabled"
            (pageChange)="pageChange($event)"
        />`,
  }),
};

export default meta;

type Story = StoryObj<PaginationStoryArgs>;

export const Middle: Story = {};

export const FirstPage: Story = { args: { page: 1 } };

export const LastPage: Story = { args: { page: 12 } };

export const SinglePage: Story = { args: { page: 1, totalPages: 1 } };

export const Compact: Story = { args: { maxVisible: 3, size: 'sm' } };

export const Disabled: Story = { args: { disabled: true } };
