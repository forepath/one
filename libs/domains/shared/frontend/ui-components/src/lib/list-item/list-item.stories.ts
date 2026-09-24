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

**Pairs with:** \`fpc-list\`, \`fpc-button\`.`,
      },
    },
  },

  title: 'Data Display/List Item',
  component: FpcListItemComponent,
  decorators: [moduleMetadata({ imports: [FpcListItemComponent, FpcButtonComponent] })],
  args: { active: false, disabled: false, clickable: true, selected: action('selected') },
  render: (args) => ({
    props: args,
    template: `<div class="list-group">
            <fpc-list-item
                [active]="active"
                [disabled]="disabled"
                [clickable]="clickable"
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

export const TitleOnly: Story = {
  render: () => ({
    template: `<div class="list-group">
            <fpc-list-item><span fpcListItemTitle>Just a title</span></fpc-list-item>
        </div>`,
  }),
};
