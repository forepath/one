import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';

import { FpcSectionColumnComponent } from '../section-column/section-column.component';
import { FpcSectionRowComponent } from './section-row.component';

const meta: Meta<FpcSectionRowComponent> = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** Horizontal page rows (\`marketingHidden\`, \`nowrap\` for dense toolbars).

**Pairs with:** \`fpc-section-column\`.`,
      },
    },
  },

  title: 'Layout/Section Row',
  component: FpcSectionRowComponent,
  decorators: [moduleMetadata({ imports: [FpcSectionRowComponent, FpcSectionColumnComponent] })],
  args: { nowrap: false },
  render: (args) => ({
    props: args,
    template: `<div style="height: 12rem" class="border rounded">
            <fpc-section-row [nowrap]="nowrap">
                <fpc-section-column class="border-end p-3">Column A</fpc-section-column>
                <fpc-section-column class="border-end p-3">Column B</fpc-section-column>
                <fpc-section-column class="p-3">Column C</fpc-section-column>
            </fpc-section-row>
        </div>`,
  }),
};

export default meta;

type Story = StoryObj<FpcSectionRowComponent>;

export const Wrapping: Story = {};

export const NoWrap: Story = { args: { nowrap: true } };
