import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';

import { FpcSectionColumnComponent } from '../section-column/section-column.component';
import { FpcSectionRowComponent } from './section-row.component';

const meta: Meta<FpcSectionRowComponent> = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** Horizontal page rows (\`marketingHidden\`, \`nowrap\` for dense toolbars).

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

/** Sign-in layout: marketing column (wash + brand contour pattern) beside the form column. */
export const MarketingAndForm: Story = {
  parameters: { layout: 'fullscreen' },
  render: (args) => ({
    props: args,
    template: `<div style="height: 100vh" class="d-flex">
            <fpc-section-row [nowrap]="nowrap">
                <fpc-section-column
                    variant="marketing"
                    class="d-flex align-items-center justify-content-center bg-body-tertiary h-100 border-end"
                >
                    <div class="p-4" style="width: 700px; max-width: 100%">
                        <h1 class="display-5 fw-bold mb-3">Product</h1>
                        <p class="lead mb-4">Sign in to manage your workspaces, agents and billing in one place.</p>
                        <ul class="list-unstyled">
                            <li class="mb-2 d-flex align-items-center gap-2 py-2 px-3 rounded-2 border bg-body">
                                <i class="bi bi-check-circle-fill text-primary me-2 fs-5"></i>
                                <div class="d-flex flex-column"><strong>Workspaces</strong><span class="text-body-secondary small">Organise projects and environments.</span></div>
                            </li>
                            <li class="mb-2 d-flex align-items-center gap-2 py-2 px-3 rounded-2 border bg-body">
                                <i class="bi bi-check-circle-fill text-primary me-2 fs-5"></i>
                                <div class="d-flex flex-column"><strong>Automation</strong><span class="text-body-secondary small">Let agents pick up tickets.</span></div>
                            </li>
                        </ul>
                    </div>
                </fpc-section-column>
                <fpc-section-column variant="form" class="d-flex align-items-center p-4">
                    <h2 class="section__column-title">Login</h2>
                </fpc-section-column>
            </fpc-section-row>
        </div>`,
  }),
};
