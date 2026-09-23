import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';

import { FpcBadgeComponent } from '../badge/badge.component';
import { FpcButtonComponent } from '../button/button.component';
import { FpcLaneHeaderComponent } from '../lane-header/lane-header.component';
import { FpcListItemComponent } from '../list-item/list-item.component';
import { FpcListComponent } from '../list/list.component';
import { FpcSearchFieldComponent } from '../search-field/search-field.component';
import { FpcBoardLaneComponent } from './board-lane.component';

const meta: Meta<FpcBoardLaneComponent> = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** Kanban/list lane shell inside a column (\`scrollBody\`, \`listGroup\`).

**Pairs with:** \`fpc-lane-header\`, \`fpc-list\`.`,
      },
    },
  },

  title: 'Layout/Board Lane',
  component: FpcBoardLaneComponent,
  decorators: [
    moduleMetadata({
      imports: [
        FpcBoardLaneComponent,
        FpcLaneHeaderComponent,
        FpcBadgeComponent,
        FpcButtonComponent,
        FpcSearchFieldComponent,
        FpcListComponent,
        FpcListItemComponent,
      ],
    }),
  ],
  args: { ariaLabel: 'Open tickets', scrollBody: true },
  render: (args) => ({
    props: args,
    template: `<div style="height: 22rem; max-width: 22rem">
            <fpc-board-lane [ariaLabel]="ariaLabel" [scrollBody]="scrollBody" [listGroup]="false" class="h-100">
                <fpc-lane-header fpcBoardLaneHeader title="Open" flush>
                    <fpc-badge fpcLaneHeaderActions color="secondary">3</fpc-badge>
                </fpc-lane-header>
                <fpc-search-field fpcBoardLaneSearch [bordered]="false" placeholder="Filter lane" />
                <fpc-list [flush]="true">
                    <fpc-list-item><span fpcListItemTitle>Fix invoice rounding</span></fpc-list-item>
                    <fpc-list-item><span fpcListItemTitle>Add DATEV export</span></fpc-list-item>
                    <fpc-list-item><span fpcListItemTitle>Rotate API tokens</span></fpc-list-item>
                </fpc-list>
                <div fpcBoardLaneFooter class="p-2 small text-body-secondary">Sum: 12 h</div>
            </fpc-board-lane>
        </div>`,
  }),
};

export default meta;

type Story = StoryObj<FpcBoardLaneComponent>;

export const FullLane: Story = {};

export const BodyOnly: Story = {
  render: () => ({
    template: `<div style="height: 16rem; max-width: 22rem">
            <fpc-board-lane class="h-100">
                <fpc-list [flush]="true">
                    <fpc-list-item><span fpcListItemTitle>Only a body</span></fpc-list-item>
                </fpc-list>
            </fpc-board-lane>
        </div>`,
  }),
};
