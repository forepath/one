import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';

import { FpcSectionRowComponent } from '../section-row/section-row.component';
import { FpcSectionColumnComponent } from './section-column.component';

const meta: Meta<FpcSectionColumnComponent> = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** Page columns (\`scroll\`, \`variant\` default/marketing/form, optional title).

**When not to:** Board lane chrome inside a column → \`fpc-board-lane\`.`,
      },
    },
  },

  title: 'Layout/Section Column',
  component: FpcSectionColumnComponent,
  decorators: [moduleMetadata({ imports: [FpcSectionColumnComponent, FpcSectionRowComponent] })],
  args: { scroll: true, grow: null },
  render: (args) => ({
    props: args,
    template: `<div style="height: 12rem" class="border rounded">
            <fpc-section-row [nowrap]="true">
                <fpc-section-column [scroll]="scroll" [grow]="grow" class="border-end p-3">
                    <p>Row 1</p><p>Row 2</p><p>Row 3</p><p>Row 4</p><p>Row 5</p><p>Row 6</p>
                </fpc-section-column>
                <fpc-section-column class="p-3">Static column</fpc-section-column>
            </fpc-section-row>
        </div>`,
  }),
};

export default meta;

type Story = StoryObj<FpcSectionColumnComponent>;

export const Scrollable: Story = {};

export const FixedWidth: Story = { args: { grow: '0 0 12rem' } };
