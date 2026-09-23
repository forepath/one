import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';
import { action } from 'storybook/actions';

import { FpcTabComponent } from '../tab/tab.component';
import { FpcTabGroupComponent } from './tab-group.component';

/** Storybook does not derive the implicit `Change` output of `model()` inputs, so it is declared here. */
type TabGroupStoryArgs = FpcTabGroupComponent & { activeIdChange: (value: string | null) => void };

const meta: Meta<TabGroupStoryArgs> = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** Equal-width segmented button groups (filters, view modes) in consoles.

**Pairs with:** Project \`fpc-tab\` children.`,
      },
    },
  },

  title: 'Navigation/Tab Group',
  component: FpcTabGroupComponent,
  decorators: [moduleMetadata({ imports: [FpcTabGroupComponent, FpcTabComponent] })],
  args: { activeId: 'overview', ariaLabel: 'Project sections', activeIdChange: action('activeIdChange') },
  render: (args) => ({
    props: args,
    template: `<fpc-tab-group [activeId]="activeId" [ariaLabel]="ariaLabel" (activeIdChange)="activeIdChange($event)">
            <fpc-tab id="overview" label="Overview" icon="grid">
                <p class="p-3 mb-0">Overview panel</p>
            </fpc-tab>
            <fpc-tab id="tickets" label="Tickets" icon="list-check">
                <p class="p-3 mb-0">Tickets panel</p>
            </fpc-tab>
            <fpc-tab id="billing" label="Billing" icon="receipt">
                <p class="p-3 mb-0">Billing panel</p>
            </fpc-tab>
        </fpc-tab-group>`,
  }),
};

export default meta;

type Story = StoryObj<TabGroupStoryArgs>;

export const Default: Story = {};

export const SecondTabActive: Story = { args: { activeId: 'tickets' } };

export const WithDisabledTab: Story = {
  render: (args) => ({
    props: args,
    template: `<fpc-tab-group [activeId]="activeId">
            <fpc-tab id="overview" label="Overview"><p class="p-3 mb-0">Overview panel</p></fpc-tab>
            <fpc-tab id="archive" label="Archive" [disabled]="true"><p class="p-3 mb-0">Archive panel</p></fpc-tab>
        </fpc-tab-group>`,
  }),
};

export const FallsBackToFirstEnabledTab: Story = {
  args: { activeId: null },
};
