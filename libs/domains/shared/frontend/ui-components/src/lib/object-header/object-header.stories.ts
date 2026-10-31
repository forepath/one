import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';
import { FpcObjectHeaderComponent } from './object-header.component';

const meta: Meta = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** Header of an object page: breadcrumbs, name, status badges, primary actions and a "More" menu; tabs go in the default slot. **Pairs with:** \`fpc-tab-group\`, \`fpc-dropdown\`.`,
      },
    },
  },
  title: 'Layout/Object Header',
  decorators: [moduleMetadata({ imports: [FpcObjectHeaderComponent] })],
  render: () => ({
    props: {
      crumbs: [{ label: 'Cluster', link: '/' }, { label: 'eu-central', link: '/' }, { label: 'n2' }],
      more: [
        { id: 'cordon', label: 'Cordon' },
        { id: 'leave', label: 'Leave', danger: true, dividerBefore: true },
      ],
    },
    template: `<fpc-object-header title="n2" [crumbs]="crumbs" [moreItems]="more" [mark]="true">
  <span fpcObjectHeaderBadges class="badge text-bg-warning">draining</span>
  <button fpcObjectHeaderActions type="button" class="btn btn-sm btn-primary">Shell</button>
</fpc-object-header>`,
  }),
};

export default meta;

export const Default: StoryObj = {};
