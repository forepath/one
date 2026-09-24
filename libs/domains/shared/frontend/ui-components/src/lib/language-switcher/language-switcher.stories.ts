import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';
import { action } from 'storybook/actions';

import { FpcLanguageSwitcherComponent } from './language-switcher.component';

const locales = [
  { code: 'de', label: 'Deutsch' },
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
];

/** Storybook does not derive the implicit `Change` output of `model()` inputs, so it is declared here. */
type LanguageSwitcherStoryArgs = FpcLanguageSwitcherComponent & { localeChange: (value: string | null) => void };

const meta: Meta<LanguageSwitcherStoryArgs> = {
  parameters: {
    backgrounds: { default: 'dark' },
    docs: {
      description: {
        component: `**When to use:** Locale dropdown in console top bars (\`appearance="default"\`: icon + code) or landing footers (\`appearance="footer"\`: soft dark chip + Language label + dropup). Optional \`href\` on locale options for full-page switches.

**Pairs with:** \`fpc-dropdown\` / shell i18n wiring.`,
      },
    },
  },
  title: 'Navigation/Language Switcher',
  component: FpcLanguageSwitcherComponent,
  decorators: [moduleMetadata({ imports: [FpcLanguageSwitcherComponent] })],
  argTypes: {
    size: { control: 'inline-radio', options: ['sm', 'md', 'lg'] },
    appearance: { control: 'inline-radio', options: ['default', 'footer'] },
  },
  args: {
    locales,
    locale: 'de',
    size: 'sm',
    appearance: 'default',
    disabled: false,
    showIcon: true,
    localeChange: action('localeChange'),
  },
  render: (args) => ({
    props: args,
    template: `<div [attr.data-bs-theme]="appearance === 'footer' ? null : 'dark'" [class]="appearance === 'footer' ? 'p-3' : 'p-3 bg-dark'">
            <fpc-language-switcher
                [locales]="locales"
                [locale]="locale"
                [size]="size"
                [appearance]="appearance"
                [disabled]="disabled"
                [showIcon]="showIcon"
                triggerLabel="Language"
                (localeChange)="localeChange($event)"
            />
        </div>`,
  }),
};

export default meta;

type Story = StoryObj<LanguageSwitcherStoryArgs>;

export const German: Story = {};

export const English: Story = { args: { locale: 'en' } };

export const WithoutIcon: Story = { args: { showIcon: false } };

export const Disabled: Story = { args: { disabled: true } };

export const Footer: Story = {
  args: {
    appearance: 'footer',
    locales: [
      { code: 'de', label: 'Deutsch', href: '/de/' },
      { code: 'en', label: 'English', href: '/en/' },
    ],
  },
  parameters: { backgrounds: { default: 'light' } },
};
