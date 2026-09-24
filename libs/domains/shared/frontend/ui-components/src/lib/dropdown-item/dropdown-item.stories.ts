import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';
import { action } from 'storybook/actions';

import { FpcDropdownItemComponent } from './dropdown-item.component';

const meta: Meta<FpcDropdownItemComponent> = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** Rows inside \`fpc-dropdown\` menus (actions, \`routerLink\`, or \`href\`).

**Pairs with:** \`fpc-dropdown\`. Optional trailing controls use \`[fpcDropdownItemEnd]\`.`,
      },
    },
  },

  title: 'Navigation/Dropdown Item',
  component: FpcDropdownItemComponent,
  decorators: [moduleMetadata({ imports: [FpcDropdownItemComponent] })],
  args: { disabled: false, active: false, danger: false, icon: 'pencil', selected: action('selected') },
  render: (args) => ({
    props: args,
    template: `<div class="dropdown-menu show position-static">
            <fpc-dropdown-item
                [disabled]="disabled"
                [active]="active"
                [danger]="danger"
                [icon]="icon"
                (selected)="selected()"
            >Edit ticket</fpc-dropdown-item>
        </div>`,
  }),
};

export default meta;

type Story = StoryObj<FpcDropdownItemComponent>;

export const Default: Story = {};

export const Active: Story = { args: { active: true } };

export const Disabled: Story = { args: { disabled: true } };

export const Danger: Story = { args: { danger: true, icon: 'trash' } };
