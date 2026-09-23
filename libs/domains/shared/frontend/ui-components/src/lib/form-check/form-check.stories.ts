import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';
import { action } from 'storybook/actions';

import { FpcFormCheckGroupComponent } from '../form-check-group/form-check-group.component';
import { FpcFormCheckComponent } from './form-check.component';

type FormCheckStoryArgs = FpcFormCheckComponent & { checkedChange: (value: boolean) => void };

const meta: Meta<FormCheckStoryArgs> = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** Single checkbox or radio with CVA (boolean checkbox; radios via \`valueSelect\`).

**Pairs with:** \`fpc-form-check-group\` for related sets; legal/accept toggles on order wizards.`,
      },
    },
  },

  title: 'Forms/Form Check',
  component: FpcFormCheckComponent,
  decorators: [moduleMetadata({ imports: [FpcFormCheckComponent, FpcFormCheckGroupComponent] })],
  argTypes: {
    type: { control: 'inline-radio', options: ['checkbox', 'radio'] },
  },
  args: {
    type: 'checkbox',
    label: 'Accept terms',
    checked: false,
    disabled: false,
    inline: false,
    checkedChange: action('checkedChange'),
  },
  render: (args) => ({
    props: args,
    template: `<fpc-form-check
            [type]="type"
            [label]="label"
            [checked]="checked"
            [disabled]="disabled"
            [inline]="inline"
            (checkedChange)="checkedChange($event)"
        />`,
  }),
};

export default meta;

type Story = StoryObj<FormCheckStoryArgs>;

export const Checkbox: Story = {};

export const CheckboxDisabled: Story = { args: { disabled: true, checked: true } };

export const RadioGroup: Story = {
  render: () => ({
    props: {
      scope: 'all',
      onSelect: action('valueSelect'),
    },
    template: `<fpc-form-check-group label="Billing scope">
            <fpc-form-check
                type="radio"
                name="scopeDemo"
                checkId="scopeAll"
                value="all"
                label="All customers"
                [checked]="scope === 'all'"
                (valueSelect)="scope = $event; onSelect($event)"
            />
            <fpc-form-check
                type="radio"
                name="scopeDemo"
                checkId="scopeUser"
                value="user"
                label="Specific customer"
                [checked]="scope === 'user'"
                (valueSelect)="scope = $event; onSelect($event)"
            />
        </fpc-form-check-group>`,
  }),
};

export const InlineRadios: Story = {
  render: () => ({
    props: { mode: 'manual' },
    template: `<fpc-form-check-group inline>
            <fpc-form-check
                type="radio"
                inline
                name="modeDemo"
                checkId="modeManual"
                value="manual"
                label="Existing"
                [checked]="mode === 'manual'"
                (valueSelect)="mode = $event"
            />
            <fpc-form-check
                type="radio"
                inline
                name="modeDemo"
                checkId="modeProvision"
                value="provision"
                label="Provision"
                [checked]="mode === 'provision'"
                (valueSelect)="mode = $event"
            />
        </fpc-form-check-group>`,
  }),
};
