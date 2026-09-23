import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';
import { action } from 'storybook/actions';

import { FpcButtonComponent } from '../button/button.component';
import { FpcFormControlComponent } from '../form-control/form-control.component';
import { FpcSearchFieldComponent } from '../search-field/search-field.component';
import { FpcCollapsibleFilterPanelComponent } from './collapsible-filter-panel.component';

/** Storybook does not derive the implicit `Change` output of `model()` inputs, so it is declared here. */
type FilterPanelStoryArgs = FpcCollapsibleFilterPanelComponent & { openChange: (value: boolean) => void };

const meta: Meta<FilterPanelStoryArgs> = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** Collapsible filter/facets panels above tables and boards.

**Pairs with:** Form controls and badges for active filters.

**Body layout:** Prefer \`row g-3 mb-0 w-100\` with \`col-12\` / \`col-6\` fields and a trailing
actions row (\`col-12 d-flex gap-2\`) with Apply + Reset.`,
      },
    },
  },

  title: 'Layout/Collapsible Filter Panel',
  component: FpcCollapsibleFilterPanelComponent,
  decorators: [
    moduleMetadata({
      imports: [
        FpcCollapsibleFilterPanelComponent,
        FpcSearchFieldComponent,
        FpcFormControlComponent,
        FpcButtonComponent,
      ],
    }),
  ],
  args: {
    open: true,
    title: 'Filters',
    activeCount: 2,
    showClear: true,
    clearLabel: 'Clear all',
    openChange: action('openChange'),
    cleared: action('cleared'),
  },
  render: (args) => ({
    props: args,
    template: `<fpc-collapsible-filter-panel
            [open]="open"
            [title]="title"
            [activeCount]="activeCount"
            [showClear]="showClear"
            [clearLabel]="clearLabel"
            (openChange)="openChange($event)"
            (cleared)="cleared()"
        >
            <div class="row g-3">
                <div class="col-12">
                    <fpc-search-field placeholder="Search" />
                </div>
                <div class="col-6">
                    <fpc-form-control controlType="select" label="From">
                        <option value="">All</option>
                    </fpc-form-control>
                </div>
                <div class="col-6">
                    <fpc-form-control controlType="select" label="To">
                        <option value="">All</option>
                    </fpc-form-control>
                </div>
                <div class="col-12">
                    <fpc-form-control controlType="select" label="State">
                        <option value="">All states</option>
                        <option value="open">Open</option>
                        <option value="paid">Paid</option>
                    </fpc-form-control>
                </div>
                <div class="col-12 d-flex gap-2">
                    <fpc-button variant="primary" size="sm">Apply</fpc-button>
                    <fpc-button variant="dark" size="sm">Reset</fpc-button>
                </div>
            </div>
        </fpc-collapsible-filter-panel>`,
  }),
};

export default meta;

type Story = StoryObj<FilterPanelStoryArgs>;

export const Open: Story = {};

export const Collapsed: Story = { args: { open: false } };

export const NoActiveFilters: Story = { args: { activeCount: 0 } };
