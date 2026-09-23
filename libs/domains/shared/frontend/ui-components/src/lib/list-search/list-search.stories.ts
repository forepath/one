import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';
import { action } from 'storybook/actions';

import { FpcListItemComponent } from '../list-item/list-item.component';
import { FpcListComponent } from '../list/list.component';
import { FpcListSearchComponent } from './list-search.component';

/** Storybook does not derive the implicit `Change` output of `model()` inputs, so it is declared here. */
type ListSearchStoryArgs = FpcListSearchComponent & { queryChange: (value: string) => void };

const meta: Meta<ListSearchStoryArgs> = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** Search field stacked above a list (filters a local collection UI).

**Pairs with:** \`fpc-list\` / \`fpc-search-field\` patterns.`,
      },
    },
  },

  title: 'Data Display/List Search',
  component: FpcListSearchComponent,
  decorators: [moduleMetadata({ imports: [FpcListSearchComponent, FpcListComponent, FpcListItemComponent] })],
  args: {
    query: '',
    placeholder: 'Search tickets',
    disabled: false,
    bordered: false,
    queryChange: action('queryChange'),
    cleared: action('cleared'),
  },
  render: (args) => ({
    props: args,
    template: `<div class="border rounded" style="height: 18rem">
            <fpc-list-search
                [query]="query"
                [placeholder]="placeholder"
                [disabled]="disabled"
                [bordered]="bordered"
                (queryChange)="queryChange($event)"
                (cleared)="cleared()"
            >
                <fpc-list [flush]="true">
                    <fpc-list-item><span fpcListItemTitle>Fix invoice rounding</span></fpc-list-item>
                    <fpc-list-item><span fpcListItemTitle>Add DATEV export</span></fpc-list-item>
                    <fpc-list-item><span fpcListItemTitle>Rotate API tokens</span></fpc-list-item>
                </fpc-list>
            </fpc-list-search>
        </div>`,
  }),
};

export default meta;

type Story = StoryObj<ListSearchStoryArgs>;

export const Default: Story = {};

export const WithQuery: Story = { args: { query: 'invoice' } };

export const WithFooter: Story = {
  render: (args) => ({
    props: args,
    template: `<div class="border rounded" style="height: 18rem">
            <fpc-list-search [query]="query">
                <fpc-list [flush]="true">
                    <fpc-list-item><span fpcListItemTitle>Fix invoice rounding</span></fpc-list-item>
                </fpc-list>
                <div fpcListSearchFooter class="p-2 border-top text-body-secondary small">1 of 42 results</div>
            </fpc-list-search>
        </div>`,
  }),
};
