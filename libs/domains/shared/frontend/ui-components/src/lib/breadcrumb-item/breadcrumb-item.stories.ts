import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';
import { action } from 'storybook/actions';

import { FpcBreadcrumbItemComponent } from './breadcrumb-item.component';

const meta: Meta<FpcBreadcrumbItemComponent> = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** One crumb in \`fpc-breadcrumbs\`.

**Pairs with:** \`fpc-breadcrumbs\`.`,
      },
    },
  },

  title: 'Navigation/Breadcrumb Item',
  component: FpcBreadcrumbItemComponent,
  decorators: [moduleMetadata({ imports: [FpcBreadcrumbItemComponent] })],
  args: { label: 'Projects', href: '#', active: false, selected: action('selected') },
  render: (args) => ({
    props: args,
    template: `<div class="breadcrumb mb-0">
            <fpc-breadcrumb-item [label]="label" [href]="href" [active]="active" (selected)="selected($event)" />
        </div>`,
  }),
};

export default meta;

type Story = StoryObj<FpcBreadcrumbItemComponent>;

export const Link: Story = {};

export const CurrentPage: Story = { args: { active: true, href: null } };

export const ButtonLike: Story = { args: { href: null, label: 'Handled in TypeScript' } };
