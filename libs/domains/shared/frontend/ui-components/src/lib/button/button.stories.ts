import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';
import { action } from 'storybook/actions';

import { FpcButtonComponent } from './button.component';

const meta: Meta<FpcButtonComponent> = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** Primary actions in consoles (forms, modals, toolbars, lists) and landing CTAs (\`size="xl"\` + \`btnClass="rounded-3"\`).

**When not to:** Prefer host \`routerLink\` / \`queryParams\` on \`fpc-button\` for in-app navigation (parent imports \`RouterLink\`; the button activates it from the inner control). Use \`href\` for external URLs (activation navigates; \`target="_blank"\` opens a new tab).

**Pairs with:** \`fpc-modal\` footers, \`fpc-input-group\` suffixes, empty-state CTAs, landing heroes / \`#cta\` bands (\`size="xl"\` auto-applies darkened primary in \`#cta\`/\`#fit\` and soft dark in \`#hero\`).`,
      },
    },
  },

  title: 'Actions/Button',
  component: FpcButtonComponent,
  decorators: [moduleMetadata({ imports: [FpcButtonComponent] })],
  argTypes: {
    variant: {
      control: 'select',
      options: [
        'primary',
        'secondary',
        'success',
        'danger',
        'warning',
        'info',
        'light',
        'dark',
        'link',
        'outline-primary',
        'outline-secondary',
        'outline-success',
        'outline-danger',
        'outline-warning',
        'outline-info',
        'outline-light',
        'outline-dark',
      ],
    },
    size: { control: 'inline-radio', options: ['xs', 'sm', 'md', 'lg', 'xl'] },
    type: { control: 'inline-radio', options: ['button', 'submit', 'reset'] },
  },
  args: {
    variant: 'primary',
    size: 'md',
    type: 'button',
    disabled: false,
    loading: false,
    iconOnly: false,
    block: false,
    clicked: action('clicked'),
  },
  render: (args) => ({
    props: args,
    template: `<fpc-button
            [variant]="variant"
            [size]="size"
            [type]="type"
            [disabled]="disabled"
            [loading]="loading"
            [iconOnly]="iconOnly"
            [block]="block"
            (clicked)="clicked($event)"
        >Save changes</fpc-button>`,
  }),
};

export default meta;

type Story = StoryObj<FpcButtonComponent>;

export const Primary: Story = {};

export const Secondary: Story = { args: { variant: 'secondary' } };

export const Outline: Story = { args: { variant: 'primary' } };

export const Danger: Story = { args: { variant: 'danger' } };

export const Success: Story = { args: { variant: 'success' } };

export const Link: Story = { args: { variant: 'link' } };

export const Loading: Story = { args: { loading: true } };

export const Disabled: Story = { args: { disabled: true } };

export const Block: Story = { args: { block: true } };

export const Sizes: Story = {
  render: () => ({
    template: `<div class="d-flex align-items-center gap-2 flex-wrap">
            <fpc-button size="xs">Extra small</fpc-button>
            <fpc-button size="sm">Small</fpc-button>
            <fpc-button size="md">Medium</fpc-button>
            <fpc-button size="lg">Large</fpc-button>
            <fpc-button size="xl" btnClass="rounded-3">CTA xl</fpc-button>
        </div>`,
  }),
};

export const MarketingCta: Story = {
  args: { size: 'xl', btnClass: 'rounded-3' },
  render: (args) => ({
    props: args,
    template: `<fpc-button [variant]="variant" [size]="size" [btnClass]="btnClass">
            <i class="bi bi-rocket-takeoff" aria-hidden="true"></i>Get Started Free
        </fpc-button>`,
  }),
};

export const MarketingCtaBand: Story = {
  render: () => ({
    template: `<section id="cta" class="p-4 bg-primary rounded-3">
            <div class="d-flex gap-3 flex-wrap">
                <fpc-button variant="primary" size="xl" btnClass="rounded-3">
                    <i class="bi bi-rocket-takeoff" aria-hidden="true"></i>Get started
                </fpc-button>
                <fpc-button variant="primary" size="xl" btnClass="rounded-3">Talk to the team</fpc-button>
            </div>
        </section>`,
  }),
};

export const MarketingCtaHeroDark: Story = {
  render: () => ({
    template: `<section id="hero" class="p-4 bg-dark rounded-3">
            <div class="d-flex gap-3 flex-wrap">
                <fpc-button variant="primary" size="xl" btnClass="rounded-3">Get started</fpc-button>
                <fpc-button variant="dark" size="xl" btnClass="rounded-3">View tour</fpc-button>
            </div>
        </section>`,
  }),
};

export const IconOnly: Story = {
  render: () => ({
    template: `<div class="d-flex align-items-center gap-2">
            <fpc-button [iconOnly]="true" ariaLabel="Refresh"><i class="bi bi-arrow-repeat"></i></fpc-button>
            <fpc-button [iconOnly]="true" size="sm" variant="secondary" ariaLabel="Edit">
                <i class="bi bi-pencil"></i>
            </fpc-button>
            <fpc-button [iconOnly]="true" size="xs" variant="danger" ariaLabel="Delete">
                <i class="bi bi-trash"></i>
            </fpc-button>
        </div>`,
  }),
};

export const AsLink: Story = {
  render: () => ({
    template: `<div class="d-flex align-items-center gap-2">
            <fpc-button href="#primary" variant="primary" size="sm">Primary link</fpc-button>
            <fpc-button href="#outline" variant="secondary" size="sm">Secondary link</fpc-button>
            <fpc-button href="#disabled" variant="primary" size="sm" disabled>Disabled link</fpc-button>
        </div>`,
  }),
};
