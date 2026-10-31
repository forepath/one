import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';

import { FpcBreadcrumbItemComponent } from '../breadcrumb-item/breadcrumb-item.component';
import { FpcBreadcrumbsComponent } from './breadcrumbs.component';

const meta: Meta<FpcBreadcrumbsComponent> = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** Hierarchy trail above detail pages (page / object headers, lane toolbars, modal trails).

**Look:** ancestors are quiet chips (secondary text, faint tint, stronger on hover, inset focus ring), the current item is
semibold body text (\`aria-current="page"\`), separators are muted. \`divider="›"\` draws a small chevron (object
trails); \`/\` (default) stays a text divider for path-style trails. One line at the small control height: crumbs truncate
(full name as \`title\`) and, with \`collapse\` (default), middle crumbs fold into an "…" menu when space is short.

**Pairs with:** \`fpc-breadcrumb-item\` (\`href\`, \`routerLink\`, or \`selected\` only; optional kind \`icon\`).`,
      },
    },
  },

  title: 'Navigation/Breadcrumbs',
  component: FpcBreadcrumbsComponent,
  decorators: [moduleMetadata({ imports: [FpcBreadcrumbsComponent, FpcBreadcrumbItemComponent] })],
  args: { ariaLabel: 'Breadcrumb', divider: '/', size: 'md', collapse: true },
  render: (args) => ({
    props: args,
    template: `<fpc-breadcrumbs [ariaLabel]="ariaLabel" [divider]="divider" [size]="size" [collapse]="collapse">
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

export const WithKindIcons: Story = {
  args: { size: 'sm', divider: '›' },
  render: (args) => ({
    props: args,
    template: `<fpc-breadcrumbs [divider]="divider" [size]="size">
            <fpc-breadcrumb-item label="Cluster" icon="diagram-3" href="#" />
            <fpc-breadcrumb-item label="Site Frankfurt" icon="geo-alt" href="#" />
            <fpc-breadcrumb-item label="node-fra-01" icon="hdd-rack" href="#" />
            <fpc-breadcrumb-item label="postgres-primary" [active]="true" />
        </fpc-breadcrumbs>`,
  }),
};

/** Narrow container: middle crumbs fold into the "…" menu; first and current crumb stay. */
export const Collapsed: Story = {
  args: { size: 'sm', divider: '›' },
  render: (args) => ({
    props: args,
    template: `<div style="max-width: 22rem; resize: horizontal; overflow: auto; padding: 0.25rem; border: 1px dashed var(--bs-border-color);">
          <fpc-breadcrumbs [divider]="divider" [size]="size">
            <fpc-breadcrumb-item label="Workspace" icon="grid" href="#" />
            <fpc-breadcrumb-item label="Projects" href="#" />
            <fpc-breadcrumb-item label="Billing platform" href="#" />
            <fpc-breadcrumb-item label="Services" href="#" />
            <fpc-breadcrumb-item label="Invoice automation worker" [active]="true" />
          </fpc-breadcrumbs>
        </div>`,
  }),
};

/** Path-style trail (folders): text \`/\` divider, monospace. */
export const PathStyle: Story = {
  args: { size: 'sm', divider: '/' },
  render: (args) => ({
    props: args,
    template: `<fpc-breadcrumbs class="font-monospace" [divider]="divider" [size]="size">
            <fpc-breadcrumb-item label="reports" href="#" />
            <fpc-breadcrumb-item label="2026" href="#" />
            <fpc-breadcrumb-item label="10" href="#" />
            <fpc-breadcrumb-item label="capacity.csv" [active]="true" />
        </fpc-breadcrumbs>`,
  }),
};
