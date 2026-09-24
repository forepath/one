import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';

import { FpcButtonComponent } from '../button/button.component';
import { FpcLaneHeaderComponent } from './lane-header.component';

const meta: Meta<FpcLaneHeaderComponent> = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** Card/lane subheaders (\`py-2 small fw-semibold\`); visibility breakpoints for compact boards.

**Pairs with:** \`fpc-board-lane\`.`,
      },
    },
  },

  title: 'Layout/Lane Header',
  component: FpcLaneHeaderComponent,
  decorators: [
    moduleMetadata({
      imports: [FpcLaneHeaderComponent, FpcButtonComponent],
    }),
  ],
  args: {
    title: 'Cloud instances',
    visibility: 'always',
    flush: true,
  },
  render: (args) => ({
    props: args,
    template: `<div class="card border-0" style="max-width: 22rem">
            <fpc-lane-header [title]="title" [visibility]="visibility" [flush]="flush">
                <fpc-button fpcLaneHeaderActions variant="primary" size="sm" iconOnly ariaLabel="Add">
                    <i class="bi bi-plus" aria-hidden="true"></i>
                </fpc-button>
            </fpc-lane-header>
            <div class="card-body small text-body-secondary">Lane body</div>
        </div>`,
  }),
};

export default meta;

type Story = StoryObj<FpcLaneHeaderComponent>;

export const WithActions: Story = {};

export const TitleOnly: Story = {
  render: (args) => ({
    props: args,
    template: `<div class="card border-0" style="max-width: 22rem">
            <fpc-lane-header [title]="title" [flush]="flush" />
            <div class="card-body small text-body-secondary">Same bar height as WithActions</div>
        </div>`,
  }),
};

export const MdUpOnly: Story = {
  args: { visibility: 'md-up', title: 'Invoices' },
};
