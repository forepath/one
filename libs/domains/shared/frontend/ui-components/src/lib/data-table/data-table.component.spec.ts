import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { FpcMenuItem } from '../menu/menu.types';
import {
  FpcDataTableComponent,
  FpcDataTableFooterDirective,
  FpcTableCellDirective,
  FpcTableRowActionEvent,
  FpcTableRowDetailDirective,
} from './data-table.component';
import { FpcTableRowDropEvent, fpcDropIndex } from './data-table.drag';
import { FpcTableColumn, FpcTableSort, fpcNextSort, fpcSortRows, fpcVisibleColumns } from './data-table.model';

interface Row {
  id: string;
  name: string;
  cpu: number | null;
  status: string;
}

const columns: FpcTableColumn<Row>[] = [
  { id: 'name', label: 'Name', value: (row) => row.name, required: true },
  { id: 'cpu', label: 'CPU', value: (row) => row.cpu, align: 'end' },
  { id: 'status', label: 'Status', value: (row) => row.status },
  { id: 'notes', label: 'Notes', hidden: true },
];

const rows: Row[] = [
  { id: 'a', name: 'web-10', cpu: 2, status: 'ready' },
  { id: 'b', name: 'web-2', cpu: null, status: 'pending' },
  { id: 'c', name: 'db', cpu: 8, status: 'ready' },
];

@Component({
  standalone: true,
  imports: [FpcDataTableComponent, FpcTableCellDirective],
  template: `
    <fpc-data-table
      ariaLabel="Resources"
      [columns]="columns"
      [rows]="rows()"
      selectable
      [(selected)]="selected"
      [(sort)]="sort"
      [(query)]="query"
      [rowMenu]="menu"
      [rowMark]="mark"
      [views]="[{ id: 'v1', name: 'My VMs' }]"
      refreshable
      (rowActivate)="activated.push($event.id)"
      (rowAction)="actions.push($event)"
      (refresh)="refreshed = refreshed + 1"
    >
      <ng-template fpcTableCell="status" let-row let-value="value"
        ><b class="status">{{ value }}</b></ng-template
      >
      <button fpcDataTableBatch type="button" class="batch-delete">Delete</button>
    </fpc-data-table>
  `,
})
class HostComponent {
  columns = columns;
  rows = signal<Row[]>(rows);
  selected: readonly string[] = [];
  sort: FpcTableSort | null = null;
  query = '';
  activated: string[] = [];
  actions: FpcTableRowActionEvent<Row>[] = [];
  refreshed = 0;
  menu = (row: Row): FpcMenuItem[] => [{ id: 'delete', label: `Delete ${row.name}`, danger: true }];
  mark = (row: Row): boolean => row.id === 'b';
}

describe('data table model', () => {
  it('sorts naturally with empty values last', () => {
    expect(fpcSortRows(rows, columns, { column: 'name', direction: 'asc' }).map((row) => row.id)).toEqual([
      'c',
      'b',
      'a',
    ]);
    expect(fpcSortRows(rows, columns, { column: 'cpu', direction: 'desc' }).map((row) => row.id)).toEqual([
      'c',
      'a',
      'b',
    ]);
    expect(fpcSortRows(rows, columns, null)).toBe(rows);
  });

  it('finds the drop index from the row middles', () => {
    const rects = [
      { top: 0, height: 40 },
      { top: 40, height: 40 },
    ];

    expect(fpcDropIndex(rects, 10)).toBe(0);
    expect(fpcDropIndex(rects, 50)).toBe(1);
    expect(fpcDropIndex(rects, 79)).toBe(2);
    expect(fpcDropIndex([], 5)).toBe(0);
  });

  it('cycles the sort and picks visible columns', () => {
    expect(fpcNextSort(null, 'name')).toEqual({ column: 'name', direction: 'asc' });
    expect(fpcNextSort({ column: 'name', direction: 'asc' }, 'name')).toEqual({ column: 'name', direction: 'desc' });
    expect(fpcNextSort({ column: 'name', direction: 'desc' }, 'name')).toBeNull();
    expect(fpcVisibleColumns(columns, null).map((column) => column.id)).toEqual(['name', 'cpu', 'status']);
    expect(fpcVisibleColumns(columns, ['notes']).map((column) => column.id)).toEqual(['name', 'notes']);
  });
});

describe('FpcDataTableComponent', () => {
  function setup() {
    localStorage.clear();
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();

    return { fixture, host: fixture.nativeElement as HTMLElement, app: fixture.componentInstance };
  }

  function bodyRows(host: HTMLElement): HTMLElement[] {
    return Array.from(host.querySelectorAll<HTMLElement>('tr.fpc-data-table__row'));
  }

  it('renders rows, templates and the draft mark', () => {
    const { host } = setup();

    expect(bodyRows(host)).toHaveLength(3);
    expect(host.querySelectorAll('.fpc-data-table__head thead th')).toHaveLength(5); // check + 3 + more
    expect(host.querySelector('[data-row-id="a"] .status')?.textContent).toBe('ready');
    expect(host.querySelector('[data-row-id="b"] .fpc-data-table__mark')).not.toBeNull();
  });

  it('keeps the head and toolbar out of the scrolling body as one logical ARIA table', () => {
    const { host } = setup();
    const grid = host.querySelector('[data-testid="fpc-data-table-grid"]') as HTMLElement;
    const head = grid.querySelector('.fpc-data-table__head') as HTMLElement;
    const scroller = grid.querySelector('.fpc-data-table__scroller') as HTMLElement;

    expect(grid.getAttribute('role')).toBe('table');
    // Head block (column heads + toolbar row) is outside the scroller; the scroller holds only the rows.
    expect(scroller.contains(head)).toBe(false);
    expect(head.querySelector('[data-testid="fpc-data-table-toolbar"]')).not.toBeNull();
    expect(scroller.querySelector('[data-testid="fpc-data-table-toolbar"]')).toBeNull();
    expect(scroller.querySelectorAll('tr.fpc-data-table__row')).toHaveLength(3);
    // Same column structure in both tables.
    const headCols = head.querySelectorAll('colgroup > col').length;
    expect(scroller.querySelectorAll('colgroup > col').length).toBe(headCols);
    expect(headCols).toBe(5);
    // Both tables are presentational; the roles come from the rows / cells; the sizer copy is hidden.
    grid.querySelectorAll('table').forEach((table) => expect(table.getAttribute('role')).toBe('presentation'));
    expect(head.querySelectorAll('th[role="columnheader"]')).toHaveLength(5);
    expect(scroller.querySelector('thead.fpc-data-table__sizer')?.getAttribute('aria-hidden')).toBe('true');
    expect(
      scroller.querySelector('thead.fpc-data-table__sizer button, thead.fpc-data-table__sizer [tabindex="0"]'),
    ).toBeNull();
    expect(scroller.querySelector('tr.fpc-data-table__row')?.getAttribute('role')).toBe('row');
    expect(scroller.querySelector('tr.fpc-data-table__row td')?.getAttribute('role')).toBe('cell');
  });
  it('gives the head the widths of the shown columns only (hidden priority columns keep their col)', () => {
    const { fixture, host } = setup();
    const table = fixture.debugElement.query((el) => el.componentInstance instanceof FpcDataTableComponent)
      .componentInstance as FpcDataTableComponent<unknown>;
    const body = host.querySelector('.fpc-data-table__body-table') as HTMLTableElement;
    const cells = Array.from(body.tHead?.rows[0]?.cells ?? []) as HTMLElement[];
    const rect = (width: number) => ({ width }) as DOMRect;

    // check, three columns (the middle one hidden by the container query), more.
    [24, 120, 0, 80, 32].forEach((width, index) => (cells[index].getBoundingClientRect = () => rect(width)));
    cells[2].style.display = 'none';
    body.getBoundingClientRect = () => rect(256);
    (table as unknown as { syncHead(): void }).syncHead();

    const cols = Array.from(host.querySelectorAll<HTMLElement>('.fpc-data-table__head-table > colgroup > col'));

    expect(cols.map((col) => col.style.width)).toEqual(['24px', '120px', '80px', '32px', '0px']);
  });

  it('sorts on header click and reports aria-sort', () => {
    const { fixture, host, app } = setup();

    (host.querySelector('[data-sort-column="name"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(app.sort).toEqual({ column: 'name', direction: 'asc' });
    expect(bodyRows(host).map((row) => row.dataset['rowId'])).toEqual(['c', 'b', 'a']);
    expect(host.querySelector('[data-sort-column="name"]')?.closest('th')?.getAttribute('aria-sort')).toBe('ascending');
  });

  it('renders sortable heads with the shared sort control and a reserved indicator', () => {
    const { fixture, host } = setup();
    const button = (id: string) => host.querySelector(`[data-sort-column="${id}"]`) as HTMLButtonElement;
    const icon = (id: string) => button(id).querySelector('.fpc-table__sort-icon') as HTMLElement;

    expect(button('name').classList).toContain('fpc-table__sort');
    expect(button('name').getAttribute('type')).toBe('button');
    // Indicator always rendered (space reserved); neutral until the column is sorted.
    expect(icon('name').classList).toContain('bi-arrow-down-up');
    expect(icon('name').getAttribute('aria-hidden')).toBe('true');
    expect(button('cpu').closest('th')?.getAttribute('aria-sort')).toBe('none');

    button('cpu').click();
    button('cpu').click();
    fixture.detectChanges();
    expect(icon('cpu').classList).toContain('bi-caret-down-fill');
    expect(icon('cpu').classList).not.toContain('bi-arrow-down-up');
    expect(button('cpu').closest('th')?.getAttribute('aria-sort')).toBe('descending');
    expect(icon('name').classList).toContain('bi-arrow-down-up');

    // Non-sort head cells (selection, row menu) carry no aria-sort.
    expect(host.querySelector('th.fpc-data-table__check')?.hasAttribute('aria-sort')).toBe(false);
    expect(host.querySelector('th.fpc-data-table__more')?.hasAttribute('aria-sort')).toBe(false);
  });

  it('selects rows, shows the batch bar and selects all', () => {
    const { fixture, host, app } = setup();

    (bodyRows(host)[0].querySelector('input') as HTMLInputElement).click();
    fixture.detectChanges();
    expect(app.selected).toEqual(['a']);
    expect(host.querySelector('[data-testid="fpc-data-table-batch"]')?.textContent).toContain('1 selected');
    expect(host.querySelector('.batch-delete')).not.toBeNull();

    (host.querySelector('[data-testid="fpc-data-table-select-all"]') as HTMLInputElement).click();
    fixture.detectChanges();
    expect(app.selected).toEqual(['a', 'b', 'c']);
  });

  it('activates rows on click / Enter but not from the checkbox', () => {
    const { fixture, host, app } = setup();

    bodyRows(host)[2].click();
    bodyRows(host)[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    (bodyRows(host)[0].querySelector('input') as HTMLInputElement).click();
    fixture.detectChanges();
    expect(app.activated).toEqual(['c', 'b']);
  });

  it('opens the row menu and emits the chosen action', () => {
    const { fixture, host, app } = setup();

    (bodyRows(host)[0].querySelector('[data-testid="fpc-data-table-row-more"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    const item = host.querySelector('[data-testid="fpc-context-menu"] [data-item-id="delete"]') as HTMLButtonElement;
    expect(item.textContent).toContain('Delete web-10');
    item.click();
    expect(app.actions.map((action) => [action.row.id, action.item.id])).toEqual([['a', 'delete']]);
  });

  it('hides and shows columns, refreshes and binds the query', () => {
    const { fixture, host, app } = setup();
    const table = fixture.debugElement.children[0].componentInstance as FpcDataTableComponent<Row>;

    (host.querySelector('[data-testid="fpc-data-table-columns"] [fpcDropdownTrigger]') as HTMLElement).click();
    fixture.detectChanges();
    (host.querySelector('[data-column-id="cpu"]') as HTMLInputElement).click();
    fixture.detectChanges();
    expect(table.visibleColumns()).toEqual(['name', 'status']);

    // Density is global (top bar): the table has no local toggle.
    expect(host.querySelector('[data-testid="fpc-data-table-density"]')).toBeNull();

    (host.querySelector('[data-testid="fpc-data-table-refresh"]') as HTMLButtonElement).click();
    expect(app.refreshed).toBe(1);

    const search = host.querySelector('fpc-search-field input') as HTMLInputElement;
    search.value = 'kind:Node';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(app.query).toBe('kind:Node');
  });

  it('virtualizes long lists', () => {
    const { fixture, host, app } = setup();
    app.rows.set(
      Array.from({ length: 5000 }, (_, index) => ({
        id: `r${index}`,
        name: `row ${index}`,
        cpu: index,
        status: 'ready',
      })),
    );
    fixture.detectChanges();

    expect(bodyRows(host).length).toBeLessThan(100);
    expect(host.querySelector('[role="table"]')?.getAttribute('aria-rowcount')).toBe('5001');
    expect(host.querySelectorAll('tr.fpc-data-table__pad').length).toBe(1);
  });

  it('shows the empty text without rows', () => {
    const { fixture, host, app } = setup();
    app.rows.set([]);
    fixture.detectChanges();
    expect(host.querySelector('.fpc-data-table__empty')?.textContent).toContain('Nothing to show');
  });
});

@Component({
  standalone: true,
  imports: [FpcDataTableComponent, FpcDataTableFooterDirective],
  template: `
    <fpc-data-table
      ariaLabel="Totals"
      [columns]="columns"
      [rows]="rows"
      [stickyHeader]="head()"
      [stickyFooter]="foot()"
      [stickyFirstColumn]="first()"
    >
      @if (withFooter()) {
        <ng-template fpcDataTableFooter
          ><tr class="totals">
            <td colspan="3">Total</td>
          </tr></ng-template
        >
      }
    </fpc-data-table>
  `,
})
class StickyHostComponent {
  columns = columns;
  rows = rows;
  head = signal(true);
  foot = signal<boolean | null>(null);
  first = signal(false);
  withFooter = signal(true);
}

describe('FpcDataTableComponent sticky head / foot', () => {
  it('sticks the head by default and the footer row when one exists', () => {
    const fixture = TestBed.createComponent(StickyHostComponent);
    fixture.detectChanges();
    const table = fixture.nativeElement.querySelector('fpc-data-table') as HTMLElement;

    expect(table.classList).toContain('fpc-data-table--sticky-head');
    expect(table.classList).toContain('fpc-data-table--sticky-foot');
    expect(table.querySelector('tfoot tr.totals')?.textContent).toContain('Total');

    fixture.componentInstance.head.set(false);
    fixture.componentInstance.foot.set(false);
    fixture.detectChanges();
    expect(table.classList).not.toContain('fpc-data-table--sticky-head');
    expect(table.classList).not.toContain('fpc-data-table--sticky-foot');
  });

  it('keeps the first column in view on request (wide comparisons)', () => {
    const fixture = TestBed.createComponent(StickyHostComponent);
    fixture.detectChanges();
    const inner = () => fixture.nativeElement.querySelector('table') as HTMLTableElement;

    expect(inner().classList).not.toContain('fpc-table--sticky-first');
    fixture.componentInstance.first.set(true);
    fixture.detectChanges();
    expect(inner().classList).toContain('fpc-table--sticky-first');
    // The corner cell layers above the sticky head through the global sticky-head pairing.
    expect(inner().classList).toContain('fpc-table--sticky-head');
  });

  it('has no tfoot (and no sticky footer) without a footer template', () => {
    const fixture = TestBed.createComponent(StickyHostComponent);
    fixture.componentInstance.withFooter.set(false);
    fixture.detectChanges();
    const table = fixture.nativeElement.querySelector('fpc-data-table') as HTMLElement;

    expect(table.querySelector('tfoot')).toBeNull();
    expect(table.classList).not.toContain('fpc-data-table--sticky-foot');
  });
});

@Component({
  standalone: true,
  imports: [FpcDataTableComponent, FpcTableRowDetailDirective],
  template: `
    <fpc-data-table
      ariaLabel="Lines"
      [columns]="columns"
      [rows]="rows"
      [expandedRowId]="expanded()"
      (rowActivate)="expanded.set(expanded() === $event.id ? null : $event.id)"
    >
      <ng-template fpcTableRowDetail let-row
        ><span class="detail">detail of {{ row.name }}</span></ng-template
      >
    </fpc-data-table>
  `,
})
class DetailHostComponent {
  columns = columns;
  rows = rows;
  expanded = signal<string | null>(null);
}

describe('FpcDataTableComponent row detail', () => {
  it('renders the detail row under the expanded row only', () => {
    const fixture = TestBed.createComponent(DetailHostComponent);
    fixture.detectChanges();
    const table = fixture.nativeElement.querySelector('fpc-data-table') as HTMLElement;

    expect(table.querySelector('[data-testid="fpc-data-table-detail"]')).toBeNull();
    const row = table.querySelector('tr[data-row-id="b"]') as HTMLElement;
    expect(row.getAttribute('aria-expanded')).toBe('false');

    row.querySelector('td')?.click();
    fixture.detectChanges();
    const detail = table.querySelector('[data-testid="fpc-data-table-detail"]') as HTMLElement;
    expect(detail.textContent).toContain('detail of web-2');
    expect(detail.previousElementSibling?.getAttribute('data-row-id')).toBe('b');
    expect(row.getAttribute('aria-expanded')).toBe('true');
  });
});

@Component({
  standalone: true,
  imports: [FpcDataTableComponent],
  template: `<fpc-data-table ariaLabel="Lines" [columns]="columns" [rows]="rows" [searchable]="searchable()" />`,
})
class ChooserHostComponent {
  columns = columns;
  rows = rows;
  searchable = signal(false);
}

describe('FpcDataTableComponent column chooser placement', () => {
  it('puts a lone chooser into the head corner and keeps the toolbar for search', () => {
    const fixture = TestBed.createComponent(ChooserHostComponent);
    fixture.detectChanges();
    const table = fixture.nativeElement.querySelector('fpc-data-table') as HTMLElement;

    // No search / filters / refresh: the chooser sits in the trailing head cell, body rows get the matching cell.
    const corner = table.querySelector('thead th.fpc-data-table__columns-cell') as HTMLElement;
    expect(corner.querySelector('[data-testid="fpc-data-table-columns"]')).not.toBeNull();
    expect(
      table.querySelector('[data-testid="fpc-data-table-toolbar"] [data-testid="fpc-data-table-columns"]'),
    ).toBeNull();
    const firstRow = table.querySelector('tbody tr[data-row-id]') as HTMLElement;
    expect(firstRow.querySelectorAll('td').length).toBe(columns.filter((c) => !c.hidden).length + 1);

    fixture.componentInstance.searchable.set(true);
    fixture.detectChanges();
    expect(table.querySelector('thead th.fpc-data-table__columns-cell')).toBeNull();
    expect(
      table.querySelector('[data-testid="fpc-data-table-toolbar"] [data-testid="fpc-data-table-columns"]'),
    ).not.toBeNull();
  });
});

@Component({
  standalone: true,
  imports: [FpcDataTableComponent],
  template: `<fpc-data-table ariaLabel="Lines" [columns]="columns" [rows]="[]" [(query)]="query" emptyIcon="hdd" />`,
})
class EmptyHostComponent {
  columns = columns;
  query = signal('');
}

describe('FpcDataTableComponent empty vs no matches', () => {
  it('shows the empty state without a query and "No matches" while searching', () => {
    const fixture = TestBed.createComponent(EmptyHostComponent);
    fixture.detectChanges();
    const table = fixture.nativeElement.querySelector('fpc-data-table') as HTMLElement;

    expect(table.querySelector('[data-empty-reason="empty"]')?.textContent).toContain('Nothing to show');
    expect(table.querySelector('[data-testid="fpc-data-table-no-matches"]')).toBeNull();

    fixture.componentInstance.query.set('web');
    fixture.detectChanges();
    expect(table.querySelector('[data-empty-reason="no-matches"]')?.textContent).toContain('No matches');
  });
});

describe('FpcDataTableComponent toolbar icon controls', () => {
  it('renders the column chooser as a quiet square toolbar button (shared fpc-icon-btn + fpc-toolbar-btn)', () => {
    const fixture = TestBed.createComponent(ChooserHostComponent);
    fixture.componentInstance.searchable.set(true);
    fixture.detectChanges();
    const table = fixture.nativeElement.querySelector('fpc-data-table') as HTMLElement;
    const chooser = table.querySelector('[data-testid="fpc-data-table-columns"] [fpcDropdownTrigger]') as HTMLElement;

    expect(chooser.classList).toContain('fpc-icon-btn');
    expect(chooser.classList).toContain('fpc-toolbar-btn');
    expect(chooser.classList).not.toContain('btn-secondary');
  });
});

interface StateRow {
  id: string;
  name: string;
  state: 'ok' | 'failed' | 'pending';
  group: string;
}

const stateRows: StateRow[] = Array.from({ length: 60 }, (_, index) => ({
  id: `r${index}`,
  name: `row-${String(index).padStart(2, '0')}`,
  state: index % 3 === 0 ? 'failed' : index % 3 === 1 ? 'pending' : 'ok',
  group: index % 2 === 0 ? 'even' : 'odd',
}));

const STATE_LABEL = { ok: 'Healthy', failed: 'Failed', pending: 'Pending' } as const;
const STATE_TONE = { ok: 'success', failed: 'danger', pending: 'warning' } as const;

@Component({
  standalone: true,
  imports: [FpcDataTableComponent],
  template: `
    <fpc-data-table
      ariaLabel="Things"
      [columns]="columns"
      [rows]="rows()"
      [paging]="paging()"
      [(page)]="page"
      [(pageSize)]="pageSize"
      [(query)]="query"
      [(sort)]="sort"
      [total]="total()"
      [hasNext]="hasNext()"
      [hasMore]="hasMore()"
      [loading]="loading()"
      [error]="error()"
      [groupBy]="groupBy()"
      [persistKey]="persistKey()"
      [rowInlineActions]="inline"
      (rowAction)="actions.push($event.item.id)"
      (loadMore)="loads = loads + 1"
    />
  `,
})
class PagedHostComponent {
  columns: FpcTableColumn<StateRow>[] = [
    {
      id: 'state',
      label: 'State',
      type: 'state',
      state: (row) => ({ label: STATE_LABEL[row.state], tone: STATE_TONE[row.state] }),
    },
    { id: 'name', label: 'Name', value: (row) => row.name, priority: 1 },
    { id: 'group', label: 'Group', value: (row) => row.group, priority: 3 },
  ];
  rows = signal<StateRow[]>(stateRows);
  paging = signal<'none' | 'client' | 'server' | 'infinite'>('client');
  page = 1;
  pageSize = 25;
  query = '';
  sort: FpcTableSort | null = null;
  total = signal<number | null>(null);
  hasNext = signal<boolean | null>(null);
  hasMore = signal(false);
  loading = signal(false);
  error = signal<string | null>(null);
  groupBy = signal<((row: StateRow) => string) | null>(null);
  persistKey = signal<string | null>(null);
  actions: string[] = [];
  loads = 0;
  inline = (): FpcMenuItem[] => [{ id: 'open', label: 'Open', icon: 'box-arrow-up-right' }];
}

describe('FpcDataTableComponent data-list pattern (3.38 D1–D4)', () => {
  function setup(configure?: (app: PagedHostComponent) => void) {
    const fixture = TestBed.createComponent(PagedHostComponent);
    configure?.(fixture.componentInstance);
    fixture.detectChanges();

    return { fixture, host: fixture.nativeElement as HTMLElement, app: fixture.componentInstance };
  }

  const names = (host: HTMLElement) =>
    Array.from(host.querySelectorAll('tr.fpc-data-table__row td.fpc-data-table__cell--lead')).map((td) =>
      td.textContent?.trim(),
    );

  beforeEach(() => localStorage.clear());

  it('pages client rows (25 by default) with "x–y of N" and resets to page 1 on search', () => {
    const { fixture, host, app } = setup();

    expect(names(host)).toHaveLength(25);
    expect(host.querySelector('[data-testid="fpc-pager-range"]')?.textContent?.trim()).toBe('1–25 of 60');
    (host.querySelector('[data-page="3"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(app.page).toBe(3);
    expect(names(host)).toHaveLength(10);
    expect(names(host)[0]).toBe('row-50');

    app.query = 'row';
    fixture.detectChanges();
    fixture.detectChanges();
    expect(app.page).toBe(1);
  });

  it('hides the pager while everything fits one page at the smallest size', () => {
    const { fixture, host, app } = setup((a) => a.rows.set(stateRows.slice(0, 25)));

    expect(host.querySelector('[data-testid="fpc-data-table-pager"]')).toBeNull();

    app.rows.set(stateRows.slice(0, 26));
    fixture.detectChanges();
    expect(host.querySelector('[data-testid="fpc-pager-range"]')?.textContent?.trim()).toBe('1–25 of 26');
  });

  it('hides the server pager on a single last page and keeps it while a next page exists', () => {
    const { fixture, host, app } = setup((a) => {
      a.paging.set('server');
      a.rows.set(stateRows.slice(0, 3));
      a.hasNext.set(false);
    });

    expect(host.querySelector('[data-testid="fpc-data-table-pager"]')).toBeNull();

    app.hasNext.set(true);
    fixture.detectChanges();
    expect(host.querySelector('[data-testid="fpc-data-table-pager"]')).not.toBeNull();
  });

  it('never shows the pager under an empty first page, even with a stale hasNext (X-12)', () => {
    const { fixture, host, app } = setup((a) => {
      a.paging.set('server');
      a.rows.set([]);
      a.hasNext.set(true);
    });

    expect(host.querySelector('[data-testid="fpc-data-table-pager"]')).toBeNull();

    app.rows.set(stateRows.slice(0, 3));
    fixture.detectChanges();
    expect(host.querySelector('[data-testid="fpc-data-table-pager"]')).not.toBeNull();
  });

  it('renders the State column as square icon badges with readable labels and sorts by severity', () => {
    const { fixture, host } = setup();
    const badge = host.querySelector('[data-row-id="r0"] [data-testid="fpc-data-table-state"]') as HTMLElement;

    expect(badge.classList).toContain('fpc-badge--icon-only');
    expect(badge.getAttribute('aria-label')).toBe('Failed');
    expect(badge.querySelector('.bi-x-circle-fill')).not.toBeNull();

    (host.querySelector('[data-sort-column="state"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    const labels = Array.from(host.querySelectorAll('[data-testid="fpc-data-table-state"]')).map((el) =>
      el.getAttribute('aria-label'),
    );
    expect(labels.slice(0, 20).every((label) => label === 'Failed')).toBe(true);
  });

  it('shows the server range without total via hasNext', () => {
    const { host } = setup((app) => {
      app.paging.set('server');
      app.rows.set(stateRows.slice(0, 25));
      app.hasNext.set(true);
    });

    expect(host.querySelector('[data-testid="fpc-pager-range"]')?.textContent?.trim()).toBe('1–25');
    expect((host.querySelector('.fpc-pager__next') as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows skeleton rows while loading and the error above the rows', () => {
    const { fixture, host, app } = setup((a) => {
      a.rows.set([]);
      a.loading.set(true);
    });

    expect(host.querySelectorAll('[data-testid="fpc-data-table-skeleton"]').length).toBe(5);
    expect(host.querySelector('.fpc-data-table__empty')).toBeNull();
    app.loading.set(false);
    app.error.set('Could not load');
    fixture.detectChanges();
    expect(host.querySelector('[data-testid="fpc-data-table-error"]')?.textContent).toContain('Could not load');
  });

  it('groups rows with collapsible headers', () => {
    const { fixture, host } = setup((app) => app.groupBy.set((row) => row.group));
    const groups = host.querySelectorAll('[data-testid="fpc-data-table-group"]');

    expect(groups).toHaveLength(2);
    (groups[0].querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(names(host).length).toBeLessThan(25);
  });

  it('emits inline row actions and moves focus with the arrow keys', () => {
    const { host, app } = setup();

    (host.querySelector('[data-testid="fpc-data-table-row-action"]') as HTMLButtonElement).click();
    expect(app.actions).toEqual(['open']);

    const first = host.querySelector('tr.fpc-data-table__row') as HTMLElement;
    first.focus();
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(host.querySelectorAll('tr.fpc-data-table__row')[1]);
  });

  it('persists the page size per table', async () => {
    const first = setup((app) => app.persistKey.set('things'));
    await first.fixture.whenStable();

    (first.host.querySelector('[data-testid="fpc-pager-size"]') as HTMLSelectElement).value = '50';
    first.host.querySelector('[data-testid="fpc-pager-size"]')?.dispatchEvent(new Event('change'));
    first.fixture.detectChanges();
    expect(JSON.parse(localStorage.getItem('fpc-data-table:things') ?? '{}').pageSize).toBe(50);

    const second = setup((app) => app.persistKey.set('things'));
    await second.fixture.whenStable();
    second.fixture.detectChanges();
    expect(second.app.pageSize).toBe(50);
    expect(names(second.host)).toHaveLength(50);
  });
});

describe('FpcDataTableComponent infinite mode (Agenstra tickets)', () => {
  let callback: IntersectionObserverCallback | null = null;
  const original = (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;

  beforeEach(() => {
    callback = null;
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = class {
      constructor(cb: IntersectionObserverCallback) {
        callback = cb;
      }
      observe(): void {
        // No-op: the test drives the callback directly.
      }
      disconnect(): void {
        // No-op.
      }
    };
  });

  afterEach(() => {
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = original;
  });

  const intersect = (visible: boolean) =>
    callback?.([{ isIntersecting: visible } as IntersectionObserverEntry], {} as IntersectionObserver);

  it('loads more once per loaded length while the end is visible and re-arms after a reset', () => {
    const fixture = TestBed.createComponent(PagedHostComponent);
    const app = fixture.componentInstance;

    app.paging.set('infinite');
    app.rows.set(stateRows.slice(0, 20));
    app.hasMore.set(true);
    fixture.detectChanges();

    intersect(true);
    intersect(true);
    expect(app.loads).toBe(1); // no duplicate for the same length

    app.loading.set(true);
    fixture.detectChanges();
    app.rows.set(stateRows.slice(0, 40));
    app.loading.set(false);
    fixture.detectChanges();
    expect(app.loads).toBe(2); // still at the end after the page arrived → next page

    app.hasMore.set(false);
    app.rows.set(stateRows.slice(0, 60));
    fixture.detectChanges();
    intersect(true);
    expect(app.loads).toBe(2);

    // A new search resets the rows: loading starts again from the first page.
    app.hasMore.set(true);
    app.rows.set(stateRows.slice(0, 20));
    fixture.detectChanges();
    expect(app.loads).toBe(3);
    expect(fixture.nativeElement.querySelector('[data-testid="fpc-data-table-pager"]')).toBeNull();
  });
});

interface LaneRow {
  id: string;
  name: string;
  locked?: boolean;
}

@Component({
  standalone: true,
  imports: [FpcDataTableComponent],
  template: `
    @for (lane of lanes; track lane) {
      <fpc-data-table
        [attr.data-lane]="lane"
        [ariaLabel]="lane"
        [columns]="laneColumns"
        [rows]="rowsOf(lane)"
        stacked
        [searchable]="false"
        [showColumnChooser]="false"
        [virtualThreshold]="threshold()"
        [dropGroup]="group(lane)"
        [dropData]="lane"
        [rowDraggable]="draggable"
        (rowDrop)="drops.push($event)"
        (rowActivate)="activated.push($event.id)"
      />
    }
  `,
})
class LanesHostComponent {
  lanes = ['todo', 'done', 'empty', 'other'];
  laneColumns: FpcTableColumn<LaneRow>[] = [{ id: 'name', label: 'Name', value: (row) => row.name, priority: 1 }];
  rows: Record<string, LaneRow[]> = {
    todo: [
      { id: 't1', name: 'one' },
      { id: 't2', name: 'two', locked: true },
    ],
    done: [{ id: 'd1', name: 'three' }],
    empty: [],
    other: [],
  };
  threshold = signal(200);
  drops: FpcTableRowDropEvent<LaneRow>[] = [];
  activated: string[] = [];
  draggable = (row: LaneRow): boolean => !row.locked;
  rowsOf = (lane: string): LaneRow[] => this.rows[lane];
  group = (lane: string): string => (lane === 'other' ? 'elsewhere' : 'tickets');
}

describe('FpcDataTableComponent stacked + row drag and drop', () => {
  function setup() {
    const fixture = TestBed.createComponent(LanesHostComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const lane = (name: string) =>
      host.querySelector<HTMLElement>(`fpc-data-table[data-lane="${name}"]`) as HTMLElement;

    return {
      fixture,
      host,
      app: fixture.componentInstance,
      lane,
      rows: (name: string) => Array.from(lane(name).querySelectorAll<HTMLElement>('tr.fpc-data-table__row')),
      body: (name: string) =>
        lane(name).querySelector<HTMLElement>('[data-testid="fpc-data-table-scroller"]') as HTMLElement,
    };
  }

  function drag(target: HTMLElement, type: string): Event {
    const event = new Event(type, { bubbles: true, cancelable: true });

    target.dispatchEvent(event);

    return event;
  }

  it('forces stacked cards with the stacked input', () => {
    const { lane } = setup();

    expect(lane('todo').classList).toContain('fpc-data-table--stacked');
  });

  it('makes rows draggable only with a drop group, minus locked rows', () => {
    const { rows } = setup();

    expect(rows('todo').map((row) => row.getAttribute('draggable'))).toEqual(['true', null]);
    expect(rows('todo')[0].classList).toContain('fpc-data-table__row--draggable');
  });

  it('turns drag and drop off while the table virtualizes', () => {
    const { fixture, app, rows } = setup();

    app.threshold.set(0);
    fixture.detectChanges();
    expect(rows('todo')[0].getAttribute('draggable')).toBeNull();
  });

  it('drops a row on another lane of the group with from / to data and indexes', () => {
    const { fixture, app, rows, body, lane } = setup();

    drag(rows('todo')[0], 'dragstart');
    const over = drag(body('done'), 'dragover');
    fixture.detectChanges();

    expect(over.defaultPrevented).toBe(true);
    expect(lane('done').classList).toContain('fpc-data-table--drop-over');

    drag(body('done'), 'drop');
    fixture.detectChanges();

    expect(app.drops).toHaveLength(1);
    expect(app.drops[0]).toMatchObject({ fromData: 'todo', toData: 'done', fromIndex: 0, toIndex: 1 });
    expect(app.drops[0].row.id).toBe('t1');
    expect(lane('done').classList).not.toContain('fpc-data-table--drop-over');
  });

  it('accepts drops on an empty lane body, not from another group', () => {
    const { app, rows, body } = setup();

    drag(rows('done')[0], 'dragstart');
    expect(drag(body('other'), 'dragover').defaultPrevented).toBe(false);
    drag(body('other'), 'drop');
    expect(app.drops).toHaveLength(0);

    expect(drag(body('empty'), 'dragover').defaultPrevented).toBe(true);
    drag(body('empty'), 'drop');
    expect(app.drops[0]).toMatchObject({ fromData: 'done', toData: 'empty', fromIndex: 0, toIndex: 0 });
  });

  it('refuses drops on the own lane and locked rows', () => {
    const { app, rows, body } = setup();

    drag(rows('todo')[0], 'dragstart');
    expect(drag(body('todo'), 'dragover').defaultPrevented).toBe(false);
    drag(body('todo'), 'drop');
    drag(rows('todo')[0], 'dragend');

    const locked = drag(rows('todo')[1], 'dragstart');

    expect(locked.defaultPrevented).toBe(true);
    expect(drag(body('done'), 'dragover').defaultPrevented).toBe(false);
    expect(app.drops).toHaveLength(0);
  });

  it('does not activate the row on the click right after a drag', () => {
    const { app, rows } = setup();

    drag(rows('done')[0], 'dragstart');
    drag(rows('done')[0], 'dragend');
    rows('done')[0].click();
    expect(app.activated).toEqual([]);

    rows('todo')[1].click();
    expect(app.activated).toEqual(['t2']);
  });
});

@Component({
  standalone: true,
  imports: [FpcDataTableComponent],
  template: `
    <fpc-data-table
      ariaLabel="Kinds"
      [columns]="columns"
      [rows]="rows"
      selectable
      selectionMode="single"
      [(selected)]="selected"
      (rowActivate)="activated.push($event.id)"
    >
      <button fpcDataTableBatch type="button" class="batch-delete">Delete</button>
    </fpc-data-table>
    <fpc-data-table ariaLabel="Other" [columns]="columns" [rows]="rows" selectable selectionMode="single" />
  `,
})
class SingleHostComponent {
  columns = columns;
  rows = rows;
  selected: readonly string[] = [];
  activated: string[] = [];
}

describe('FpcDataTableComponent single selection', () => {
  function setup() {
    TestBed.configureTestingModule({ imports: [SingleHostComponent] });

    const fixture = TestBed.createComponent(SingleHostComponent);

    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const table = host.querySelector('fpc-data-table') as HTMLElement;
    const rowsOf = (element: HTMLElement) =>
      Array.from(element.querySelectorAll<HTMLTableRowElement>('tbody > tr.fpc-data-table__row'));
    const radios = () => rowsOf(table).map((row) => row.querySelector('input') as HTMLInputElement);

    return { fixture, host, table, app: fixture.componentInstance, rows: () => rowsOf(table), radios };
  }

  it('renders radios in one named group per table, labelled by the lead column, no select-all', () => {
    const { host, table, radios } = setup();
    const names = new Set(radios().map((radio) => radio.name));
    const other = host.querySelectorAll('fpc-data-table')[1].querySelector('tbody input') as HTMLInputElement;

    expect(radios().every((radio) => radio.type === 'radio')).toBe(true);
    expect(names.size).toBe(1);
    expect(other.name).not.toBe(radios()[0].name);
    expect(radios().map((radio) => radio.getAttribute('aria-label'))).toEqual(['web-10', 'web-2', 'db']);
    expect(radios()[0].getAttribute('aria-checked')).toBe('false');
    expect(table.querySelector('[data-testid="fpc-data-table-select-all"]')).toBeNull();
    // The head cell stays (same width, magnifier axis) with an invisible radio.
    const ghost = table.querySelector('th.fpc-data-table__check input') as HTMLInputElement;
    expect(ghost.type).toBe('radio');
    expect(ghost.getAttribute('aria-hidden')).toBe('true');
    expect(ghost.classList).toContain('fpc-data-table__check-ghost');
  });

  it('selects one row on click / radio / Space, without a batch bar or activation', () => {
    const { fixture, table, app, rows, radios } = setup();

    rows()[1].click();
    fixture.detectChanges();
    expect(app.selected).toEqual(['b']);
    expect(radios()[1].checked).toBe(true);
    expect(radios()[1].getAttribute('aria-checked')).toBe('true');
    expect(rows()[1].getAttribute('aria-selected')).toBe('true');

    radios()[2].click();
    fixture.detectChanges();
    expect(app.selected).toEqual(['c']);

    rows()[0].dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    fixture.detectChanges();
    expect(app.selected).toEqual(['a']);
    // Selecting the selected row again keeps it (radio semantics).
    rows()[0].click();
    fixture.detectChanges();
    expect(app.selected).toEqual(['a']);

    expect(table.querySelector('[data-testid="fpc-data-table-batch"]')).toBeNull();
    expect(app.activated).toEqual([]);
  });

  it('selects and activates on Enter / double click; arrows move the focus', () => {
    const { fixture, app, rows } = setup();

    rows()[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    fixture.detectChanges();
    expect(app.selected).toEqual(['c']);
    expect(app.activated).toEqual(['c']);

    rows()[0].dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    fixture.detectChanges();
    expect(app.selected).toEqual(['a']);
    expect(app.activated).toEqual(['c', 'a']);

    rows()[0].focus();
    rows()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(rows()[1]);
  });
});

describe('FpcDataTableComponent overflow indicators', () => {
  function setup() {
    localStorage.clear();
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const scroller = host.querySelector<HTMLElement>('[data-testid="fpc-data-table-scroller"]') as HTMLElement;
    const frame = host.querySelector<HTMLElement>('.fpc-data-table__head-frame') as HTMLElement;
    const start = host.querySelector<HTMLButtonElement>('[data-testid="fpc-data-table-overflow-start"]');
    const end = host.querySelector<HTMLButtonElement>('[data-testid="fpc-data-table-overflow-end"]');

    /** Fakes the body's sideways scroll metrics and reports a scroll. */
    const scrollTo = (scrollLeft: number, scrollWidth = 1000, clientWidth = 400): void => {
      Object.defineProperty(scroller, 'scrollWidth', { configurable: true, value: scrollWidth });
      Object.defineProperty(scroller, 'clientWidth', { configurable: true, value: clientWidth });
      Object.defineProperty(scroller, 'scrollLeft', { configurable: true, writable: true, value: scrollLeft });
      scroller.dispatchEvent(new Event('scroll'));
    };
    const shown = () => ({
      start: frame.classList.contains('fpc-data-table__head-frame--more-start'),
      end: frame.classList.contains('fpc-data-table__head-frame--more-end'),
    });

    return { fixture, scroller, frame, start, end, scrollTo, shown };
  }

  it('renders two pointer-only chevrons in the head with tooltips, out of the ARIA tree and the tab order', () => {
    const { frame, start, end } = setup();

    for (const button of [start, end]) {
      expect(button?.parentElement).toBe(frame);
      expect(button?.getAttribute('aria-hidden')).toBe('true');
      expect(button?.getAttribute('tabindex')).toBe('-1');
    }
    expect(start?.title).toBe('Previous columns');
    expect(end?.title).toBe('Next columns');
    expect(start?.querySelector('.bi-chevron-left')).not.toBeNull();
    expect(end?.querySelector('.bi-chevron-right')).not.toBeNull();
  });

  it('shows neither indicator while the body fits sideways', () => {
    const { scrollTo, shown } = setup();

    scrollTo(0, 400, 400);
    expect(shown()).toEqual({ start: false, end: false });
    // Sub-pixel overflow counts as fitting.
    scrollTo(0, 401, 400);
    expect(shown()).toEqual({ start: false, end: false });
  });

  it('shows only the end indicator at the start, both in the middle and only the start one at the end', () => {
    const { scrollTo, shown } = setup();

    scrollTo(0);
    expect(shown()).toEqual({ start: false, end: true });
    scrollTo(1);
    expect(shown()).toEqual({ start: false, end: true });
    scrollTo(250);
    expect(shown()).toEqual({ start: true, end: true });
    scrollTo(599);
    expect(shown()).toEqual({ start: true, end: false });
    scrollTo(600);
    expect(shown()).toEqual({ start: true, end: false });
  });

  it('hides the end chevron once the last column meets the sticky ⋮ column, though scrollWidth claims more', () => {
    const { fixture, scroller, scrollTo, shown } = setup();
    const body = fixture.nativeElement.querySelector('.fpc-data-table__body-table') as HTMLTableElement;
    const cells = Array.from(body.tHead?.rows[0]?.cells ?? []) as HTMLElement[];
    const rect = (left: number, width: number) => ({ left, right: left + width, width }) as DOMRect;
    // Visible 0–400; the ⋮ column is stuck at 360–400 (its end padding clipped: the last 8 px are unreachable).
    let lastRight = 380;

    scroller.getBoundingClientRect = () => rect(0, 400);
    cells.forEach((cell, index) => {
      Object.defineProperty(cell, 'offsetWidth', { configurable: true, value: 100 });
      cell.getBoundingClientRect = () =>
        index === cells.length - 1 ? rect(360, 40) : rect(lastRight - (cells.length - 1 - index) * 100, 100);
    });

    // Last scrollable column still reaches under the ⋮ column: more to the right.
    scrollTo(592, 1000, 400);
    expect(shown().end).toBe(true);
    // It ends exactly at the ⋮ column: the end, although scrollLeft (592) is 8 px short of 600.
    lastRight = 360;
    scrollTo(592, 1000, 400);
    expect(shown()).toEqual({ start: true, end: false });
  });

  it('reveals the next cut-off column per click (column-wise), smoothly and clamped to its ends', () => {
    const { fixture, scroller, start, end, scrollTo } = setup();
    const spy = jest.fn();
    const body = fixture.nativeElement.querySelector('.fpc-data-table__body-table') as HTMLTableElement;
    const cells = Array.from(body.tHead?.rows[0]?.cells ?? []) as HTMLElement[];

    // Columns of 200 px each (the trailing ⋮ column is sticky and no candidate).
    cells.forEach((cell, index) => {
      Object.defineProperty(cell, 'offsetLeft', { configurable: true, value: index * 200 });
      Object.defineProperty(cell, 'offsetWidth', { configurable: true, value: 200 });
    });
    scroller.scrollTo = spy as unknown as typeof scroller.scrollTo;
    scrollTo(100);
    // Visible 100–500: the column 400–600 is cut off → its right edge at the view's right (600 − 400 = 200).
    end?.click();
    expect(spy).toHaveBeenLastCalledWith({ left: 200, behavior: 'smooth' });
    // The column 0–200 starts before the view → its left edge at the view's left.
    start?.click();
    expect(spy).toHaveBeenLastCalledWith({ left: 0, behavior: 'smooth' });
  });

  it('never lets head scroll events move the body (no cancelled glide, no stuck end); focus in the head does', async () => {
    const { fixture, scroller } = setup();
    const head = fixture.nativeElement.querySelector('.fpc-data-table__head-scroller') as HTMLElement;

    Object.defineProperty(scroller, 'scrollLeft', { configurable: true, writable: true, value: 600 });
    scroller.dispatchEvent(new Event('scroll'));
    // The browser clamps the head while its column widths are rewritten: that scroll leaves the body alone…
    head.scrollLeft = 590;
    head.dispatchEvent(new Event('scroll'));
    expect(scroller.scrollLeft).toBe(600);
    // …while focus moving into a clipped head cell brings the body along (next frame).
    head.scrollLeft = 120;
    head.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    expect(scroller.scrollLeft).toBe(120);
  });

  it('jumps instead of gliding when the user prefers reduced motion', () => {
    const { scroller, end, scrollTo } = setup();
    const spy = jest.fn();
    const original = window.matchMedia;

    window.matchMedia = ((query: string) => ({ matches: query.includes('reduce') })) as unknown as typeof matchMedia;
    try {
      scroller.scrollTo = spy as unknown as typeof scroller.scrollTo;
      scrollTo(0);
      end?.click();
      expect(spy).toHaveBeenLastCalledWith({ left: 600, behavior: 'auto' });
    } finally {
      window.matchMedia = original;
    }
  });
});
