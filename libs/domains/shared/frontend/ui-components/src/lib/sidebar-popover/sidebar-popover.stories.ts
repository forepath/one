import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';
import { action } from 'storybook/actions';

import { FpcSidebarComponent } from '../sidebar/sidebar.component';
import { FpcSidebarNavItemComponent } from '../sidebar-nav-item/sidebar-nav-item.component';

import { FpcSidebarPopoverComponent } from './sidebar-popover.component';

/** Storybook does not derive the implicit `Change` output of `model()` inputs, so it is declared here. */
type SidebarPopoverStoryArgs = FpcSidebarPopoverComponent & { openChange: (value: boolean) => void };

const meta: Meta<SidebarPopoverStoryArgs> = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** Menu next to \`fpc-sidebar\` (group / account / mode flyouts in the consoles): icon with the label next to it.

**Pairs with:** \`fpc-sidebar\`, \`fpc-sidebar-nav-item\`, or projected \`.sidebar__item\` rows.`,
      },
    },
  },

  title: 'Navigation/Sidebar Popover',
  component: FpcSidebarPopoverComponent,
  decorators: [
    moduleMetadata({ imports: [FpcSidebarComponent, FpcSidebarPopoverComponent, FpcSidebarNavItemComponent] }),
  ],
  args: { open: true, ariaLabel: 'Admin areas', openChange: action('openChange') },
  render: (args) => ({
    props: args,
    template: `<div class="d-flex border rounded overflow-hidden" style="height: 20rem">
            <fpc-sidebar [collapsible]="false">
            <fpc-sidebar-popover
                [open]="open"
                [ariaLabel]="ariaLabel"
                (openChange)="openChange($event)"
            >
                <fpc-sidebar-nav-item fpcSidebarPopoverTrigger icon="shield-lock" label="Admin" />
                <fpc-sidebar-nav-item icon="people" label="Users" />
                <fpc-sidebar-nav-item icon="building" label="Tenants" badge="unread" />
                <fpc-sidebar-nav-item icon="key" label="Tokens" />
                <fpc-sidebar-nav-item icon="activity" label="Audit" />
                <fpc-sidebar-nav-item icon="gear" label="Settings" />
            </fpc-sidebar-popover>
            </fpc-sidebar>
            <div class="flex-grow-1 p-3">Page content</div>
        </div>`,
  }),
};

export default meta;

type Story = StoryObj<SidebarPopoverStoryArgs>;

export const Open: Story = {};

export const Closed: Story = { args: { open: false } };
