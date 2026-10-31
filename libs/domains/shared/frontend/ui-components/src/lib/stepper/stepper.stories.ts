import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';
import { FpcStepperComponent } from './stepper.component';

const meta: Meta = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** Create wizards (linear steps with Back / Next / Finish, invalid steps block moving on); extra footer actions via \`[fpcStepperActions]\` (e.g. "Edit as YAML").`,
      },
    },
  },
  title: 'Navigation/Stepper',
  decorators: [moduleMetadata({ imports: [FpcStepperComponent] })],
  render: () => ({
    props: {
      steps: [
        { id: 'general', label: 'General' },
        { id: 'source', label: 'Source image' },
        { id: 'hardware', label: 'Hardware' },
        { id: 'placement', label: 'Placement', optional: true },
        { id: 'review', label: 'Review' },
      ],
    },
    template: `<div style="height: 320px; border: 1px solid var(--bs-border-color)">
  <fpc-stepper [steps]="steps" finishLabel="Add to draft">
    <p>Step content</p>
    <button fpcStepperActions type="button" class="btn btn-sm btn-link">Edit as YAML</button>
  </fpc-stepper>
</div>`,
  }),
};

export default meta;

export const Default: StoryObj = {};
