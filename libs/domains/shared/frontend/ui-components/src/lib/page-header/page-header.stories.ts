import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';

import { FpcBreadcrumbItemComponent } from '../breadcrumb-item/breadcrumb-item.component';
import { FpcBreadcrumbsComponent } from '../breadcrumbs/breadcrumbs.component';
import { FpcButtonComponent } from '../button/button.component';
import { FpcPageHeaderComponent } from './page-header.component';

const meta: Meta<FpcPageHeaderComponent> = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** Console title strip (\`bg-body-tertiary\`); \`density\` default/compact; stable height with/without actions.

**Pairs with:** Action \`fpc-button\`s; alerts below with \`flush\`.`,
      },
    },
  },

  title: 'Layout/Page Header',
  component: FpcPageHeaderComponent,
  decorators: [
    moduleMetadata({
      imports: [FpcPageHeaderComponent, FpcButtonComponent, FpcBreadcrumbsComponent, FpcBreadcrumbItemComponent],
    }),
  ],
  args: {
    title: 'Invoices',
    subtitle: '12 open · 3 overdue',
    icon: 'receipt',
    bordered: true,
    density: 'default',
  },
  render: (args) => ({
    props: args,
    template: `<fpc-page-header
            [title]="title"
            [subtitle]="subtitle"
            [icon]="icon"
            [bordered]="bordered"
            [density]="density"
        >
            <fpc-button fpcPageHeaderActions variant="secondary" size="sm">Export</fpc-button>
            <fpc-button fpcPageHeaderActions variant="primary" size="sm">New invoice</fpc-button>
        </fpc-page-header>`,
  }),
};

export default meta;

type Story = StoryObj<FpcPageHeaderComponent>;

export const WithActions: Story = {};

export const TitleOnly: Story = {
  args: { subtitle: null, icon: null },
  render: (args) => ({
    props: args,
    template: `<fpc-page-header [title]="title" [bordered]="bordered" />`,
  }),
};

/** Title-only and WithActions share the same bar height (sm icon-button min-height). */
export const HeightParity: Story = {
  render: () => ({
    template: `<div class="d-flex flex-column gap-3">
            <fpc-page-header title="Without actions" />
            <fpc-page-header title="With actions">
                <fpc-button fpcPageHeaderActions variant="primary" size="sm" iconOnly ariaLabel="Add">
                    <i class="bi bi-plus" aria-hidden="true"></i>
                </fpc-button>
            </fpc-page-header>
        </div>`,
  }),
};

export const WithBreadcrumbs: Story = {
  render: (args) => ({
    props: args,
    template: `<fpc-page-header [title]="title" [subtitle]="subtitle" [icon]="icon">
            <fpc-breadcrumbs fpcPageHeaderBreadcrumbs>
                <fpc-breadcrumb-item label="Dashboard" href="#" />
                <fpc-breadcrumb-item label="Invoices" [active]="true" />
            </fpc-breadcrumbs>
            <fpc-button fpcPageHeaderActions variant="primary" size="sm">New invoice</fpc-button>
        </fpc-page-header>`,
  }),
};
