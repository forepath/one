import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';

import { FpcSummaryCardValueDirective } from '../summary-card/summary-card-value.directive';
import { FpcSummaryCardComponent } from '../summary-card/summary-card.component';
import { FpcSummaryBarComponent } from './summary-bar.component';

const meta: Meta<FpcSummaryBarComponent> = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** Metrics strip across overview pages; completed rows get full-width bottom dividers.

**Pairs with:** \`fpc-summary-card\`.`,
      },
    },
  },

  title: 'Data Display/Summary Bar',
  component: FpcSummaryBarComponent,
  decorators: [
    moduleMetadata({ imports: [FpcSummaryBarComponent, FpcSummaryCardComponent, FpcSummaryCardValueDirective] }),
  ],
  args: { columns: 4, bordered: true },
  render: (args) => ({
    props: args,
    template: `<fpc-summary-bar [columns]="columns" [bordered]="bordered">
            <fpc-summary-card label="Open" value="12" icon="receipt" />
            <fpc-summary-card label="Overdue" value="3" tone="danger" icon="exclamation-circle" />
            <fpc-summary-card label="Paid this month" value="41" tone="success" icon="check2-circle" />
            <fpc-summary-card label="Revenue" value="18 420,00 €" icon="cash-coin" />
        </fpc-summary-bar>`,
  }),
};

export default meta;

type Story = StoryObj<FpcSummaryBarComponent>;

export const FourCards: Story = {};

export const ThreeCards: Story = {
  args: { columns: 3 },
  render: (args) => ({
    props: args,
    template: `<fpc-summary-bar [columns]="columns">
            <fpc-summary-card label="Open" value="12" icon="receipt" />
            <fpc-summary-card label="Overdue" value="3" tone="danger" icon="exclamation-circle" />
            <fpc-summary-card label="Paid" value="41" tone="success" icon="check2-circle" />
        </fpc-summary-bar>`,
  }),
};

export const WithActions: Story = {
  render: () => ({
    template: `<fpc-summary-bar [columns]="2">
            <fpc-summary-card label="Open invoices" icon="receipt">
                <span fpcSummaryCardValue>12</span>
                <button fpcSummaryCardActions class="btn btn-sm btn-secondary">View</button>
            </fpc-summary-card>
            <fpc-summary-card label="Overdue" tone="danger" icon="exclamation-circle">
                <span fpcSummaryCardValue>3</span>
                <button fpcSummaryCardActions class="btn btn-sm btn-danger">Remind</button>
            </fpc-summary-card>
        </fpc-summary-bar>`,
  }),
};

export const WrappedIncompleteLastRow: Story = {
  args: { columns: 4 },
  render: (args) => ({
    props: args,
    template: `<fpc-summary-bar [columns]="columns" [bordered]="bordered">
            <fpc-summary-card label="One" value="1" icon="people" />
            <fpc-summary-card label="Two" value="2" icon="kanban" />
            <fpc-summary-card label="Three" value="3" icon="clock" />
            <fpc-summary-card label="Four" value="4" icon="ticket-detailed" />
            <fpc-summary-card label="Five" value="5" icon="stack" />
        </fpc-summary-bar>`,
  }),
};
