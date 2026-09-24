import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';

import { FpcInputGroupComponent } from './input-group.component';

const meta: Meta<FpcInputGroupComponent> = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** Prefix/suffix add-ons around a control (promo codes, search-plus-button, currency).

**Pairs with:** \`fpc-form-control\` + \`fpc-button\` marked \`fpcInputGroupPrefix\` / \`fpcInputGroupSuffix\`.

**When not to:** Full-width search strips with glyph → \`fpc-search-field\`.`,
      },
    },
  },

  title: 'Forms/Input Group',
  component: FpcInputGroupComponent,
  decorators: [moduleMetadata({ imports: [FpcInputGroupComponent] })],
  argTypes: {
    size: { control: 'inline-radio', options: ['sm', 'md', 'lg'] },
  },
  args: { size: 'md', bordered: true },
  render: (args) => ({
    props: args,
    template: `<fpc-input-group [size]="size" [bordered]="bordered">
            <span class="input-group-text" fpcInputGroupPrefix>https://</span>
            <input type="text" class="form-control" placeholder="example.com" />
            <span class="input-group-text" fpcInputGroupSuffix>.forepath.io</span>
        </fpc-input-group>`,
  }),
};

export default meta;

type Story = StoryObj<FpcInputGroupComponent>;

export const PrefixAndSuffix: Story = {};

export const PrefixOnly: Story = {
  render: (args) => ({
    props: args,
    template: `<fpc-input-group [size]="size">
            <span class="input-group-text" fpcInputGroupPrefix><i class="bi bi-currency-euro"></i></span>
            <input type="number" class="form-control" placeholder="0.00" />
        </fpc-input-group>`,
  }),
};

export const ButtonSuffix: Story = {
  render: () => ({
    template: `<fpc-input-group>
            <input type="text" class="form-control" placeholder="Invite by email" />
            <button class="btn btn-primary" type="button" fpcInputGroupSuffix>Invite</button>
        </fpc-input-group>`,
  }),
};

export const Sizes: Story = {
  render: () => ({
    template: `<div class="d-flex flex-column gap-2">
            <fpc-input-group size="sm">
                <span class="input-group-text" fpcInputGroupPrefix>@</span>
                <input type="text" class="form-control" placeholder="Small" />
            </fpc-input-group>
            <fpc-input-group size="lg">
                <span class="input-group-text" fpcInputGroupPrefix>@</span>
                <input type="text" class="form-control" placeholder="Large" />
            </fpc-input-group>
        </div>`,
  }),
};
