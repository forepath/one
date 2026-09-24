import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';

import { FpcTabComponent } from './tab.component';

const meta: Meta<FpcTabComponent> = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** Single segmented control option inside \`fpc-tab-group\`.

**Pairs with:** \`fpc-tab-group\` as the host (\`role=tablist\`).`,
      },
    },
  },

  title: 'Navigation/Tab',
  component: FpcTabComponent,
  decorators: [moduleMetadata({ imports: [FpcTabComponent] })],
  args: { id: 'overview', label: 'Overview', active: true, disabled: false },
  render: (args) => ({
    props: args,
    template: `<fpc-tab [id]="id" [label]="label" [active]="active" [disabled]="disabled">
            <p class="mb-0">Panel content for “{{ label }}”.</p>
        </fpc-tab>`,
  }),
};

export default meta;

type Story = StoryObj<FpcTabComponent>;

export const Active: Story = {};

export const Inactive: Story = { args: { active: false } };
