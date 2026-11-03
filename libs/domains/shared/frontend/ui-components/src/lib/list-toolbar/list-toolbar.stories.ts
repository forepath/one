import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';
import { action } from 'storybook/actions';

import { FpcButtonComponent } from '../button/button.component';
import { FpcFormControlComponent } from '../form-control/form-control.component';
import { FpcFormFieldComponent } from '../form-field/form-field.component';
import { FpcSearchFieldComponent } from '../search-field/search-field.component';
import { FpcListToolbarComponent } from './list-toolbar.component';

/** Storybook does not derive the implicit `Change` output of `model()` inputs, so it is declared here. */
type ListToolbarStoryArgs = FpcListToolbarComponent & { openChange: (value: boolean) => void };

const meta: Meta<ListToolbarStoryArgs> = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** The one search / filter strip of every list (3.38 R12): page lists, lane lists
(\`fpcBoardLaneSearch\`), data tables (rendered by \`fpc-data-table\`). One row: search lead → applied chips →
Filters toggle (count of applied filters) → Clear all → actions (Views, columns, Refresh).

**Drawer:** fields only (\`fpc-form-field\` labels above; the drawer lays them out in \`.fpc-filter-grid\`);
**Apply** (or Enter) applies, Esc / outside click close. State + URL via \`fpcListQueryState()\`.

**When not to:** View switches (segmented in the lane header) or breadcrumbs (lane toolbar slot).`,
      },
    },
  },

  title: 'Layout/List Toolbar',
  component: FpcListToolbarComponent,
  decorators: [
    moduleMetadata({
      imports: [
        FpcListToolbarComponent,
        FpcSearchFieldComponent,
        FpcFormControlComponent,
        FpcFormFieldComponent,
        FpcButtonComponent,
      ],
    }),
  ],
  args: {
    open: true,
    filterable: true,
    title: 'Filters',
    activeCount: 2,
    chips: [{ id: 'status', label: 'Status: failed', value: 'failed' }],
    showClear: true,
    clearLabel: 'Clear all',
    openChange: action('openChange'),
    applied: action('applied'),
    cleared: action('cleared'),
  },
  render: (args) => ({
    props: args,
    template: `<div style="height: 22rem; position: relative">
        <fpc-list-toolbar
            [open]="open"
            [filterable]="filterable"
            [title]="title"
            [activeCount]="activeCount"
            [chips]="chips"
            [showClear]="showClear"
            [clearLabel]="clearLabel"
            (openChange)="openChange($event)"
            (applied)="applied()"
            (cleared)="cleared()"
        >
            <fpc-search-field fpcListToolbarLead placeholder="Search invoices" ariaLabel="Search invoices" />
            <fpc-button fpcListToolbarActions variant="secondary" size="sm" iconOnly ariaLabel="Refresh" title="Refresh">
                <i class="bi bi-arrow-clockwise" aria-hidden="true"></i>
            </fpc-button>
            <fpc-form-field forId="sb-from" label="From">
                <fpc-form-control controlType="select" controlId="sb-from"><option value="">All</option></fpc-form-control>
            </fpc-form-field>
            <fpc-form-field forId="sb-state" label="State">
                <fpc-form-control controlType="select" controlId="sb-state">
                    <option value="">All states</option><option value="open">Open</option><option value="paid">Paid</option>
                </fpc-form-control>
            </fpc-form-field>
        </fpc-list-toolbar>
      </div>`,
  }),
};

export default meta;

type Story = StoryObj<ListToolbarStoryArgs>;

export const Open: Story = {};

export const Collapsed: Story = { args: { open: false } };

export const NoActiveFilters: Story = { args: { activeCount: 0, chips: [] } };

export const SearchOnly: Story = { args: { filterable: false, chips: [], activeCount: 0 } };
