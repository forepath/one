import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';
import { action } from 'storybook/actions';

import { FpcFormSwitchComponent } from './form-switch.component';

/** Storybook does not derive the implicit `Change` output of `model()` inputs, so it is declared here. */
type FormSwitchStoryArgs = FpcFormSwitchComponent & { checkedChange: (value: boolean) => void };

const meta: Meta<FormSwitchStoryArgs> = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** On/off settings toggles in consoles and admin panels.

**When not to:** Multi-option choices → radios/\`fpc-form-check\`.`,
      },
    },
  },

  title: 'Forms/Form Switch',
  component: FpcFormSwitchComponent,
  decorators: [moduleMetadata({ imports: [FpcFormSwitchComponent] })],
  args: {
    checked: false,
    disabled: false,
    label: 'Enable notifications',
    checkedChange: action('checkedChange'),
  },
  render: (args) => ({
    props: args,
    template: `<fpc-form-switch
            [checked]="checked"
            [disabled]="disabled"
            [label]="label"
            (checkedChange)="checkedChange($event)"
        />`,
  }),
};

export default meta;

type Story = StoryObj<FormSwitchStoryArgs>;

export const Off: Story = {};

export const On: Story = { args: { checked: true } };

export const Disabled: Story = { args: { disabled: true, checked: true } };

export const WithoutLabel: Story = {
  args: { label: null },
  render: (args) => ({
    props: args,
    template: `<fpc-form-switch [checked]="checked" ariaLabel="Enable notifications" />`,
  }),
};
