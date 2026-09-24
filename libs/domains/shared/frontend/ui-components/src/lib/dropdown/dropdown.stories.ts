import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';
import { action } from 'storybook/actions';

import { FpcDropdownItemComponent } from '../dropdown-item/dropdown-item.component';
import { FpcDropdownComponent } from './dropdown.component';

/** Storybook does not derive the implicit `Change` output of `model()` inputs, so it is declared here. */
type DropdownStoryArgs = FpcDropdownComponent & { openChange: (value: boolean) => void };

const meta: Meta<DropdownStoryArgs> = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** Bootstrap dropdown host for menus (language, overflow actions).

**Pairs with:** \`fpc-dropdown-item\`; also used by \`fpc-language-switcher\`.`,
      },
    },
  },

  title: 'Navigation/Dropdown',
  component: FpcDropdownComponent,
  decorators: [moduleMetadata({ imports: [FpcDropdownComponent, FpcDropdownItemComponent] })],
  argTypes: {
    alignment: { control: 'inline-radio', options: ['start', 'end'] },
  },
  args: {
    open: true,
    alignment: 'start',
    disabled: false,
    closeOnSelect: true,
    openChange: action('openChange'),
  },
  render: (args) => ({
    props: args,
    template: `<div style="min-height: 14rem">
            <fpc-dropdown
                [open]="open"
                [alignment]="alignment"
                [disabled]="disabled"
                [closeOnSelect]="closeOnSelect"
                (openChange)="openChange($event)"
            >
                <button class="btn btn-secondary" type="button" fpcDropdownTrigger>
                    Actions <i class="bi bi-chevron-down"></i>
                </button>
                <fpc-dropdown-item icon="pencil">Edit</fpc-dropdown-item>
                <fpc-dropdown-item icon="files">Duplicate</fpc-dropdown-item>
                <fpc-dropdown-item icon="trash" [danger]="true">Delete</fpc-dropdown-item>
            </fpc-dropdown>
        </div>`,
  }),
};

export default meta;

type Story = StoryObj<DropdownStoryArgs>;

export const Open: Story = {};

export const Closed: Story = { args: { open: false } };

export const AlignedEnd: Story = { args: { alignment: 'end' } };

export const StaysOpenOnSelect: Story = { args: { closeOnSelect: false } };
