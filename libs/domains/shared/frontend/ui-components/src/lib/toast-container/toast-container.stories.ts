import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';

import { FpcToastComponent } from '../toast/toast.component';
import { FpcToastContainerComponent } from './toast-container.component';

const meta: Meta<FpcToastContainerComponent> = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** Stack host for multiple toasts (usually fixed corner).

**Pairs with:** \`fpc-toast\`.`,
      },
    },
  },

  title: 'Feedback/Toast Container',
  component: FpcToastContainerComponent,
  decorators: [moduleMetadata({ imports: [FpcToastContainerComponent, FpcToastComponent] })],
  argTypes: {
    placement: {
      control: 'select',
      options: ['top-start', 'top-center', 'top-end', 'middle-center', 'bottom-start', 'bottom-center', 'bottom-end'],
    },
  },
  args: { placement: 'bottom-end', fixed: false },
  render: (args) => ({
    props: args,
    template: `<div class="position-relative border rounded" style="height: 20rem">
            <fpc-toast-container [placement]="placement" [fixed]="fixed">
                <fpc-toast variant="success" title="Invoice sent" message="INV-2026-004 was emailed." />
                <fpc-toast variant="warning" title="Quota" message="80% of the monthly quota is used." />
            </fpc-toast-container>
        </div>`,
  }),
};

export default meta;

type Story = StoryObj<FpcToastContainerComponent>;

export const BottomEnd: Story = {};

export const TopCenter: Story = { args: { placement: 'top-center' } };

export const TopEnd: Story = { args: { placement: 'top-end' } };
