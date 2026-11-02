import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';
import { FpcKeyValueListComponent } from './key-value-list.component';

const meta: Meta = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** Label / value facts on Summary tabs and inspectors; rich values via \`<ng-template fpcKeyValue="key">\`.`,
      },
    },
  },
  title: 'Data Display/Key Value List',
  decorators: [moduleMetadata({ imports: [FpcKeyValueListComponent] })],
  render: () => ({
    props: {
      items: [
        { key: 'id', label: 'ID', value: '7c1e…', mono: true },
        { key: 'site', label: 'Site', value: 'eu-central' },
        { key: 'cpu', label: 'CPU', value: '4 cores' },
        { key: 'ip', label: 'Address', value: '10.0.0.12', mono: true, hint: 'mesh' },
      ],
    },
    template: `<fpc-key-value-list [items]="items" [columns]="2" />`,
  }),
};

export default meta;

export const Default: StoryObj = {};
