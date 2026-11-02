import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';
import { action } from 'storybook/actions';

import { FpcBreadcrumbsComponent } from '../breadcrumbs/breadcrumbs.component';
import { FpcBreadcrumbItemComponent } from './breadcrumb-item.component';

const meta: Meta<FpcBreadcrumbItemComponent> = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** One crumb in \`fpc-breadcrumbs\` (which owns the look). Ancestors: \`href\`,
\`routerLink\` (+ \`queryParams\`) or neither (a button that only emits \`selected\`); \`active\` = current page
(semibold text, \`aria-current="page"\`). Optional \`icon\` (muted kind icon); \`title\` defaults to the label.

**Pairs with:** \`fpc-breadcrumbs\`.`,
      },
    },
  },

  title: 'Navigation/Breadcrumb Item',
  component: FpcBreadcrumbItemComponent,
  decorators: [moduleMetadata({ imports: [FpcBreadcrumbsComponent, FpcBreadcrumbItemComponent] })],
  args: { label: 'Projects', href: '#', icon: null, active: false, selected: action('selected') },
  render: (args) => ({
    props: args,
    template: `<fpc-breadcrumbs divider="›">
            <fpc-breadcrumb-item [label]="label" [href]="href" [icon]="icon" [active]="active" (selected)="selected($event)" />
        </fpc-breadcrumbs>`,
  }),
};

export default meta;

type Story = StoryObj<FpcBreadcrumbItemComponent>;

export const Link: Story = {};

export const CurrentPage: Story = { args: { active: true, href: null } };

export const ButtonLike: Story = { args: { href: null, label: 'Handled in TypeScript' } };

export const WithIcon: Story = { args: { icon: 'hdd-rack', label: 'node-fra-01' } };
