import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';

import { FpcFormControlComponent } from '../form-control/form-control.component';
import { FpcFormFieldComponent } from './form-field.component';

const meta: Meta<FpcFormFieldComponent> = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** Label + control + hint/error wrapper for console forms.

**Pairs with:** Project \`fpc-form-control\` (or native control) as default content; optional \`[fpcFormFieldHint]\` / \`[fpcFormFieldError]\` slots.`,
      },
    },
  },

  title: 'Forms/Form Field',
  component: FpcFormFieldComponent,
  decorators: [moduleMetadata({ imports: [FpcFormFieldComponent, FpcFormControlComponent] })],
  args: {
    label: 'Email address',
    forId: 'form-field-email',
    required: true,
    hint: 'We only use this for billing notifications.',
    error: null,
  },
  render: (args) => ({
    props: args,
    template: `<fpc-form-field [label]="label" [forId]="forId" [required]="required" [hint]="hint" [error]="error">
            <fpc-form-control controlId="form-field-email" inputType="email" placeholder="name@example.com" />
        </fpc-form-field>`,
  }),
};

export default meta;

type Story = StoryObj<FpcFormFieldComponent>;

export const WithHint: Story = {};

export const WithError: Story = {
  args: { error: 'Enter a valid email address.' },
  render: (args) => ({
    props: args,
    template: `<fpc-form-field [label]="label" [forId]="forId" [required]="required" [hint]="hint" [error]="error">
            <fpc-form-control controlId="form-field-email" inputType="email" [invalid]="true" value="not-an-email" />
        </fpc-form-field>`,
  }),
};

export const ProjectedSlots: Story = {
  render: () => ({
    template: `<fpc-form-field label="API token" forId="form-field-token">
            <fpc-form-control controlId="form-field-token" placeholder="fp_…" />
            <span fpcFormFieldHint>Read the <a href="#">token guide</a> before rotating.</span>
        </fpc-form-field>`,
  }),
};
