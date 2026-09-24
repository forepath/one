import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';

import { FpcTooltipComponent } from './tooltip.component';

const meta: Meta<FpcTooltipComponent> = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** Title/placement wrapper when a short hover hint is enough.

**Behavior:** Preferred \`placement\` flips when the nearest scroll/clip ancestor lacks room (same idea as \`fpc-sidebar-popover\`). The bubble is fixed and portaled to \`document.body\` so list isolation / overflow cannot cover it.

**When not to:** Critical instructions — put those in visible copy or form hints.`,
      },
    },
  },

  title: 'Overlays/Tooltip',
  component: FpcTooltipComponent,
  decorators: [moduleMetadata({ imports: [FpcTooltipComponent] })],
  argTypes: {
    placement: { control: 'inline-radio', options: ['top', 'bottom', 'start', 'end'] },
    appearance: { control: 'inline-radio', options: ['default', 'panel'] },
  },
  args: { text: 'Re-run the last deployment', placement: 'top', appearance: 'default', nativeTitle: true },
  render: (args) => ({
    props: args,
    template: `<div class="p-5 d-flex justify-content-center">
            <fpc-tooltip [text]="text" [placement]="placement" [appearance]="appearance" [nativeTitle]="nativeTitle">
                <button class="btn btn-secondary" type="button">Hover me</button>
            </fpc-tooltip>
        </div>`,
  }),
};

export default meta;

type Story = StoryObj<FpcTooltipComponent>;

export const Top: Story = {};

export const Bottom: Story = { args: { placement: 'bottom' } };

export const Start: Story = { args: { placement: 'start' } };

export const End: Story = { args: { placement: 'end' } };

export const Panel: Story = {
  args: {
    appearance: 'panel',
    text: 'usage:write\ninvoices:read\ntickets:read',
    nativeTitle: false,
  },
};
