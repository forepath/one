import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';

import { FpcIconComponent } from './icon.component';

const meta: Meta<FpcIconComponent> = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** Bootstrap Icons by short \`name\` (without \`bi-\`) when you want a typed wrapper.

**When not to:** Prefer raw \`<i class="bi …">\` inside \`fpc-button\` \`iconOnly\` content when that is already the local pattern.`,
      },
    },
  },

  title: 'Data Display/Icon',
  component: FpcIconComponent,
  decorators: [moduleMetadata({ imports: [FpcIconComponent] })],
  argTypes: {
    size: { control: 'inline-radio', options: ['inherit', 'sm', 'md', 'lg', 'xl'] },
  },
  args: { name: 'rocket-takeoff', size: 'lg', ariaLabel: null, ariaHidden: null },
  render: (args) => ({
    props: args,
    template: `<fpc-icon [name]="name" [size]="size" [ariaLabel]="ariaLabel" [ariaHidden]="ariaHidden" />`,
  }),
};

export default meta;

type Story = StoryObj<FpcIconComponent>;

export const Decorative: Story = {};

export const Labelled: Story = {
  args: { name: 'exclamation-triangle', ariaLabel: 'Warning' },
};

export const Sizes: Story = {
  render: () => ({
    template: `<div class="d-flex align-items-center gap-3">
            <fpc-icon name="gear" size="sm" />
            <fpc-icon name="gear" size="md" />
            <fpc-icon name="gear" size="lg" />
            <fpc-icon name="gear" size="xl" />
        </div>`,
  }),
};

export const InheritsTextSize: Story = {
  render: () => ({
    template: `<p class="fs-3 mb-0">
            Inline <fpc-icon name="stars" /> icon that follows the surrounding font size.
        </p>`,
  }),
};
