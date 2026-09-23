import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';

import { FpcButtonComponent } from '../button/button.component';
import { FpcSummaryCardValueDirective } from './summary-card-value.directive';
import { FpcSummaryCardComponent } from './summary-card.component';

const meta: Meta<FpcSummaryCardComponent> = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** Metric cell (label / value / actions) inside \`fpc-summary-bar\`.

**Pairs with:** Project value via \`[fpcSummaryCardValue]\`. Mark action controls with \`[fpcSummaryCardActions]\` (single or several); the card wraps them in \`fpc-button-group\`.`,
      },
    },
  },

  title: 'Data Display/Summary Card',
  component: FpcSummaryCardComponent,
  decorators: [
    moduleMetadata({ imports: [FpcSummaryCardComponent, FpcSummaryCardValueDirective, FpcButtonComponent] }),
  ],
  argTypes: {
    tone: { control: 'select', options: ['default', 'primary', 'success', 'danger', 'warning', 'info'] },
  },
  args: { label: 'Open invoices', value: '12', tone: 'default' },
  render: (args) => ({
    props: args,
    template: `<div class="border rounded" style="max-width: 16rem">
            <fpc-summary-card [label]="label" [value]="value" [tone]="tone" />
        </div>`,
  }),
};

export default meta;

type Story = StoryObj<FpcSummaryCardComponent>;

export const Default: Story = {};

export const Danger: Story = { args: { tone: 'danger', label: 'Overdue', value: '3' } };

export const WithProjectedValueAndActions: Story = {
  render: () => ({
    template: `<div class="border rounded" style="max-width: 20rem">
            <fpc-summary-card label="Active plans" tone="success">
                <span fpcSummaryCardValue>12</span>
                <fpc-button
                    fpcSummaryCardActions
                    variant="secondary"
                    size="sm"
                    iconOnly
                    ariaLabel="View plans"
                >
                    <i class="bi bi-box-arrow-up-right" aria-hidden="true"></i>
                </fpc-button>
                <fpc-button
                    fpcSummaryCardActions
                    variant="secondary"
                    size="sm"
                    iconOnly
                    ariaLabel="Place order"
                >
                    <i class="bi bi-cart" aria-hidden="true"></i>
                </fpc-button>
            </fpc-summary-card>
        </div>`,
  }),
};
