import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';
import { action } from 'storybook/actions';

import { FpcFormControlComponent } from './form-control.component';

/** Storybook does not derive the implicit `Change` output of `model()` inputs, so it is declared here. */
type FormControlStoryArgs = FpcFormControlComponent & { valueChange: (value: string) => void };

const meta: Meta<FormControlStoryArgs> = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** Text inputs, selects, and textareas with CVA / \`ngModel\` in Decabill and Agenstra forms.

**Pairs with:** \`fpc-form-field\`, \`fpc-input-group\` (host is the flex item inside input groups).

**When not to:** Complex multi-select with \`compareWith\` / \`[ngValue]\` — keep native selects when needed.`,
      },
    },
  },

  title: 'Forms/Form Control',
  component: FpcFormControlComponent,
  decorators: [moduleMetadata({ imports: [FpcFormControlComponent] })],
  argTypes: {
    controlType: { control: 'inline-radio', options: ['input', 'select', 'textarea'] },
    size: { control: 'inline-radio', options: ['sm', 'md', 'lg', 'xl'] },
  },
  args: {
    controlType: 'input',
    size: 'md',
    disabled: false,
    invalid: false,
    value: '',
    placeholder: 'Type something',
    valueChange: action('valueChange'),
  },
  render: (args) => ({
    props: args,
    template: `<fpc-form-control
            [controlType]="controlType"
            [size]="size"
            [disabled]="disabled"
            [invalid]="invalid"
            [placeholder]="placeholder"
            [value]="value"
            (valueChange)="valueChange($event)"
        />`,
  }),
};

export default meta;

type Story = StoryObj<FormControlStoryArgs>;

export const Input: Story = {};

export const Textarea: Story = { args: { controlType: 'textarea', value: 'Multi-line content' } };

export const Select: Story = {
  render: (args) => ({
    props: args,
    template: `<fpc-form-control controlType="select" [size]="size" [value]="value">
            <option value="">Choose…</option>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
        </fpc-form-control>`,
  }),
  args: { value: 'draft' },
};

export const Invalid: Story = { args: { invalid: true, value: 'not-an-email' } };

export const Disabled: Story = { args: { disabled: true, value: 'Read only' } };

export const NumberWithConstraints: Story = {
  args: {
    inputType: 'number',
    placeholder: '0',
    min: 0,
    max: 100,
    step: 1,
    value: '10',
  },
  render: (args) => ({
    props: args,
    template: `<fpc-form-control
            inputType="number"
            [min]="min"
            [max]="max"
            [step]="step"
            [placeholder]="placeholder"
            [value]="value"
            (valueChange)="valueChange($event)"
        />`,
  }),
};

export const ControlClass: Story = {
  args: {
    controlClass: 'font-monospace',
    placeholder: 'abc123',
    value: 'token_value',
  },
};

export const Sizes: Story = {
  render: () => ({
    template: `<div class="d-flex flex-column gap-2">
            <fpc-form-control size="sm" placeholder="Small" />
            <fpc-form-control size="md" placeholder="Medium" />
            <fpc-form-control size="lg" placeholder="Large" />
        </div>`,
  }),
};
