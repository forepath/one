import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';
import { action } from 'storybook/actions';

import { FpcThemeSwitcherComponent } from './theme-switcher.component';

/** Storybook does not derive the implicit `Change` output of `model()` inputs, so it is declared here. */
type ThemeSwitcherStoryArgs = FpcThemeSwitcherComponent & { darkChange: (value: boolean) => void };

const meta: Meta<ThemeSwitcherStoryArgs> = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** Light/dark toggle in console chrome (\`data-bs-theme\` on document when \`applyToDocument\`).

**Pairs with:** App \`ThemeService\` persistence.`,
      },
    },
  },

  title: 'Navigation/Theme Switcher',
  component: FpcThemeSwitcherComponent,
  decorators: [moduleMetadata({ imports: [FpcThemeSwitcherComponent] })],
  argTypes: {
    variant: { control: 'inline-radio', options: ['switch', 'button'] },
  },
  args: { dark: false, variant: 'switch', applyToDocument: false, darkChange: action('darkChange') },
  render: (args) => ({
    props: args,
    template: `<fpc-theme-switcher
            [dark]="dark"
            [variant]="variant"
            [applyToDocument]="applyToDocument"
            (darkChange)="darkChange($event)"
        />`,
  }),
};

export default meta;

type Story = StoryObj<ThemeSwitcherStoryArgs>;

export const LightMode: Story = {};

export const DarkMode: Story = { args: { dark: true } };

export const ButtonVariant: Story = { args: { variant: 'button' } };

export const AppliesThemeToDocument: Story = { args: { applyToDocument: true } };
