import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';

import { FpcButtonComponent } from '../button/button.component';
import { FpcListItemComponent } from '../list-item/list-item.component';
import { FpcListComponent } from './list.component';

const meta: Meta<FpcListComponent> = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** List hosts in sidebars, drawers, and settings (flush keeps last-row border).

**Pairs with:** \`fpc-list-item\`, \`fpc-list-search\`, \`fpcInfiniteScroll\`.`,
      },
    },
  },

  title: 'Data Display/List',
  component: FpcListComponent,
  decorators: [moduleMetadata({ imports: [FpcListComponent, FpcListItemComponent, FpcButtonComponent] })],
  args: { flush: false, bordered: true, ariaLabel: 'Recent invoices' },
  render: (args) => ({
    props: args,
    template: `<fpc-list [flush]="flush" [bordered]="bordered" [ariaLabel]="ariaLabel">
            <fpc-list-item>
                <span fpcListItemTitle>INV-2026-001</span>
                <span fpcListItemMeta>Paid · 1 240,00 €</span>
            </fpc-list-item>
            <fpc-list-item [active]="true">
                <span fpcListItemTitle>INV-2026-002</span>
                <span fpcListItemMeta>Open · 980,00 €</span>
                <fpc-button fpcListItemActions variant="secondary" size="sm">Remind</fpc-button>
            </fpc-list-item>
            <fpc-list-item>
                <span fpcListItemTitle>INV-2026-003</span>
                <span fpcListItemMeta>Overdue · 310,00 €</span>
                <fpc-button fpcListItemActions variant="secondary" size="sm">Remind</fpc-button>
            </fpc-list-item>
        </fpc-list>`,
  }),
};

export default meta;

type Story = StoryObj<FpcListComponent>;

export const Bordered: Story = {};

export const Flush: Story = { args: { flush: true } };

export const Borderless: Story = { args: { bordered: false } };
