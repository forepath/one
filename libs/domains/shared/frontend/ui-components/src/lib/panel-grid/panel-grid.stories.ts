import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';

import { FpcPaginationComponent } from '../pagination/pagination.component';
import { FpcPanelComponent } from '../panel/panel.component';
import { FpcSearchFieldComponent } from '../search-field/search-field.component';
import { FpcPanelGridComponent } from './panel-grid.component';

const chartPlaceholder = (label: string) =>
  `<div class="d-flex align-items-center justify-content-center text-body-secondary bg-body-tertiary" style="height: 240px">${label}</div>`;

const meta: Meta<FpcPanelGridComponent> = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** Statistics sections (charts, tables) that span the page edge to edge,
separated by hairlines like \`fpc-summary-bar\` instead of being boxed in cards.

**Pairs with:** \`fpc-panel\` (title bar via \`fpc-lane-header\`, \`fpcPanelActions\`, \`fpcPanelFooter\`, \`flush\` for tables).`,
      },
    },
  },

  title: 'Layout/Panel Grid',
  component: FpcPanelGridComponent,
  decorators: [
    moduleMetadata({
      imports: [FpcPanelGridComponent, FpcPanelComponent, FpcSearchFieldComponent, FpcPaginationComponent],
    }),
  ],
  args: { columns: 3, bordered: true },
  render: (args) => ({
    props: args,
    template: `<fpc-panel-grid [columns]="columns" [bordered]="bordered">
      <fpc-panel title="Messages over time" [span]="2">${chartPlaceholder('Area chart')}</fpc-panel>
      <fpc-panel title="Filter drops and flags by type">${chartPlaceholder('Donut chart')}</fpc-panel>
      <fpc-panel title="Chat I/O" [span]="3" flush>
        <fpc-search-field fpcPanelActions size="sm" placeholder="Search" />
        <div class="table-responsive">
          <table class="table table-hover">
            <thead><tr><th>Time</th><th>User</th><th>Direction</th><th>Words</th></tr></thead>
            <tbody>
              <tr><td>Oct 13, 2026, 9:41 AM</td><td>alex</td><td>Input</td><td>42</td></tr>
              <tr><td>Oct 13, 2026, 9:42 AM</td><td>alex</td><td>Output</td><td>318</td></tr>
              <tr><td>Oct 13, 2026, 9:45 AM</td><td>sam</td><td>Input</td><td>17</td></tr>
            </tbody>
          </table>
        </div>
        <div fpcPanelFooter class="d-flex flex-wrap justify-content-between align-items-center gap-2 w-100">
          <small class="text-body-secondary">Showing 3 of 48</small>
          <fpc-pagination size="sm" [page]="1" [totalPages]="16" />
        </div>
      </fpc-panel>
    </fpc-panel-grid>`,
  }),
};

export default meta;

type Story = StoryObj<FpcPanelGridComponent>;

export const ChartsAndTable: Story = {};

export const SingleColumn: Story = {
  args: { columns: 1 },
  render: (args) => ({
    props: args,
    template: `<fpc-panel-grid [columns]="columns" [bordered]="bordered">
      <fpc-panel title="Turnover over time">${chartPlaceholder('Area chart')}</fpc-panel>
      <fpc-panel title="Turnover by product">${chartPlaceholder('Donut chart')}</fpc-panel>
      <fpc-panel title="Turnover by country">
        <p class="text-body-secondary small mb-0">No country breakdown for selected period.</p>
      </fpc-panel>
    </fpc-panel-grid>`,
  }),
};
