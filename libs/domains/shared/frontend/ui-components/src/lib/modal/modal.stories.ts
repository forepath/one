import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';
import { action } from 'storybook/actions';

import { FpcButtonComponent } from '../button/button.component';
import { FpcButtonGroupComponent } from '../button-group/button-group.component';
import { FpcModalFooterDirective } from './modal-footer.directive';
import { FpcModalComponent } from './modal.component';

/** Storybook does not derive the implicit `Change` output of `model()` inputs, so it is declared here. */
type ModalStoryArgs = FpcModalComponent & { openChange: (value: boolean) => void };

const meta: Meta<ModalStoryArgs> = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** Modal shell for create/edit flows. Corner close via \`accent\` (\`primary\` / \`danger\` / \`warning\`) — fill and X ink match \`.btn-{accent}\` colors.

**Pairs with:** \`fpc-button\` in footer slots (\`*fpcModalFooter\` — import \`FpcModalFooterDirective\`); prefer \`fpc-confirm-dialog\` for destructive confirms.

**Note:** Use \`*fpcModalFooter\` (structural) so footers render in \`.modal-footer\` even under multi-root \`@if\`/\`@else\` (avoids NG8011 dumping the footer into the body).`,
      },
    },
  },

  title: 'Overlays/Modal',
  component: FpcModalComponent,
  decorators: [
    moduleMetadata({
      imports: [FpcModalComponent, FpcModalFooterDirective, FpcButtonComponent, FpcButtonGroupComponent],
    }),
  ],
  argTypes: {
    size: { control: 'select', options: ['sm', 'md', 'lg', 'xl', 'fullscreen'] },
    accent: { control: 'inline-radio', options: ['primary', 'danger', 'warning'] },
  },
  args: {
    open: true,
    title: 'Create invoice',
    size: 'md',
    accent: 'primary',
    scrollable: false,
    centered: true,
    closable: true,
    closeOnBackdrop: true,
    closeOnEscape: true,
    openChange: action('openChange'),
    closed: action('closed'),
  },
  render: (args) => ({
    props: args,
    template: `<fpc-modal
            [open]="open"
            [title]="title"
            [size]="size"
            [accent]="accent"
            [scrollable]="scrollable"
            [centered]="centered"
            [closable]="closable"
            [closeOnBackdrop]="closeOnBackdrop"
            [closeOnEscape]="closeOnEscape"
            (openChange)="openChange($event)"
            (closed)="closed()"
        >
            <p class="mb-0">Pick a project and a billing period to generate a draft invoice.</p>
            <div *fpcModalFooter>
                <fpc-button-group>
                    <fpc-button variant="secondary">Cancel</fpc-button>
                    <fpc-button variant="primary">Create</fpc-button>
                </fpc-button-group>
            </div>
        </fpc-modal>`,
  }),
};

export default meta;

type Story = StoryObj<ModalStoryArgs>;

export const Default: Story = {};

export const Large: Story = { args: { size: 'lg' } };

export const Small: Story = { args: { size: 'sm' } };

export const Fullscreen: Story = { args: { size: 'fullscreen' } };

export const NotClosable: Story = { args: { closable: false, closeOnBackdrop: false } };

export const Scrollable: Story = {
  args: { scrollable: true },
  render: (args) => ({
    props: args,
    template: `<fpc-modal [open]="open" [title]="title" [scrollable]="true" size="lg">
            @for (line of [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15]; track line) {
                <p>Line {{ line }} of a long body that needs its own scroll area.</p>
            }
            <div *fpcModalFooter class="d-flex justify-content-end">
                <fpc-button>Close</fpc-button>
            </div>
        </fpc-modal>`,
  }),
};

export const BodyOnly: Story = {
  render: (args) => ({
    props: args,
    template: `<fpc-modal [open]="open" title="Heads up">
            <p class="mb-0">No footer, no actions — just a message.</p>
        </fpc-modal>`,
  }),
};
