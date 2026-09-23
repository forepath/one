import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';
import { action } from 'storybook/actions';

import { FpcInfiniteScrollDirective } from './infinite-scroll.directive';

interface InfiniteScrollStoryArgs {
  rootMargin: string;
  threshold: number;
  paused: boolean;
  disabled: boolean;
  rows: number[];
  reachedEnd: () => void;
}

const rows = Array.from({ length: 30 }, (_, index) => index + 1);

const meta: Meta<InfiniteScrollStoryArgs> = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** Directive that loads the next page when the scroll root nears the end.

**Pairs with:** \`fpc-list-append-footer\`, board/list scroll ports.`,
      },
    },
  },

  title: 'Data Display/Infinite Scroll',
  decorators: [moduleMetadata({ imports: [FpcInfiniteScrollDirective] })],
  args: {
    rootMargin: '0px 0px 200px 0px',
    threshold: 0,
    paused: false,
    disabled: false,
    rows,
    reachedEnd: action('reachedEnd'),
  },
  render: (args) => ({
    props: args,
    template: `<div #scrollRoot class="border rounded overflow-auto" style="height: 16rem">
            <div class="list-group list-group-flush">
                @for (row of rows; track row) {
                    <div class="list-group-item">Row {{ row }}</div>
                }
            </div>
            <div
                style="height: 1px"
                fpcInfiniteScroll
                [root]="scrollRoot"
                [rootMargin]="rootMargin"
                [threshold]="threshold"
                [paused]="paused"
                [disabled]="disabled"
                (reachedEnd)="reachedEnd()"
            ></div>
        </div>`,
  }),
};

export default meta;

type Story = StoryObj<InfiniteScrollStoryArgs>;

export const ReachesEnd: Story = {};

export const Paused: Story = { args: { paused: true } };

export const Disabled: Story = { args: { disabled: true } };
