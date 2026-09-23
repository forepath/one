import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';
import { action } from 'storybook/actions';

import { FpcBadgeComponent } from '../badge/badge.component';
import { FpcTypeaheadSelectComponent } from './typeahead-select.component';

/** Storybook does not derive the implicit `Change` outputs of `model()` inputs, so they are declared here. */
type TypeaheadStoryArgs = FpcTypeaheadSelectComponent & {
  queryChange: (value: string) => void;
  openChange: (value: boolean) => void;
};

const meta: Meta<TypeaheadStoryArgs> = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** Combobox chrome: input + suggestions + selected chip patterns in consoles.

**Variants:** \`menu\` (default) — floating suggestion menu, \`position: fixed\` and portaled to \`document.body\` so modal overflow / dialog transforms cannot clip results. \`inline\` — results list in document flow under the input (modal search panels).

**Behavior:** While \`loading\` is true, the results host stays hidden so empty-state copy and an empty bordered panel cannot flash before the first response.

**When not to:** Plain free-text search → \`fpc-search-field\`.`,
      },
    },
  },

  title: 'Forms/Typeahead Select',
  component: FpcTypeaheadSelectComponent,
  decorators: [moduleMetadata({ imports: [FpcTypeaheadSelectComponent, FpcBadgeComponent] })],
  args: {
    query: 'ma',
    open: true,
    placeholder: 'Search people',
    disabled: false,
    loading: false,
    clearable: true,
    variant: 'menu',
    queryChange: action('queryChange'),
    openChange: action('openChange'),
    cleared: action('cleared'),
  },
  render: (args) => ({
    props: args,
    template: `<fpc-typeahead-select
            [query]="query"
            [open]="open"
            [placeholder]="placeholder"
            [disabled]="disabled"
            [loading]="loading"
            [clearable]="clearable"
            [variant]="variant"
            (queryChange)="queryChange($event)"
            (openChange)="openChange($event)"
            (cleared)="cleared()"
        >
            <button type="button" class="dropdown-item" fpcTypeaheadSuggestions>Marcel Menk</button>
        </fpc-typeahead-select>`,
  }),
};

export default meta;

type Story = StoryObj<TypeaheadStoryArgs>;

export const Open: Story = {};

export const Closed: Story = { args: { open: false } };

export const Loading: Story = { args: { loading: true } };

export const Inline: Story = {
  args: {
    variant: 'inline',
    query: 'ticket',
    open: true,
  },
  render: (args) => ({
    props: args,
    template: `<fpc-typeahead-select
            [query]="query"
            [open]="open"
            [placeholder]="placeholder"
            [loading]="loading"
            [clearable]="clearable"
            variant="inline"
            (queryChange)="queryChange($event)"
            (openChange)="openChange($event)"
            (cleared)="cleared()"
        >
            <div fpcTypeaheadSuggestions>
                <button type="button" class="dropdown-item py-2 text-start">
                    <span class="d-flex gap-2"><span class="font-monospace text-muted small">a1b2</span><span>Fix login redirect</span></span>
                </button>
                <button type="button" class="dropdown-item py-2 text-start">
                    <span class="d-flex gap-2"><span class="font-monospace text-muted small">c3d4</span><span>Update billing invoice PDF</span></span>
                </button>
            </div>
        </fpc-typeahead-select>`,
  }),
};

export const WithSelectionChips: Story = {
  render: (args) => ({
    props: args,
    template: `<fpc-typeahead-select [query]="query" [open]="open">
            <div fpcTypeaheadSelection class="d-flex gap-1">
                <fpc-badge color="secondary" class="d-inline-flex align-items-center gap-1">
                    Marcel Menk
                    <button type="button" class="btn-close btn-close-white btn-sm" aria-label="Remove"></button>
                </fpc-badge>
                <fpc-badge color="secondary" class="d-inline-flex align-items-center gap-1">
                    Ada Lovelace
                    <button type="button" class="btn-close btn-close-white btn-sm" aria-label="Remove"></button>
                </fpc-badge>
            </div>
            <div fpcTypeaheadSuggestions>
                <button type="button" class="dropdown-item">Marie Curie</button>
                <button type="button" class="dropdown-item">Alan Turing</button>
                <button type="button" class="dropdown-item">Grace Hopper</button>
            </div>
        </fpc-typeahead-select>`,
  }),
};
