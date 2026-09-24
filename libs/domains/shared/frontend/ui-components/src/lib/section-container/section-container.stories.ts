import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';

import { FpcSectionColumnComponent } from '../section-column/section-column.component';
import { FpcSectionRowComponent } from '../section-row/section-row.component';
import { FpcSectionContainerComponent } from './section-container.component';

const meta: Meta<FpcSectionContainerComponent> = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** Outer page shell for console content areas.

**Pairs with:** \`fpc-section-row\` / \`fpc-section-column\`.`,
      },
    },
  },

  title: 'Layout/Section Container',
  component: FpcSectionContainerComponent,
  decorators: [
    moduleMetadata({
      imports: [FpcSectionContainerComponent, FpcSectionRowComponent, FpcSectionColumnComponent],
    }),
  ],
  render: () => ({
    template: `<div style="height: 20rem" class="border rounded">
            <fpc-section-container>
                <fpc-section-row>
                    <fpc-section-column [scroll]="true" class="border-end p-3">
                        <p>Left column, scrolls independently.</p>
                    </fpc-section-column>
                    <fpc-section-column [scroll]="true" class="p-3">
                        <p>Right column, scrolls independently.</p>
                    </fpc-section-column>
                </fpc-section-row>
            </fpc-section-container>
        </div>`,
  }),
};

export default meta;

type Story = StoryObj<FpcSectionContainerComponent>;

export const TwoColumns: Story = {};
