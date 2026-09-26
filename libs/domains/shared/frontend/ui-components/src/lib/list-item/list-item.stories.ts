import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';
import { action } from 'storybook/actions';

import { FpcButtonComponent } from '../button/button.component';
import { FpcListItemComponent } from './list-item.component';

const meta: Meta<FpcListItemComponent> = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** List rows with title/meta/actions slots.

**Pairs with:** \`fpc-list\`, \`fpc-button\`.

**Variants:** \`condensed\` reduces vertical padding for nested match lists and other dense panels.`,
      },
    },
  },

  title: 'Data Display/List Item',
  component: FpcListItemComponent,
  decorators: [moduleMetadata({ imports: [FpcListItemComponent, FpcButtonComponent] })],
  args: {
    active: false,
    disabled: false,
    clickable: true,
    variant: 'default',
    selected: action('selected'),
  },
  render: (args) => ({
    props: args,
    template: `<div class="list-group">
            <fpc-list-item
                [active]="active"
                [disabled]="disabled"
                [clickable]="clickable"
                [variant]="variant"
                (selected)="selected()"
            >
                <span fpcListItemTitle>Deployment pipeline</span>
                <span fpcListItemMeta>Last run 4 minutes ago</span>
                <fpc-button fpcListItemActions variant="secondary" size="sm">Re-run</fpc-button>
            </fpc-list-item>
        </div>`,
  }),
};

export default meta;

type Story = StoryObj<FpcListItemComponent>;

export const Clickable: Story = {};

export const Active: Story = { args: { active: true } };

export const Disabled: Story = { args: { disabled: true } };

export const Condensed: Story = {
  args: { variant: 'condensed' },
  render: () => ({
    template: `<div class="list-group">
            <fpc-list-item [clickable]="true" variant="condensed">
                <span fpcListItemTitle class="font-monospace small"><span class="text-body-secondary me-1">L12</span>const match = true;</span>
            </fpc-list-item>
            <fpc-list-item [clickable]="true" variant="condensed">
                <span fpcListItemTitle class="font-monospace small"><span class="text-body-secondary me-1">L48</span>return match;</span>
            </fpc-list-item>
        </div>`,
  }),
};

export const TitleOnly: Story = {
  render: () => ({
    template: `<div class="list-group">
            <fpc-list-item><span fpcListItemTitle>Just a title</span></fpc-list-item>
        </div>`,
  }),
};
