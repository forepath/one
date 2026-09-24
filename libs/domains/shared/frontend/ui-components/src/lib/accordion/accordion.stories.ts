import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';

import { FpcAccordionItemComponent } from '../accordion-item/accordion-item.component';
import { FpcAccordionComponent } from './accordion.component';

const meta: Meta<FpcAccordionComponent> = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** Host for collapsible sections (settings, long forms).

**Pairs with:** \`fpc-accordion-item\`.`,
      },
    },
  },

  title: 'Data Display/Accordion',
  component: FpcAccordionComponent,
  decorators: [moduleMetadata({ imports: [FpcAccordionComponent, FpcAccordionItemComponent] })],
  args: { multi: false, flush: false },
  render: (args) => ({
    props: args,
    template: `<fpc-accordion [multi]="multi" [flush]="flush">
            <fpc-accordion-item heading="Getting started" icon="rocket-takeoff" [open]="true">
                <p class="mb-0">Create a workspace and invite your team.</p>
            </fpc-accordion-item>
            <fpc-accordion-item heading="Billing" icon="receipt">
                <p class="mb-0">Invoices are issued monthly.</p>
            </fpc-accordion-item>
            <fpc-accordion-item heading="Archived" icon="archive" [disabled]="true">
                <p class="mb-0">Nothing to see here.</p>
            </fpc-accordion-item>
        </fpc-accordion>`,
  }),
};

export default meta;

type Story = StoryObj<FpcAccordionComponent>;

export const SingleOpen: Story = {};

export const MultipleOpen: Story = { args: { multi: true } };

export const Flush: Story = { args: { flush: true } };
