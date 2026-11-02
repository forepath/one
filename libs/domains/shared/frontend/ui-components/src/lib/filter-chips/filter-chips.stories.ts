import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';
import { FpcFilterChipsComponent } from './filter-chips.component';

const meta: Meta = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** Active \`field:value\` filters parsed from a search field, removable one by one. **Pairs with:** \`fpc-data-table\`, \`fpc-search-field\`.`,
      },
    },
  },
  title: 'Forms/Filter Chips',
  decorators: [moduleMetadata({ imports: [FpcFilterChipsComponent] })],
  render: () => ({
    props: {
      chips: [
        { id: 'kind', field: 'kind', value: 'VirtualMachine' },
        { id: 'in', field: 'in', value: 'project/shop' },
        { id: 'status', field: 'status', value: 'ready', negated: true },
      ],
    },
    template: `<fpc-filter-chips [chips]="chips" />`,
  }),
};

export default meta;

export const Default: StoryObj = {};
