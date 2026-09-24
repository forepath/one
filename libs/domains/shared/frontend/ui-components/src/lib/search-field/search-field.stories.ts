import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';
import { action } from 'storybook/actions';
import { FormsModule } from '@angular/forms';

import { FpcSearchFieldComponent } from './search-field.component';

/** Storybook does not derive the implicit `Change` output of `model()` inputs, so it is declared here. */
type SearchFieldStoryArgs = FpcSearchFieldComponent & { valueChange: (value: string) => void };

const meta: Meta<SearchFieldStoryArgs> = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** Console list/board search strips (\`appearance="default"\`: leading search glyph, optional clear) or landing / blog heroes (\`appearance="marketing"\` + \`size="xl"\`).

**When not to:** Typeahead with suggestion menus → \`fpc-typeahead-select\`.`,
      },
    },
  },

  title: 'Forms/Search Field',
  component: FpcSearchFieldComponent,
  decorators: [moduleMetadata({ imports: [FpcSearchFieldComponent, FormsModule] })],
  argTypes: {
    size: { control: 'inline-radio', options: ['sm', 'md', 'lg', 'xl'] },
    appearance: { control: 'inline-radio', options: ['default', 'marketing'] },
  },
  args: {
    value: '',
    placeholder: 'Search tickets',
    size: 'md',
    appearance: 'default',
    disabled: false,
    bordered: true,
    clearable: true,
    valueChange: action('valueChange'),
    cleared: action('cleared'),
  },
  render: (args) => ({
    props: args,
    template: `<fpc-search-field
            [value]="value"
            [placeholder]="placeholder"
            [size]="size"
            [appearance]="appearance"
            [disabled]="disabled"
            [bordered]="bordered"
            [clearable]="clearable"
            (valueChange)="valueChange($event)"
            (cleared)="cleared()"
        />`,
  }),
};

export default meta;

type Story = StoryObj<SearchFieldStoryArgs>;

export const Empty: Story = {};

export const WithQuery: Story = { args: { value: 'invoice' } };

export const Borderless: Story = { args: { bordered: false, value: 'lane filter' } };

export const Disabled: Story = { args: { disabled: true, value: 'locked' } };

export const MarketingXl: Story = {
  args: {
    appearance: 'marketing',
    size: 'xl',
    clearable: false,
    placeholder: 'Search posts',
    ariaLabel: 'Search posts',
  },
};
