import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';

import { FpcLoadingOverlayComponent } from './loading-overlay.component';

const meta: Meta<FpcLoadingOverlayComponent> = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** Fullscreen/blocking wait states while critical work runs.

**Pairs with:** \`fpc-spinner\`.`,
      },
    },
  },

  title: 'Feedback/Loading Overlay',
  component: FpcLoadingOverlayComponent,
  decorators: [moduleMetadata({ imports: [FpcLoadingOverlayComponent] })],
  args: { loading: true, message: 'Loading invoices…', dim: true, spinnerSize: 'md' },
  render: (args) => ({
    props: args,
    template: `<div class="position-relative border rounded p-3" style="height: 14rem">
            <p>Behind the overlay: the list stays mounted so scroll positions survive.</p>
            <ul><li>INV-2026-001</li><li>INV-2026-002</li><li>INV-2026-003</li></ul>
            <fpc-loading-overlay
                [loading]="loading"
                [message]="message"
                [dim]="dim"
                [spinnerSize]="spinnerSize"
            />
        </div>`,
  }),
};

export default meta;

type Story = StoryObj<FpcLoadingOverlayComponent>;

export const Loading: Story = {};

export const Transparent: Story = { args: { dim: false } };

export const WithoutMessage: Story = { args: { message: null } };

export const Idle: Story = { args: { loading: false } };
