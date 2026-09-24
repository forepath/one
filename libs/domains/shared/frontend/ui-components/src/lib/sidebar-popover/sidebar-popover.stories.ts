import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';
import { action } from 'storybook/actions';

import { FpcSidebarNavItemComponent } from '../sidebar-nav-item/sidebar-nav-item.component';
import { FpcSidebarPopoverComponent } from './sidebar-popover.component';

/** Storybook does not derive the implicit `Change` output of `model()` inputs, so it is declared here. */
type SidebarPopoverStoryArgs = FpcSidebarPopoverComponent & { openChange: (value: boolean) => void };

const meta: Meta<SidebarPopoverStoryArgs> = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** Admin tile grid next to \`fpc-sidebar\` (consoles).

**Pairs with:** \`fpc-sidebar\`, \`fpc-sidebar-nav-item\`, or projected \`.sidebar__item\` tiles.`,
      },
    },
  },

  title: 'Navigation/Sidebar Popover',
  component: FpcSidebarPopoverComponent,
  decorators: [moduleMetadata({ imports: [FpcSidebarPopoverComponent, FpcSidebarNavItemComponent] })],
  args: { open: true, columns: 3, ariaLabel: 'Admin areas', openChange: action('openChange') },
  render: (args) => ({
    props: args,
    template: `<div class="bg-body-tertiary border rounded d-inline-block" style="min-height: 16rem">
            <fpc-sidebar-popover
                [open]="open"
                [columns]="columns"
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
        </div>`,
  }),
};

export default meta;

type Story = StoryObj<SidebarPopoverStoryArgs>;

export const Open: Story = {};

export const Closed: Story = { args: { open: false } };

export const TwoColumns: Story = { args: { columns: 2 } };
