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

/** More tabs than fit: the rest go into the trailing "More ▾" item; picking one brings it into the bar. */
export const Overflow: Story = {
  args: { activeId: 'summary', ariaLabel: 'Project' },
  render: (args) => ({
    props: args,
    template: `<div style="width: 640px; resize: horizontal; overflow: hidden; border: 1px dashed var(--bs-border-color)">
      <fpc-tab-group [activeId]="activeId" [ariaLabel]="ariaLabel" (activeIdChange)="activeIdChange($event)">
        <fpc-tab id="summary" label="Summary" icon="grid"><p class="p-3 mb-0">Summary</p></fpc-tab>
        <fpc-tab id="contents" label="Contents"><p class="p-3 mb-0">Contents</p></fpc-tab>
        <fpc-tab id="members" label="Members" badge="4"><p class="p-3 mb-0">Members</p></fpc-tab>
        <fpc-tab id="requests" label="Requests" badge="2"><p class="p-3 mb-0">Requests</p></fpc-tab>
        <fpc-tab id="quotas" label="Quotas"><p class="p-3 mb-0">Quotas</p></fpc-tab>
        <fpc-tab id="policies" label="Policies"><p class="p-3 mb-0">Policies</p></fpc-tab>
        <fpc-tab id="history" label="History"><p class="p-3 mb-0">History</p></fpc-tab>
        <fpc-tab id="tasks" label="Task history" icon="list-task"><p class="p-3 mb-0">Task history</p></fpc-tab>
      </fpc-tab-group>
    </div>`,
  }),
};

export const VerticalWithSections: Story = {
  args: { activeId: 'general', ariaLabel: 'Agent configuration' },
  render: (args) => ({
    props: args,
    template: `<div style="height: 320px; border: 1px solid var(--bs-border-color)">
      <fpc-tab-group
        orientation="vertical"
        [activeId]="activeId"
        [ariaLabel]="ariaLabel"
        (activeIdChange)="activeIdChange($event)"
      >
        <fpc-tab id="general" label="General" section="Core">
          <p class="mb-0">General panel</p>
        </fpc-tab>
        <fpc-tab id="models" label="Models" section="Core">
          <p class="mb-0">Models panel</p>
        </fpc-tab>
        <fpc-tab id="mcp" label="MCP" section="Extensions">
          <p class="mb-0">MCP panel</p>
        </fpc-tab>
        <fpc-tab id="permissions" label="Permissions" section="Security">
          <p class="mb-0">Permissions panel</p>
        </fpc-tab>
      </fpc-tab-group>
    </div>`,
  }),
};
