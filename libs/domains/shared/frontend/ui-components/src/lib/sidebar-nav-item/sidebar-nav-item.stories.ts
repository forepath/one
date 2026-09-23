import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';
import { action } from 'storybook/actions';

import { FpcSidebarNavItemComponent } from './sidebar-nav-item.component';

const meta: Meta<FpcSidebarNavItemComponent> = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** Sidebar tiles (icon + label, active/hover via CSS vars).

**Pairs with:** \`fpc-sidebar\`.`,
      },
    },
  },

  title: 'Navigation/Sidebar Nav Item',
  component: FpcSidebarNavItemComponent,
  decorators: [moduleMetadata({ imports: [FpcSidebarNavItemComponent] })],
  argTypes: {
    badge: { control: 'select', options: [null, 'default', 'unread', 'security-warning', 'git', 'both'] },
  },
  args: {
    icon: 'receipt',
    label: 'Billing',
    active: false,
    disabled: false,
    href: null,
    badge: null,
    selected: action('selected'),
  },
  render: (args) => ({
    props: args,
    template: `<div class="bg-body-tertiary border rounded d-inline-block">
            <fpc-sidebar-nav-item
                [icon]="icon"
                [label]="label"
                [active]="active"
                [disabled]="disabled"
                [href]="href"
                [badge]="badge"
                (selected)="selected()"
            />
        </div>`,
  }),
};

export default meta;

type Story = StoryObj<FpcSidebarNavItemComponent>;

export const Button: Story = {};

export const Active: Story = { args: { active: true } };

export const AsLink: Story = { args: { href: '#' } };

export const WithUnreadBadge: Story = { args: { badge: 'unread', badgeAriaLabel: 'Unread invoices' } };

export const WithSecurityWarning: Story = {
  args: { icon: 'shield-lock', label: 'Security', badge: 'security-warning' },
};

export const Disabled: Story = { args: { disabled: true } };
