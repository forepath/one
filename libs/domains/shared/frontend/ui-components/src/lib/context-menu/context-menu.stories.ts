import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';
import { FpcContextMenuComponent } from './context-menu.component';

const meta: Meta = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** Right-click / long-press menus on rows, tree nodes and canvas elements (fixed, clamped to the viewport, keyboard navigable). Long press: \`fpcLongPress\` directive.`,
      },
    },
  },
  title: 'Overlays/Context Menu',
  decorators: [moduleMetadata({ imports: [FpcContextMenuComponent] })],
  render: () => ({
    props: {
      items: [
        { id: 'open', label: 'Open', icon: 'box-arrow-up-right' },
        { id: 'drain', label: 'Drain', disabled: true, title: 'Needs cluster admin' },
        { id: 'delete', label: 'Delete', icon: 'trash', danger: true, dividerBefore: true },
      ],
    },
    template: `<fpc-context-menu [items]="items" [position]="{ x: 40, y: 40 }" />`,
  }),
};

export default meta;

export const Default: StoryObj = {};
