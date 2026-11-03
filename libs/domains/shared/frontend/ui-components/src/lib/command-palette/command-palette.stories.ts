import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';
import { FpcCommandPaletteComponent } from './command-palette.component';

const meta: Meta = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** The Ctrl / ⌘ K shell: a query field and grouped results with keyboard navigation; the consumer owns the data (listens to \`query\`, passes \`groups\`).`,
      },
    },
  },
  title: 'Overlays/Command Palette',
  decorators: [moduleMetadata({ imports: [FpcCommandPaletteComponent] })],
  render: () => ({
    props: {
      groups: [
        { id: 'nodes', label: 'Nodes', items: [{ id: 'n1', label: 'n1', hint: 'eu-central', icon: 'hdd-network' }] },
        { id: 'tabs', label: 'Go to tab', items: [{ id: 'logs', label: 'Logs', badge: 'Tab' }] },
      ],
    },
    template: `<fpc-command-palette [open]="true" [groups]="groups">
  <span fpcCommandPaletteFooter>↑ ↓ to move, Enter to open</span>
</fpc-command-palette>`,
  }),
};

export default meta;

export const Default: StoryObj = {};
