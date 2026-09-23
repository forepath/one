import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';

import { FpcLabelComponent } from './label.component';

const meta: Meta<FpcLabelComponent> = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** Form labels outside or beside controls; required marker support.

**Pairs with:** Prefer \`fpc-form-field\` when you also need hint/error slots.`,
      },
    },
  },

  title: 'Forms/Label',
  component: FpcLabelComponent,
  decorators: [moduleMetadata({ imports: [FpcLabelComponent] })],
  args: { forId: 'email', required: false, requiredText: 'required' },
  render: (args) => ({
    props: args,
    template: `<div>
            <fpc-label [forId]="forId" [required]="required" [requiredText]="requiredText">Email address</fpc-label>
            <input id="email" type="email" class="form-control" />
        </div>`,
  }),
};

export default meta;

type Story = StoryObj<FpcLabelComponent>;

export const Default: Story = {};

export const Required: Story = { args: { required: true } };
