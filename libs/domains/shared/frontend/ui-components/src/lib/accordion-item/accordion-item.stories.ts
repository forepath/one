import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';
import { action } from 'storybook/actions';

import { FpcAccordionItemComponent } from './accordion-item.component';

const meta: Meta<FpcAccordionItemComponent> = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** One expandable section inside \`fpc-accordion\`.

**Pairs with:** \`fpc-accordion\`.

**Variants:** \`condensed\` matches dense list rows (\`fpc-list-item variant="condensed"\`).`,
      },
    },
  },

  title: 'Data Display/Accordion Item',
  component: FpcAccordionItemComponent,
  decorators: [moduleMetadata({ imports: [FpcAccordionItemComponent] })],
  args: {
    heading: 'Billing details',
    icon: 'receipt',
    open: true,
    disabled: false,
    variant: 'default',
    toggled: action('toggled'),
  },
  render: (args) => ({
    props: args,
    template: `<div class="accordion">
            <fpc-accordion-item
                [heading]="heading"
                [icon]="icon"
                [open]="open"
                [disabled]="disabled"
                [variant]="variant"
                (toggled)="toggled($event)"
            >
                <p class="mb-0">Invoices are issued on the first working day of each month.</p>
            </fpc-accordion-item>
        </div>`,
  }),
};

export default meta;

type Story = StoryObj<FpcAccordionItemComponent>;

export const Open: Story = {};

export const Collapsed: Story = { args: { open: false } };

export const Disabled: Story = { args: { disabled: true, open: false } };

export const Condensed: Story = { args: { variant: 'condensed' } };
