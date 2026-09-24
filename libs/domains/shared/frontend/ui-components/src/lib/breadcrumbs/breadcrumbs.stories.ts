import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';

import { FpcBreadcrumbItemComponent } from '../breadcrumb-item/breadcrumb-item.component';
import { FpcBreadcrumbsComponent } from './breadcrumbs.component';

const meta: Meta<FpcBreadcrumbsComponent> = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** Hierarchy trail above detail pages.

**Pairs with:** \`fpc-breadcrumb-item\`.`,
      },
    },
  },

  title: 'Navigation/Breadcrumbs',
  component: FpcBreadcrumbsComponent,
  decorators: [moduleMetadata({ imports: [FpcBreadcrumbsComponent, FpcBreadcrumbItemComponent] })],
  args: { ariaLabel: 'Breadcrumb', divider: '/', size: 'md' },
  render: (args) => ({
    props: args,
    template: `<fpc-breadcrumbs [ariaLabel]="ariaLabel" [divider]="divider" [size]="size">
            <fpc-breadcrumb-item label="Dashboard" href="#" />
            <fpc-breadcrumb-item label="Projects" href="#" />
            <fpc-breadcrumb-item label="Invoice automation" [active]="true" />
        </fpc-breadcrumbs>`,
  }),
};

export default meta;

type Story = StoryObj<FpcBreadcrumbsComponent>;

export const Default: Story = {};

export const ChevronDivider: Story = { args: { divider: '›' } };

export const Small: Story = {
  args: { size: 'sm', divider: '›' },
};
