import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';

import { FpcButtonComponent } from '../button/button.component';
import { FpcButtonGroupComponent } from './button-group.component';

const meta: Meta<FpcButtonGroupComponent> = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** Related toolbar actions (icon clusters, start/stop, tree row hover actions).

**Pairs with:** \`fpc-button\` (usually \`size="sm"\` + \`iconOnly\`).

**When not to:** Segmented equal-width tabs → \`fpc-tab-group\`. Prefix/suffix around a field → \`fpc-input-group\`.

Unlike Bootstrap \`btn-group\`, buttons keep their own borders and sit with a slight gap (\`size\` picks the default; \`gap\` overrides).`,
      },
    },
  },

  title: 'Actions/Button Group',
  component: FpcButtonGroupComponent,
  decorators: [moduleMetadata({ imports: [FpcButtonGroupComponent, FpcButtonComponent] })],
  argTypes: {
    size: { control: 'inline-radio', options: ['sm', 'md', 'lg'] },
    gap: { control: 'inline-radio', options: ['xs', 'sm', 'md', 'lg', null] },
  },
  args: { size: 'sm', gap: null, ariaLabel: 'Panel visibility' },
  render: (args) => ({
    props: args,
    template: `<fpc-button-group [size]="size" [gap]="gap" [ariaLabel]="ariaLabel">
            <fpc-button variant="primary" size="sm" iconOnly ariaLabel="Files">
                <i class="bi bi-folder" aria-hidden="true"></i>
            </fpc-button>
            <fpc-button variant="primary" size="sm" iconOnly ariaLabel="Chat">
                <i class="bi bi-chat-dots" aria-hidden="true"></i>
            </fpc-button>
            <fpc-button variant="primary" size="sm" iconOnly ariaLabel="Terminal">
                <i class="bi bi-terminal" aria-hidden="true"></i>
            </fpc-button>
        </fpc-button-group>`,
  }),
};

export default meta;

type Story = StoryObj<FpcButtonGroupComponent>;

export const Small: Story = {};

export const Medium: Story = { args: { size: 'md' } };

export const Large: Story = { args: { size: 'lg' } };

export const GapOverride: Story = {
  args: { size: 'sm', gap: 'lg' },
};

export const MixedActions: Story = {
  args: { size: 'sm', ariaLabel: 'Server actions' },
  render: (args) => ({
    props: args,
    template: `<fpc-button-group [size]="size" [ariaLabel]="ariaLabel">
            <fpc-button variant="success" size="sm" iconOnly ariaLabel="Start">
                <i class="bi bi-play-fill" aria-hidden="true"></i>
            </fpc-button>
            <fpc-button variant="danger" size="sm" iconOnly ariaLabel="Stop">
                <i class="bi bi-stop-fill" aria-hidden="true"></i>
            </fpc-button>
            <fpc-button variant="warning" size="sm" iconOnly ariaLabel="Restart">
                <i class="bi bi-arrow-clockwise" aria-hidden="true"></i>
            </fpc-button>
        </fpc-button-group>`,
  }),
};
