import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';

import { FpcButtonComponent } from '../button/button.component';
import { FpcFormControlComponent } from '../form-control/form-control.component';
import { FpcFormFieldComponent } from '../form-field/form-field.component';
import { FpcItemCardComponent } from './item-card.component';

const meta: Meta<FpcItemCardComponent> = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** One entry of a repeated form group, e.g. an invoice or offer line item: a bordered, rounded box with an edge-to-edge header (title + \`[fpcItemCardActions]\`) and a padded body.

**Pairs with:** \`fpc-form-field\`, \`fpc-button\` (remove action in the header).`,
      },
    },
  },

  title: 'Forms/Item Card',
  component: FpcItemCardComponent,
  decorators: [
    moduleMetadata({
      imports: [FpcItemCardComponent, FpcButtonComponent, FpcFormFieldComponent, FpcFormControlComponent],
    }),
  ],
  args: {
    title: 'Line 1',
  },
  render: (args) => ({
    props: args,
    template: `<div style="max-width: 32rem">
            <fpc-item-card [title]="title">
                <fpc-button fpcItemCardActions variant="dark" iconOnly ariaLabel="Remove line">
                    <i class="bi bi-trash" aria-hidden="true"></i>
                </fpc-button>
                <fpc-form-field forId="storyDesc" label="Description">
                    <fpc-form-control controlId="storyDesc" />
                </fpc-form-field>
                <fpc-form-field forId="storyQty" label="Quantity">
                    <fpc-form-control controlId="storyQty" inputType="number" />
                </fpc-form-field>
            </fpc-item-card>
        </div>`,
  }),
};

export default meta;

type Story = StoryObj<FpcItemCardComponent>;

export const Default: Story = {};

export const WithoutHeader: Story = { args: { title: '' } };
