import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';

import { FpcBadgeComponent } from '../badge/badge.component';
import { FpcButtonComponent } from '../button/button.component';
import { FpcTopBarComponent } from './top-bar.component';

/** Storybook Color set → console light mark (white glyph on `bg-primary`). */
const BRAND_MARKS: Record<string, { src: string; alt: string }> = {
  bootstrap: { src: '/assets/images/brands/bootstrap.svg', alt: 'Bootstrap' },
  decabill: { src: '/assets/images/brands/decabill.svg', alt: 'Decabill' },
  agenstra: { src: '/assets/images/brands/agenstra.svg', alt: 'Agenstra' },
  forepath: { src: '/assets/images/brands/forepath.svg', alt: 'ForePath' },
};

function brandMarkForColorSet(colorSet: unknown): { src: string; alt: string } {
  const key = String(colorSet ?? 'bootstrap');
  return BRAND_MARKS[key] ?? BRAND_MARKS['bootstrap'];
}

const meta: Meta<FpcTopBarComponent> = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** Dark product top bar (brand + actions); \`compact\` for no-brand strips; meta chips use \`fpc-top-bar__chip\`; icon/link actions use \`fpc-top-bar__action\` (fixed light chrome on the dark bar).

**When not to:** Landing/marketing navbars (out of FPC scope).

The Default story logo follows the toolbar **Color set** (Bootstrap / Decabill / Agenstra / ForePath).`,
      },
    },
  },

  title: 'Navigation/Top Bar',
  component: FpcTopBarComponent,
  decorators: [moduleMetadata({ imports: [FpcTopBarComponent, FpcBadgeComponent, FpcButtonComponent] })],
  argTypes: {
    brandSrc: { control: false, table: { disable: true } },
  },
  args: {
    brandAlt: '',
    compact: false,
  },
  render: (args, { globals }) => {
    const mark = brandMarkForColorSet(globals['colorSet']);

    return {
      props: {
        ...args,
        brandSrc: args.compact ? null : mark.src,
        brandAlt: args.brandAlt || mark.alt,
      },
      template: `<fpc-top-bar [brandSrc]="brandSrc" [brandAlt]="brandAlt" [compact]="compact">
            <fpc-badge variant="info" color="secondary" size="sm" class="fpc-top-bar__chip">
              <i class="bi bi-person-badge" aria-hidden="true"></i>
              <span>CUS-000042</span>
            </fpc-badge>
            <fpc-button variant="primary" size="sm">Logout</fpc-button>
        </fpc-top-bar>`,
    };
  },
};

export default meta;

type Story = StoryObj<FpcTopBarComponent>;

export const Default: Story = {};

export const Compact: Story = {
  args: { compact: true },
};
