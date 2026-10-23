import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';
import { action } from 'storybook/actions';

import { FpcPagerComponent } from './pager.component';

/** Storybook does not derive the implicit `Change` output of `model()` inputs, so it is declared here. */
type PagerStoryArgs = FpcPagerComponent & {
  pageSizeChange: (value: number) => void;
  previousClick: () => void;
  nextClick: () => void;
};

const meta: Meta<PagerStoryArgs> = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** Cursor / keyset paged tables where the total is unknown (previous / next only).

**When not to:** Known totals: use \`fpc-pagination\`. Infinite scroll feeds: use \`fpcInfiniteScroll\`.`,
      },
    },
  },

  title: 'Navigation/Pager',
  component: FpcPagerComponent,
  decorators: [moduleMetadata({ imports: [FpcPagerComponent] })],
  argTypes: {
    size: { control: 'inline-radio', options: ['sm', 'md', 'lg'] },
  },
  args: {
    page: 2,
    hasPrevious: true,
    hasNext: true,
    disabled: false,
    size: 'sm',
    pageSizes: [],
    pageSize: 50,
    pageLabel: 'Page',
    pageSizeChange: action('pageSizeChange'),
    previousClick: action('previous'),
    nextClick: action('next'),
  },
  render: (args) => ({
    props: args,
    template: `<fpc-pager
            [page]="page"
            [hasPrevious]="hasPrevious"
            [hasNext]="hasNext"
            [disabled]="disabled"
            [size]="size"
            [pageSizes]="pageSizes"
            [pageSize]="pageSize"
            [pageLabel]="pageLabel"
            (pageSizeChange)="pageSizeChange($event)"
            (previous)="previousClick()"
            (next)="nextClick()"
        />`,
  }),
};

export default meta;

type Story = StoryObj<PagerStoryArgs>;

export const Middle: Story = {};

export const FirstPage: Story = { args: { page: 1, hasPrevious: false } };

export const LastPage: Story = { args: { page: 7, hasNext: false } };

export const WithPageSizes: Story = { args: { pageSizes: [25, 50, 100, 250] } };

export const Disabled: Story = { args: { disabled: true } };
