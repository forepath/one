import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';

import { FpcSidebarNavItemComponent } from '../sidebar-nav-item/sidebar-nav-item.component';
import { FpcSidebarComponent } from './sidebar.component';

const meta: Meta<FpcSidebarComponent> = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** Console nav rail; items scroll while \`[fpcSidebarFooter]\` stays pinned.

**Pairs with:** \`fpc-sidebar-nav-item\`, \`fpc-sidebar-popover\`.`,
      },
    },
  },

  title: 'Navigation/Sidebar',
  component: FpcSidebarComponent,
  decorators: [moduleMetadata({ imports: [FpcSidebarComponent, FpcSidebarNavItemComponent] })],
  args: { width: 'calc(2rem + 40.5px)', ariaLabel: 'Main navigation' },
  render: (args) => ({
    props: args,
    template: `<div class="d-flex border rounded overflow-hidden" style="height: 24rem">
            <fpc-sidebar [width]="width" [ariaLabel]="ariaLabel">
                <fpc-sidebar-nav-item icon="grid" label="Overview" [active]="true" />
                <fpc-sidebar-nav-item icon="list-check" label="Plans" />
                <fpc-sidebar-nav-item icon="file-earmark-text" label="Offers" badge="unread" />
                <fpc-sidebar-nav-item icon="receipt" label="Billing" />
                <fpc-sidebar-nav-item icon="shield-lock" label="Security" badge="security-warning" />
                <fpc-sidebar-nav-item fpcSidebarFooter icon="gear" label="Settings" />
            </fpc-sidebar>
            <div class="flex-grow-1 p-3">Page content</div>
        </div>`,
  }),
};

export default meta;

type Story = StoryObj<FpcSidebarComponent>;

export const Default: Story = {};

export const Cramped: Story = {
  render: (args) => ({
    props: args,
    template: `<div class="d-flex border rounded overflow-hidden" style="height: 14rem">
            <fpc-sidebar [width]="width" [ariaLabel]="ariaLabel">
                <fpc-sidebar-nav-item icon="grid" label="Overview" [active]="true" />
                <fpc-sidebar-nav-item icon="list-check" label="Plans" />
                <fpc-sidebar-nav-item icon="file-earmark-text" label="Offers" />
                <fpc-sidebar-nav-item icon="receipt" label="Billing" />
                <fpc-sidebar-nav-item icon="kanban" label="Projects" />
                <fpc-sidebar-nav-item icon="key" label="Tokens" />
                <fpc-sidebar-nav-item fpcSidebarFooter icon="gear" label="Admin" />
            </fpc-sidebar>
            <div class="flex-grow-1 p-3">Short viewport — items scroll, Admin stays put</div>
        </div>`,
  }),
};

export const Wider: Story = { args: { width: '6rem' } };
