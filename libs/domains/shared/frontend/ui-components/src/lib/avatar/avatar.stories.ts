import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';

import { FpcAvatarComponent } from './avatar.component';

const meta: Meta<FpcAvatarComponent> = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** User or tenant identity (image or initials) in headers, lists, and comments.

**Pairs with:** \`fpc-list-item\`, \`fpc-top-bar\` meta.`,
      },
    },
  },

  title: 'Data Display/Avatar',
  component: FpcAvatarComponent,
  decorators: [moduleMetadata({ imports: [FpcAvatarComponent] })],
  argTypes: {
    size: { control: 'inline-radio', options: ['xs', 'sm', 'md', 'lg', 'xl'] },
  },
  args: { src: null, initials: 'MM', size: 'md', alt: 'Marcel Menk' },
  render: (args) => ({
    props: args,
    template: `<fpc-avatar [src]="src" [initials]="initials" [size]="size" [alt]="alt" />`,
  }),
};

export default meta;

type Story = StoryObj<FpcAvatarComponent>;

export const Initials: Story = {};

export const Image: Story = {
  args: { src: 'https://placehold.co/96x96/0d6efd/ffffff?text=FP', alt: 'ForePath' },
};

export const BrokenImageFallsBackToInitials: Story = {
  args: { src: 'https://example.invalid/missing.png', initials: 'FP', alt: 'ForePath' },
};

export const InitialsDerivedFromAlt: Story = {
  args: { initials: '', alt: 'Ada Lovelace' },
};

export const Sizes: Story = {
  render: () => ({
    template: `<div class="d-flex align-items-center gap-2">
            <fpc-avatar size="xs" initials="XS" alt="Extra small" />
            <fpc-avatar size="sm" initials="SM" alt="Small" />
            <fpc-avatar size="md" initials="MD" alt="Medium" />
            <fpc-avatar size="lg" initials="LG" alt="Large" />
            <fpc-avatar size="xl" initials="XL" alt="Extra large" />
        </div>`,
  }),
};
