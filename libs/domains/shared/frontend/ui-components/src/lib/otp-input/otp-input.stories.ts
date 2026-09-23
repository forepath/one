import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';

import { FpcOtpInputComponent } from './otp-input.component';

const meta: Meta<FpcOtpInputComponent> = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** Fixed-length OTP entry (identity auth flows).

**When not to:** Generic multi-field forms → separate \`fpc-form-control\`s.`,
      },
    },
  },

  title: 'Forms/OTP Input',
  component: FpcOtpInputComponent,
  decorators: [moduleMetadata({ imports: [FpcOtpInputComponent] })],
  args: { length: 6, invalid: false, disabled: false },
  render: (args) => ({
    props: args,
    template: `<fpc-otp-input [length]="length" [invalid]="invalid" [disabled]="disabled" />`,
  }),
};

export default meta;

type Story = StoryObj<FpcOtpInputComponent>;

export const Default: Story = {};

export const Invalid: Story = { args: { invalid: true } };

export const Disabled: Story = { args: { disabled: true } };

export const FourDigits: Story = { args: { length: 4 } };
