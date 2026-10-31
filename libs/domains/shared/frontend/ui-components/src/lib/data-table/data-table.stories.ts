import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';
import { FpcButtonComponent } from '../button/button.component';
import { FpcDataTableComponent } from './data-table.component';

const meta: Meta = {
  parameters: {
    docs: {
      description: {
        component:
          '**When to use:** Lists of objects with a toolbar (search + `field:value` chips, filters, saved views, columns, density, refresh), selection + batch bar, row "More" menu, a fixed head (column heads + toolbar row stay; only the rows scroll), virtual scrolling and a pager slot. Filtering stays in the consumer. Kanban lanes: `stacked` (cards at any width) + row drag and drop (`dropGroup`, `dropData`, `rowDraggable`, `dropPredicate`, `(rowDrop)`).',
      },
    },
  },
  title: 'Data Display/Data Table',
  decorators: [moduleMetadata({ imports: [FpcDataTableComponent, FpcButtonComponent] })],
  render: () => ({
    props: {
      columns: [
        { id: 'name', label: 'Name', value: (row: { name: string }) => row.name, required: true },
        { id: 'kind', label: 'Kind', value: (row: { kind: string }) => row.kind },
        { id: 'status', label: 'Status', value: (row: { status: string }) => row.status },
      ],
      rows: [
        { id: '1', name: 'web', kind: 'Deployment', status: 'ready' },
        { id: '2', name: 'db', kind: 'VirtualMachine', status: 'running' },
        { id: '3', name: 'data', kind: 'Volume', status: 'bound' },
      ],
      menu: () => [
        { id: 'open', label: 'Open' },
        { id: 'delete', label: 'Delete', danger: true },
      ],
    },
    template: `<div style="height: 360px; border: 1px solid var(--bs-border-color)">
  <fpc-data-table ariaLabel="Resources" [columns]="columns" [rows]="rows" selectable refreshable [views]="[]" [rowMenu]="menu">
    <fpc-button fpcDataTableBatch variant="danger" size="sm" iconOnly ariaLabel="Delete" title="Delete">
      <i class="bi bi-trash" aria-hidden="true"></i>
    </fpc-button>
  </fpc-data-table>
</div>`,
  }),
};

export default meta;

export const Default: StoryObj = {};

/** Single selection (`selectionMode="single"`): radios, no select-all / batch bar; click / Space pick, Enter / double click pick and activate. */
export const SingleSelection: StoryObj = {
  render: () => ({
    props: {
      columns: [
        { id: 'name', label: 'Kind', value: (row: { name: string }) => row.name, required: true, priority: 1 },
        { id: 'description', label: 'Description', value: (row: { description: string }) => row.description },
        { id: 'scope', label: 'Scope', value: (row: { scope: string }) => row.scope },
      ],
      rows: [
        { id: 'Deployment', name: 'Deployment', description: 'A compose application', scope: 'Project' },
        { id: 'DnsZone', name: 'DNS zone', description: 'An authoritative zone', scope: 'Cluster' },
        { id: 'Policy', name: 'Policy', description: 'Network rules', scope: 'Cluster or project' },
      ],
      selected: ['DnsZone'],
    },
    template: `<div style="height: 280px; border: 1px solid var(--bs-border-color)">
  <fpc-data-table ariaLabel="Kinds" [columns]="columns" [rows]="rows" selectable selectionMode="single" [(selected)]="selected" [showColumnChooser]="false" />
</div>`,
  }),
};

/** Kanban lanes: one forced-stacked table per lane; rows drag between lanes of one `dropGroup` (locked rows stay). */
export const StackedLanesWithDragAndDrop: StoryObj = {
  render: () => {
    const lanes: Record<string, { id: string; name: string; status: string; locked?: boolean }[]> = {
      todo: [
        { id: '1', name: 'Write docs', status: 'todo' },
        { id: '2', name: 'Locked ticket', status: 'todo', locked: true },
      ],
      done: [{ id: '3', name: 'Ship it', status: 'done' }],
    };
    const props = {
      laneIds: ['todo', 'done'],
      lanes,
      columns: [
        {
          id: 'state',
          label: 'State',
          type: 'state',
          state: (row: { status: string }) =>
            row.status === 'done' ? { label: 'Done', tone: 'success' } : { label: 'To do', tone: 'primary' },
        },
        { id: 'name', label: 'Name', value: (row: { name: string }) => row.name, required: true, priority: 1 },
      ],
      draggable: (row: { locked?: boolean }) => !row.locked,
      menu: () => [{ id: 'open', label: 'Open' }],
      move: (event: { row: { id: string; name: string; status: string }; fromData: string; toData: string }) => {
        lanes[event.fromData] = lanes[event.fromData].filter((row) => row.id !== event.row.id);
        lanes[event.toData] = [...lanes[event.toData], { ...event.row, status: event.toData }];
        props.lanes = { ...lanes };
      },
    };

    return {
      props,
      template: `<div style="display: flex; height: 320px; border: 1px solid var(--bs-border-color)">
  @for (lane of laneIds; track lane) {
    <div style="flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; border-right: 1px solid var(--bs-border-color)">
      <fpc-data-table
        [ariaLabel]="lane"
        [columns]="columns"
        [rows]="lanes[lane]"
        stacked
        [searchable]="false"
        [showColumnChooser]="false"
        dropGroup="story-lanes"
        [dropData]="lane"
        [rowDraggable]="draggable"
        [rowMenu]="menu"
        (rowDrop)="move($event)"
      />
    </div>
  }
</div>`,
    };
  },
};

/**
 * A table wider than its space scrolls sideways in its body; chevrons at the ends of the column heads show that there
 * are more columns that way (fading into the head tint, gone at the respective end) and page the body on click.
 * `stickyFirstColumn` keeps the name in view; the indicators sit inside the sticky first / trailing (⋮) columns.
 */
export const WideWithOverflowIndicators: StoryObj = {
  render: () => {
    const metrics = ['CPU', 'Memory', 'Disk', 'Network in', 'Network out', 'IOPS', 'Uptime', 'Region', 'Zone', 'Owner'];

    return {
      props: {
        columns: [
          { id: 'name', label: 'Name', value: (row: Record<string, string>) => row['name'], required: true },
          ...metrics.map((label, index) => ({
            id: `m${index}`,
            label,
            value: (row: Record<string, string>) => row[`m${index}`],
            width: '9rem',
          })),
        ],
        rows: Array.from({ length: 12 }, (_, row) =>
          Object.fromEntries([
            ['id', String(row + 1)],
            ['name', `server-${row + 1}`],
            ...metrics.map((label, index) => [`m${index}`, `${label} ${row + 1}`]),
          ]),
        ),
        menu: () => [{ id: 'open', label: 'Open' }],
      },
      template: `<div style="width: 44rem; max-width: 100%; height: 360px; border: 1px solid var(--bs-border-color)">
  <fpc-data-table ariaLabel="Servers" [columns]="columns" [rows]="rows" stickyFirstColumn [rowMenu]="menu" />
</div>`,
    };
  },
};
