import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';

import { FpcSectionColumnComponent } from '../section-column/section-column.component';
import { FpcSectionRowComponent } from './section-row.component';

const meta: Meta<FpcSectionRowComponent> = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** Horizontal page rows (\`nowrap\` for dense toolbars, \`stacked\` for sidebar + detail).

**Pairs with:** \`fpc-section-column\`.`,
      },
    },
  },

  title: 'Layout/Section Row',
  component: FpcSectionRowComponent,
  decorators: [moduleMetadata({ imports: [FpcSectionRowComponent, FpcSectionColumnComponent] })],
  args: { nowrap: false },
  render: (args) => ({
    props: args,
    template: `<div style="height: 12rem" class="border rounded">
            <fpc-section-row [nowrap]="nowrap">
                <fpc-section-column class="border-end p-3">Column A</fpc-section-column>
                <fpc-section-column class="border-end p-3">Column B</fpc-section-column>
                <fpc-section-column class="p-3">Column C</fpc-section-column>
            </fpc-section-row>
        </div>`,
  }),
};

export default meta;

type Story = StoryObj<FpcSectionRowComponent>;

export const Wrapping: Story = {};

export const NoWrap: Story = { args: { nowrap: true } };

/** Sign-in layout: the form column on the auth pages' contour field, the form on its card. */
export const SignIn: Story = {
  parameters: { layout: 'fullscreen' },
  render: (args) => ({
    props: args,
    template: `<div style="height: 100vh" class="d-flex">
            <fpc-section-row [nowrap]="nowrap">
                <fpc-section-column variant="form" [scroll]="true" class="d-flex align-items-center">
                    <div class="p-4 my-auto" style="width: 500px; max-width: 100%">
                        <h2 class="section__column-title mb-4">Login</h2>
                        <p class="mb-0 text-body-secondary">The sign-in form goes here.</p>
                    </div>
                </fpc-section-column>
            </fpc-section-row>
        </div>`,
  }),
};
