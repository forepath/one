import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';

import { FpcBadgeComponent } from './badge.component';

const meta: Meta<FpcBadgeComponent> = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** Compact labels — solid Bootstrap badges, console \`variant="info"\` chips (filters, meta rows; \`size="sm"\` matches \`btn-sm\` / language switcher), or landing \`variant="marketing"\` soft chips (\`size="xl"\` for hero feature rows).

**When not to:** Circular status icon wells → \`fpc-status-badge\`. Do not encode domain status enums inside the badge; pass colour/classes from the feature.`,
      },
    },
  },

  title: 'Data Display/Badge',
  component: FpcBadgeComponent,
  decorators: [moduleMetadata({ imports: [FpcBadgeComponent] })],
  argTypes: {
    variant: { control: 'inline-radio', options: ['badge', 'info', 'marketing'] },
    size: { control: 'inline-radio', options: ['sm', 'md', 'lg', 'xl'] },
    color: {
      control: 'select',
      options: ['primary', 'secondary', 'success', 'danger', 'warning', 'info', 'light', 'dark'],
    },
  },
  args: { variant: 'badge', color: 'primary', size: 'md', pill: false },
  render: (args) => ({
    props: args,
    template: `<fpc-badge [variant]="variant" [color]="color" [size]="size" [pill]="pill">Active</fpc-badge>`,
  }),
};

export default meta;

type Story = StoryObj<FpcBadgeComponent>;

export const Solid: Story = {};

export const Info: Story = { args: { variant: 'info', color: 'secondary' } };

export const InfoControl: Story = {
  args: { variant: 'info', color: 'secondary', size: 'sm' },
  render: (args) => ({
    props: args,
    template: `<fpc-badge [variant]="variant" [color]="color" [size]="size">
            <i class="bi bi-person-badge" aria-hidden="true"></i>
            <span>CUS-000042</span>
        </fpc-badge>`,
  }),
};

export const Marketing: Story = { args: { variant: 'marketing', color: 'secondary' } };

export const MarketingPill: Story = { args: { variant: 'marketing', color: 'light', pill: true } };

export const MarketingHero: Story = {
  args: { variant: 'marketing', color: 'success', size: 'xl' },
  parameters: { backgrounds: { default: 'dark' } },
  render: (args) => ({
    props: args,
    template: `<fpc-badge [variant]="variant" [color]="color" [size]="size">
            <i class="bi bi-check-circle" aria-hidden="true"></i>Multi-workspace control
        </fpc-badge>`,
  }),
};

export const Pill: Story = { args: { pill: true, color: 'success' } };

export const AllColors: Story = {
  render: () => ({
    template: `<div class="d-flex flex-wrap gap-2 align-items-center">
            <fpc-badge color="primary">Primary</fpc-badge>
            <fpc-badge color="secondary">Secondary</fpc-badge>
            <fpc-badge color="success">Success</fpc-badge>
            <fpc-badge color="danger">Danger</fpc-badge>
            <fpc-badge color="warning">Warning</fpc-badge>
            <fpc-badge color="info">Info</fpc-badge>
            <fpc-badge variant="info" color="secondary">Chip secondary</fpc-badge>
            <fpc-badge variant="info" color="danger">Chip danger</fpc-badge>
            <fpc-badge variant="marketing" color="secondary">Marketing soft</fpc-badge>
            <fpc-badge variant="marketing" color="primary" [pill]="true">Marketing pill</fpc-badge>
            <fpc-badge variant="marketing" color="success" size="xl">Hero xl</fpc-badge>
        </div>`,
  }),
};
