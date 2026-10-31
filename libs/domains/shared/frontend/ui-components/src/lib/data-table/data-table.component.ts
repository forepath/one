import { LocationStrategy, NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Directive,
  ElementRef,
  NgZone,
  OnInit,
  TemplateRef,
  afterEveryRender,
  booleanAttribute,
  computed,
  contentChildren,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';

import { FpcAlertComponent } from '../alert/alert.component';
import { FpcButtonComponent } from '../button/button.component';
import { FpcBadgeComponent } from '../badge/badge.component';
import { FpcContextMenuComponent, FpcContextMenuPosition } from '../context-menu/context-menu.component';
import { FpcDensity, FpcDensityService } from '../density/density.service';
import { FpcDropdownComponent } from '../dropdown/dropdown.component';
import { FpcFilterChip } from '../filter-chips/filter-chips.component';
import { FpcEmptyStateComponent } from '../empty-state/empty-state.component';
import { FpcListToolbarComponent } from '../list-toolbar/list-toolbar.component';
import { FpcMenuItem } from '../menu/menu.types';
import { FPC_DEFAULT_PAGE_SIZE, FPC_PAGE_SIZES, FpcPagerComponent } from '../pager/pager.component';
import {
  FPC_SCROLL_EDGE_PX as FPC_EDGE_PX,
  fpcScrollColumnTarget,
  fpcScrollEdges,
  fpcScrollToLeft,
} from '../scroll-overflow/scroll-overflow';
import { FpcSearchFieldComponent } from '../search-field/search-field.component';
import { fpcVirtualWindow } from '../tree/tree.model';
import {
  FPC_DATA_TABLE_DEFAULT_LABELS,
  FPC_DATA_TABLE_LABELS,
  FpcDataTableLabels,
  FpcTableCellValue,
  FpcTableColumn,
  FpcTableSort,
  FpcTableState,
  FpcTableView,
  FPC_TABLE_STATE_ICON,
  fpcColumnValue,
  fpcNextSort,
  fpcPageCount,
  fpcPageSlice,
  fpcSortRows,
  fpcVisibleColumns,
} from './data-table.model';
import {
  FpcTableDropPredicate,
  FpcTableRowDropEvent,
  fpcActiveTableDrag,
  fpcDefaultDropPredicate,
  fpcDropIndex,
  fpcSetActiveTableDrag,
} from './data-table.drag';

/** Rich cell: `<ng-template fpcTableCell="status" let-row let-value="value">…</ng-template>`. */
@Directive({ selector: 'ng-template[fpcTableCell]', standalone: true })
export class FpcTableCellDirective {
  readonly column = input.required<string>({ alias: 'fpcTableCell' });
  readonly template = inject(TemplateRef);
}

/**
 * Footer row(s) of the table (totals, summaries): `<ng-template fpcDataTableFooter><tr>…</tr></ng-template>`,
 * rendered in `<tfoot>` (sticky at the bottom of the scroll area by default).
 */
@Directive({ selector: 'ng-template[fpcDataTableFooter]', standalone: true })
export class FpcDataTableFooterDirective {
  readonly template = inject(TemplateRef);
}

/**
 * Detail of the expanded row (`expandedRowId`): `<ng-template fpcTableRowDetail let-row>…</ng-template>`, rendered in a
 * full-width row under it (log line labels, audit payloads). Virtual scrolling pauses while a row is expanded.
 */
@Directive({ selector: 'ng-template[fpcTableRowDetail]', standalone: true })
export class FpcTableRowDetailDirective {
  readonly template = inject(TemplateRef);
}

/** A row's "More" menu request (button or right click). */
export interface FpcTableRowActionEvent<T = unknown> {
  row: T;
  item: FpcMenuItem;
}

// Virtual-scroll row estimate: badge square (1.25rem + 2px) + 2 × 0.5rem cell padding in both densities.
const ROW_HEIGHT: Record<FpcDensity, number> = { compact: 38, comfortable: 38 };

/**
 * Paging of `fpc-data-table` (3.38 D4): `none` (all rows), `client` (the table slices `rows`), `server` (`rows` is the
 * current page; `total` or `hasNext` from the API; reload on `page` / `pageSize` / `sort` changes), `infinite` (Agenstra
 * tickets only: `loadMore` when the end comes into view while `hasMore`).
 */
export type FpcTablePaging = 'none' | 'client' | 'server' | 'infinite';

/**
 * Selection of a `selectable` table: `multi` (check boxes, select-all, batch bar) or `single` (radio buttons, at most one
 * id in `selected`; no select-all, no batch bar; a row click / Space selects, Enter / double click select and activate).
 */
export type FpcTableSelectionMode = 'multi' | 'single';

let fpcDataTableSeq = 0;

/** One rendered body entry: a group header or a row. */
export type FpcTableEntry<T> =
  | { kind: 'group'; key: string; label: string; count: number; collapsed: boolean }
  | { kind: 'row'; row: T };

interface FpcTablePersisted {
  columns?: readonly string[] | null;
  sort?: FpcTableSort | null;
  pageSize?: number;
}

const STORAGE_PREFIX = 'fpc-data-table:';

/**
 * Proxmox-style data table: toolbar (search with `field:value` chips, filter-panel button, saved
 * views, column chooser, refresh, custom controls; density is global, from the top bar), selection with a batch bar, row
 * primary action (click / Enter) + "More" menu (button or right click), sticky header, client
 * sort, virtual scrolling above `virtualThreshold` rows and a pager slot. Filtering is the
 * consumer's job (it owns the query syntax); the table renders `rows` as given.
 *
 * Fixed head, scrolling body: the column heads and the toolbar row form a head block that never scrolls vertically;
 * only the rows scroll (`.fpc-data-table__scroller`, also the virtual-scroll viewport), the pager stays below. Head and
 * body are two `<table>`s with the same `<colgroup>`: the body lays out its columns (auto layout, incl. an invisible
 * zero-height copy of the head labels), the component measures them (ResizeObserver) and copies the px widths into the
 * head's `<colgroup>` (`table-layout: fixed`), reserves the body's scrollbar width in the head
 * (`--fpc-data-table-gutter`) and mirrors `scrollLeft` both ways. Accessibility: both `<table>`s are
 * `role="presentation"` and every rowgroup / row / columnheader / cell carries its ARIA role, so the wrapper
 * (`role="table"`, `aria-label`, `aria-rowcount`) is one logical table; the sizing copy is `aria-hidden`. Rows of a
 * `fpcDataTableFooter` template without roles get `role="row"` / `"cell"` automatically.
 *
 * The toolbar is the shared `fpc-list-toolbar` strip (3.38 R12): unbordered search lead, `chips` inline,
 * Filters toggle (`showFilterButton`, count `filtersActive` = applied filters) with the
 * `[fpcDataTableFilters]` fields in its drawer (live apply → `filtersApplied`), Clear all (→ `clearChips` +
 * `filtersCleared`), then Views, columns, Refresh and the `[fpcDataTableToolbar]` slot (e.g. the
 * primary Create, rightmost). Slots also: `[fpcDataTableBatch]`, `[fpcDataTableEmpty]`, `[fpcDataTablePager]`.
 *
 * Stacked cards: below 36 rem container width, or always with `stacked` (kanban lanes). Row drag and drop (kanban
 * lanes, `data-table.drag.ts`): with a `dropGroup`, rows are natively draggable (`rowDraggable` locks single rows) and
 * the scrolling body (also when empty) accepts rows from tables of the same group (`dropPredicate`, default: a
 * different `dropData`) → `rowDrop` `{ row, fromData, toData, fromIndex, toIndex }`. A drag never activates the row;
 * drag and drop is off while the table virtualizes (rows above `virtualThreshold`), so lanes raise the threshold.
 * Keyboard users move rows through the consumer's ⋮ menu ("Move to …").
 */
@Component({
  selector: 'fpc-data-table',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NgTemplateOutlet,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcContextMenuComponent,
    FpcDropdownComponent,
    FpcPagerComponent,
    FpcEmptyStateComponent,
    FpcListToolbarComponent,
    FpcSearchFieldComponent,
  ],
  host: {
    class: 'fpc-data-table',
    '[class.fpc-data-table--sticky-head]': 'stickyHeader()',
    '[class.fpc-data-table--sticky-foot]': 'resolvedStickyFooter()',
    '[class.fpc-data-table--nested]': 'nested()',
    '[class.fpc-data-table--stacked]': 'stacked()',
    '[class.fpc-data-table--priorities]': 'columnPriorities()',
    '[class.fpc-data-table--drop-over]': 'dropOver()',
    '[style.--fpc-data-table-lines]': 'stackedLines()',
  },
  templateUrl: './data-table.component.html',
  styleUrl: './data-table.component.scss',
})
export class FpcDataTableComponent<T = unknown> implements OnInit {
  private readonly densityService = inject(FpcDensityService);
  private readonly router = inject(Router, { optional: true });
  private readonly locationStrategy = inject(LocationStrategy, { optional: true });
  private readonly zone = inject(NgZone);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');
  private readonly headFrame = viewChild<ElementRef<HTMLElement>>('headFrame');
  private readonly headScroller = viewChild<ElementRef<HTMLElement>>('headScroller');
  private readonly headTable = viewChild<ElementRef<HTMLTableElement>>('headTable');
  private readonly bodyTable = viewChild<ElementRef<HTMLTableElement>>('bodyTable');
  private readonly sentinel = viewChild<ElementRef<HTMLElement>>('sentinel');

  readonly columns = input<readonly FpcTableColumn<T>[]>([]);
  readonly rows = input<readonly T[]>([]);
  readonly rowId = input<(row: T) => string>((row) => String((row as { id?: unknown }).id ?? ''));
  readonly ariaLabel = input<string | null>(null);
  readonly labels = input<Partial<FpcDataTableLabels>>({});

  // Toolbar
  readonly searchable = input(true, { transform: booleanAttribute });
  readonly query = model('');
  readonly searchPlaceholder = input<string | null>(null);
  readonly chips = input<readonly FpcFilterChip[]>([]);
  readonly showFilterButton = input(false, { transform: booleanAttribute });
  readonly filtersOpen = model(false);
  readonly filtersActive = input(0);
  /** Icon of the default empty state (no rows and nothing narrowing them). */
  readonly emptyIcon = input<string>('inbox');
  /**
   * Whether the rows are narrowed (empty → "No matches" instead of the empty state). Default: a query, a chip or an
   * applied filter; consumers that filter outside the table (page toolbar, server query) pass their own.
   */
  readonly filtered = input<boolean | null>(null);
  /** Syntax help of the search (`kind:`, `status:` …) as the field's tooltip; the placeholder stays `Search <noun>`. */
  readonly searchTitle = input<string | null>(null);
  readonly views = input<readonly FpcTableView[] | null>(null);
  readonly activeViewId = input<string | null>(null);
  readonly showColumnChooser = input(true, { transform: booleanAttribute });
  readonly visibleColumns = model<readonly string[] | null>(null);
  readonly refreshable = input(false, { transform: booleanAttribute });
  readonly loading = input(false, { transform: booleanAttribute });

  // Rows
  readonly selectable = input(false, { transform: booleanAttribute });
  readonly selected = model<readonly string[]>([]);
  /** `single`: radio selection (at most one id in `selected`), see `FpcTableSelectionMode`. */
  readonly selectionMode = input<FpcTableSelectionMode>('multi');
  readonly sort = model<FpcTableSort | null>(null);
  /** `false`: the consumer sorts (server-side lists); the table only reports `sort`. */
  readonly clientSort = input(true, { transform: booleanAttribute });
  readonly rowMenu = input<((row: T) => readonly FpcMenuItem[]) | null>(null);
  readonly rowMark = input<((row: T) => boolean) | null>(null);
  readonly activeRowId = input<string | null>(null);
  /**
   * Kept for compatibility (sets the `fpc-data-table--sticky-head` host class): the column head and toolbar row always
   * sit in a fixed head block outside the scrolling body, whatever the value.
   */
  readonly stickyHeader = input(true, { transform: booleanAttribute });
  /** The `fpcDataTableFooter` row stays at the bottom while rows scroll; `null` = on when a footer exists. */
  readonly stickyFooter = input<boolean | null>(null);
  /** Wide comparisons: the first column stays in view while the table scrolls sideways (3.38 R3). */
  readonly stickyFirstColumn = input(false, { transform: booleanAttribute });
  readonly virtualThreshold = input(200);
  /** Id of the row whose `fpcTableRowDetail` is shown below it (`null`: none; the consumer toggles it on `rowActivate`). */
  readonly expandedRowId = input<string | null>(null);

  // Paging (3.38 D4)
  readonly paging = input<FpcTablePaging>('none');
  /** Current page, 1-based (`[(page)]`); back to 1 when the search, chips, filters or sort change. */
  readonly page = model(1);
  readonly pageSize = model(FPC_DEFAULT_PAGE_SIZE);
  readonly pageSizes = input<readonly number[]>(FPC_PAGE_SIZES);
  /** Server paging: total rows (numbered pages + "x–y of N"); `null` = unknown, then `hasNext` decides. */
  readonly total = input<number | null>(null);
  readonly hasNext = input<boolean | null>(null);
  /** Infinite mode: more rows can be loaded. */
  readonly hasMore = input(false, { transform: booleanAttribute });
  /**
   * Remembers column choice, sort and page size in `localStorage` under this key (apps without saved views; Loadweaver
   * saved views stay an extra).
   */
  readonly persistKey = input<string | null>(null);
  /** Real link of a row (the name column renders an `<a>`, click / Enter navigates; `null` = no link). */
  readonly rowLink = input<((row: T) => string | null) | null>(null);
  /** Group rows (collapsible header with count per group, within the page). */
  readonly groupBy = input<((row: T) => string) | null>(null);
  readonly groupLabel = input<((key: string) => string) | null>(null);
  /** At most 1–2 dominant inline icon actions before the ⋮ menu (emitted as `rowAction`). */
  readonly rowInlineActions = input<((row: T) => readonly FpcMenuItem[]) | null>(null);
  /** Load error: a flush danger alert above the rows (head and toolbar stay). */
  readonly error = input<string | null>(null);
  /** Inside a panel / detail (nested table): auto height, no sticky head. */
  readonly nested = input(false, { transform: booleanAttribute });
  /** Stacked cards whatever the width (kanban lanes); otherwise only below 36 rem container width. */
  readonly stacked = input(false, { transform: booleanAttribute });
  /**
   * Hide priority-2 / -3 columns in narrow tables (D2) instead of scrolling sideways. Off by default (2026-10-30): all
   * shown columns stay and the table scrolls with the head's overflow chevrons; the column chooser picks columns.
   */
  readonly columnPriorities = input(false, { transform: booleanAttribute });

  // Row drag and drop (kanban lanes; `data-table.drag.ts`)
  /** Tables of one group accept each other's rows; `null` = no drag and drop. */
  readonly dropGroup = input<string | null>(null);
  /** This table's lane (status, id), reported as `fromData` / `toData`. */
  readonly dropData = input<unknown>(null);
  /** Which rows can be dragged (`false` / a predicate locks rows); only with a `dropGroup`. */
  readonly rowDraggable = input<boolean | ((row: T) => boolean)>(true);
  /** Whether this table accepts the dragged row; default: rows from a table with a different `dropData`. */
  readonly dropPredicate = input<FpcTableDropPredicate<T> | null>(null);

  readonly rowActivate = output<T>();
  readonly rowAction = output<FpcTableRowActionEvent<T>>();
  readonly removeChip = output<FpcFilterChip>();
  readonly clearChips = output<void>();
  /** Apply in the filter drawer: copy the consumer's draft filters to the applied ones. */
  readonly filtersApplied = output<void>();
  /** Clear all: reset the applied filters (`clearChips` fires too). */
  readonly filtersCleared = output<void>();
  readonly viewSelect = output<FpcTableView>();
  readonly viewSave = output<void>();
  readonly viewDelete = output<FpcTableView>();
  readonly refresh = output<void>();
  /** Infinite mode: the end of the rows came into view (fires once per loaded length). */
  readonly loadMore = output<void>();
  /** A row of this group was dropped on this table. */
  readonly rowDrop = output<FpcTableRowDropEvent<T>>();

  private readonly cellDirectives = contentChildren(FpcTableCellDirective);
  private readonly footerDirective = contentChildren(FpcDataTableFooterDirective);
  private readonly detailDirective = contentChildren(FpcTableRowDetailDirective);
  /** The projected `fpcTableRowDetail` template, if any. */
  protected readonly detailTemplate = computed(() => this.detailDirective()[0]?.template ?? null);
  /** The projected `fpcDataTableFooter` template (rendered in `<tfoot>`), if any. */
  protected readonly footerTemplate = computed(() => this.footerDirective()[0]?.template ?? null);
  /** `stickyFooter` unset: sticky whenever a footer row exists. */
  protected readonly resolvedStickyFooter = computed(() => !!this.footerTemplate() && (this.stickyFooter() ?? true));
  protected readonly cellTemplates = computed(
    () => new Map(this.cellDirectives().map((directive) => [directive.column(), directive.template] as const)),
  );

  private readonly appLabels = inject(FPC_DATA_TABLE_DEFAULT_LABELS);
  protected readonly text = computed<FpcDataTableLabels>(() => ({
    ...FPC_DATA_TABLE_LABELS,
    ...this.appLabels,
    ...this.labels(),
  }));
  protected readonly shownColumns = computed(() => fpcVisibleColumns(this.columns(), this.visibleColumns()));
  protected readonly shownIds = computed(() => new Set(this.shownColumns().map((column) => column.id)));
  readonly sortedRows = computed(() =>
    this.clientSort() ? fpcSortRows(this.rows(), this.columns(), this.sort()) : this.rows(),
  );
  /** The rows of the current page (client paging slices; other modes show `rows`). */
  readonly pageRows = computed(() =>
    this.paging() === 'client' ? fpcPageSlice(this.sortedRows(), this.page(), this.pageSize()) : this.sortedRows(),
  );
  protected readonly pagerTotal = computed(() => {
    if (this.paging() === 'client') return this.sortedRows().length;

    return this.paging() === 'server' ? this.total() : null;
  });
  /**
   * The pager only shows when there is more than one page at the smallest page size (DB-14d, 2026-10-29): a list that
   * fits one page needs no "1–3 of 3" strip; from the smallest size up it stays, so a larger chosen size can be undone.
   * An empty first page never shows it (X-12, round 2: an empty server table with a stale `hasNext` showed "‹ 1 ›" +
   * the size select under its empty state); later pages keep it, so the user can page back.
   */
  protected readonly showPager = computed(() => {
    const paging = this.paging();
    const sizes = this.pageSizes();
    const threshold = sizes.length > 0 ? Math.min(...sizes) : (this.pageSize() ?? FPC_DEFAULT_PAGE_SIZE);

    if (this.page() <= 1 && this.rows().length === 0) return false;

    if (this.page() > 1) return paging === 'client' || paging === 'server';
    if (paging === 'client') return this.sortedRows().length > threshold;
    if (paging === 'server') {
      if (this.hasNext()) return true;

      const total = this.total();

      return total !== null ? total > threshold : this.rows().length >= threshold;
    }

    return false;
  });
  protected readonly stateColumn = computed(
    () => this.shownColumns().find((column) => column.type === 'state') ?? null,
  );
  /** The name column: the first one that is not the State column. */
  protected readonly leadColumnId = computed(
    () => this.shownColumns().find((column) => column.type !== 'state')?.id ?? null,
  );
  /** Text lines of a stacked card: the name + the shown priority-1 fields (side cells span them). */
  protected readonly stackedLines = computed(
    () =>
      1 +
      this.shownColumns().filter(
        (column) => column.priority === 1 && column.type !== 'state' && column.id !== this.leadColumnId(),
      ).length,
  );
  private readonly collapsedGroups = signal<ReadonlySet<string>>(new Set());
  protected readonly selectedSet = computed(() => new Set(this.selected()));
  /** Single selection: radio buttons in the selection column. */
  protected readonly single = computed(() => this.selectable() && this.selectionMode() === 'single');
  /** The radio group name of a single-selection table (one per table instance). */
  protected readonly radioName = `fpc-data-table-select-${++fpcDataTableSeq}`;
  protected readonly allSelected = computed(() => {
    const rows = this.pageRows();

    return rows.length > 0 && rows.every((row) => this.selectedSet().has(this.rowId()(row)));
  });
  protected readonly someSelected = computed(() => this.selected().length > 0 && !this.allSelected());
  protected readonly selectedText = computed(() =>
    this.text().selected.replace('{count}', String(this.selected().length)),
  );
  protected readonly compact = computed(() => this.densityService.density() === 'compact');
  protected readonly rowHeight = computed(() => ROW_HEIGHT[this.densityService.density()]);
  /**
   * The column chooser moves into the head's trailing cell when it would be the toolbar's only control (no search,
   * filters, chips, views or refresh — the page owns its own list toolbar above): no extra toolbar row for one button.
   */
  protected readonly chooserInHeader = computed(
    () =>
      this.showColumnChooser() &&
      !this.searchable() &&
      !this.showFilterButton() &&
      this.chips().length === 0 &&
      !this.views() &&
      !this.refreshable(),
  );
  protected readonly narrowed = computed(
    () => this.filtered() ?? (!!this.query().trim() || this.chips().length > 0 || this.filtersActive() > 0),
  );
  protected readonly trailingColumn = computed(
    () => !!this.rowMenu() || !!this.rowInlineActions() || this.chooserInHeader(),
  );
  protected readonly colspan = computed(
    () => this.shownColumns().length + (this.selectable() ? 1 : 0) + (this.trailingColumn() ? 1 : 0),
  );

  private readonly scrollTop = signal(0);
  private readonly viewportHeight = signal(600);
  protected readonly virtual = computed(
    () =>
      this.pageRows().length > this.virtualThreshold() &&
      !this.groupBy() &&
      !(this.detailTemplate() && this.expandedRowId() !== null),
  );
  protected readonly window = computed(() => {
    const total = this.pageRows().length;

    if (!this.virtual()) return { start: 0, end: total };

    return fpcVirtualWindow(this.scrollTop(), this.viewportHeight(), this.rowHeight(), total, 10);
  });
  protected readonly renderedRows = computed(() => {
    const { start, end } = this.window();

    return this.pageRows().slice(start, end);
  });
  /** Body entries: rows, or group headers + the rows of expanded groups. */
  protected readonly entries = computed<FpcTableEntry<T>[]>(() => {
    const groupBy = this.groupBy();
    const rows = this.renderedRows();

    if (!groupBy) return rows.map((row) => ({ kind: 'row', row }));

    const groups = new Map<string, T[]>();

    for (const row of rows) {
      const key = groupBy(row);
      const list = groups.get(key);

      if (list) list.push(row);
      else groups.set(key, [row]);
    }

    const collapsed = this.collapsedGroups();
    const label = this.groupLabel();
    const entries: FpcTableEntry<T>[] = [];

    for (const [key, list] of groups) {
      const closed = collapsed.has(key);

      entries.push({ kind: 'group', key, label: label ? label(key) : key, count: list.length, collapsed: closed });
      if (!closed) for (const row of list) entries.push({ kind: 'row', row });
    }

    return entries;
  });
  /** Drag and drop needs a group and every row in the DOM (no virtual window). */
  protected readonly dragEnabled = computed(() => !!this.dropGroup() && !this.virtual());
  /** Id of this table's row being dragged (rendered as the placeholder). */
  protected readonly dragRowId = signal<string | null>(null);
  /** A row this table accepts is over the body. */
  protected readonly dropOver = signal(false);
  /** A click right after a drag ended (browsers may emit one) does not activate the row. */
  private suppressClickUntil = 0;
  protected readonly padTop = computed(() => this.window().start * this.rowHeight());
  protected readonly padBottom = computed(() => (this.pageRows().length - this.window().end) * this.rowHeight());
  protected readonly rowCount = computed(() => {
    const total = this.pagerTotal();

    return (total ?? this.pageRows().length) + 1;
  });
  protected readonly skeleton = computed(() =>
    this.loading() && this.pageRows().length === 0 && !this.error() ? [0, 1, 2, 3, 4] : [],
  );
  protected readonly loadingMore = computed(
    () => this.paging() === 'infinite' && this.loading() && this.rows().length > 0,
  );

  protected readonly menuItems = signal<readonly FpcMenuItem[]>([]);
  protected readonly menuPosition = signal<FpcContextMenuPosition | null>(null);
  private menuRow: T | null = null;

  private persistLoaded = false;
  private lastNarrowKey: string | null = null;
  /** What narrows / orders the rows (a change → page 1). */
  private readonly narrowKey = computed(() =>
    JSON.stringify([this.query(), this.chips().length, this.filtersActive(), this.sort(), this.pageSize()]),
  );
  private lastLoadMoreLength = -1;
  private sentinelVisible = false;
  /** Watches the body's sizer cells, body table and scroller; re-syncs the head's column widths / gutter. */
  private columnObserver: ResizeObserver | null = null;
  private observedCells: readonly Element[] = [];
  private observedScroller: Element | null = null;
  /** Widths of the sticky first / trailing columns the body scrolls under (covered at either side). */
  private stickyLead = 0;
  private stickyTrail = 0;

  constructor() {
    // Back to page 1 when what narrows / orders the rows changes (not on the first run).
    effect(() => {
      const key = this.narrowKey();

      if (this.lastNarrowKey === null || key === this.lastNarrowKey) {
        this.lastNarrowKey = key;
        return;
      }
      this.lastNarrowKey = key;
      if (untracked(this.page) !== 1) this.page.set(1);
    });

    // Client paging: stay within the pages that exist (rows removed, filtered locally).
    effect(() => {
      if (this.paging() !== 'client') return;

      const last = fpcPageCount(this.sortedRows().length, this.pageSize());

      if (untracked(this.page) > last) this.page.set(last);
    });

    // Persist column choice, sort and page size.
    effect(() => {
      const key = this.persistKey();
      const state: FpcTablePersisted = {
        columns: this.visibleColumns(),
        sort: this.sort(),
        pageSize: this.pageSize(),
      };

      if (!key || !this.persistLoaded) return;
      try {
        localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(state));
      } catch {
        // Storage unavailable (private mode / quota): the table works without it.
      }
    });

    // Infinite mode: rows shrank (new search / filter) → allow the next load; still at the end after a load → load on.
    effect(() => {
      const length = this.rows().length;
      const loading = this.loading();

      if (length < this.lastLoadMoreLength) this.lastLoadMoreLength = -1;
      if (!loading) untracked(() => this.maybeLoadMore());
    });

    const destroyRef = inject(DestroyRef);
    let observer: IntersectionObserver | null = null;

    effect(() => {
      const sentinel = this.sentinel()?.nativeElement;
      const root = this.scroller()?.nativeElement;

      observer?.disconnect();
      observer = null;
      if (!sentinel || !root || typeof IntersectionObserver === 'undefined') return;

      this.zone.runOutsideAngular(() => {
        observer = new IntersectionObserver(
          (entries) => {
            this.sentinelVisible = entries.some((entry) => entry.isIntersecting);
            if (this.sentinelVisible) this.zone.run(() => this.maybeLoadMore());
          },
          { root, rootMargin: '0px 0px 200px 0px' },
        );
        observer.observe(sentinel);
      });
    });
    destroyRef.onDestroy(() => observer?.disconnect());

    // Fixed head: horizontal scrolling of the head (focus moving into a clipped head cell, a sideways wheel / trackpad
    // gesture over it) drives the body; the body's own scroll mirrors back in `onScroll`. Outside Angular (no change
    // detection per event).
    effect((onCleanup) => {
      const head = this.headScroller()?.nativeElement;

      if (!head) return;

      // Only a user's focus moving into a clipped head cell drives the body. The head's scroll events in general don't:
      // most are echoes of the body being mirrored in, or the browser clamping it while `syncHead` rewrites its column
      // widths — writing those back cancelled smooth scrolls and kept the body a few px off its end (user, 2026-10-30).
      const onHeadFocus = (): void =>
        void requestAnimationFrame(() => {
          const body = this.scroller()?.nativeElement;

          if (body && body.scrollLeft !== head.scrollLeft) body.scrollLeft = head.scrollLeft;
        });
      const onHeadWheel = (event: WheelEvent): void => {
        const body = this.scroller()?.nativeElement;

        if (body && event.deltaX && Math.abs(event.deltaX) > Math.abs(event.deltaY)) body.scrollLeft += event.deltaX;
      };

      this.zone.runOutsideAngular(() => {
        head.addEventListener('focusin', onHeadFocus);
        head.addEventListener('wheel', onHeadWheel, { passive: true });
      });
      onCleanup(() => {
        head.removeEventListener('focusin', onHeadFocus);
        head.removeEventListener('wheel', onHeadWheel);
      });
    });

    // After every render: label footer rows for the logical ARIA table and (re)attach the column observer when the
    // body's sizer cells changed (columns shown / hidden, selection or trailing column toggled).
    afterEveryRender(() => this.trackColumns());
    destroyRef.onDestroy(() => this.columnObserver?.disconnect());
  }

  ngOnInit(): void {
    const key = this.persistKey();

    if (!key) {
      this.persistLoaded = true;
      return;
    }

    // After this check: restoring two-way models (`[(pageSize)]`, `[(sort)]`) inside the first check would change the
    // parent's bindings after they were checked.
    queueMicrotask(() => this.restore(key));
  }

  private restore(key: string): void {
    {
      try {
        const raw = localStorage.getItem(STORAGE_PREFIX + key);
        const saved = raw ? (JSON.parse(raw) as FpcTablePersisted) : null;

        if (saved?.columns !== undefined && this.visibleColumns() === null) this.visibleColumns.set(saved.columns);
        if (saved?.sort !== undefined) this.sort.set(saved.sort);
        if (saved?.pageSize && this.pageSizes().includes(saved.pageSize)) this.pageSize.set(saved.pageSize);
        // Restored preferences are not a user change: keep the page (e.g. from the URL).
        this.lastNarrowKey = untracked(this.narrowKey);
      } catch {
        // Unreadable entry: defaults.
      }
    }

    this.persistLoaded = true;
  }

  private maybeLoadMore(): void {
    if (this.paging() !== 'infinite' || !this.hasMore() || this.loading() || !this.sentinelVisible) return;

    const length = this.rows().length;

    if (length === this.lastLoadMoreLength) return;

    this.lastLoadMoreLength = length;
    this.loadMore.emit();
  }

  protected value(column: FpcTableColumn<T>, row: T): FpcTableCellValue {
    return column.value ? column.value(row) : null;
  }

  protected stateOf(column: FpcTableColumn<T>, row: T): (FpcTableState & { icon: string }) | null {
    const state = column.state?.(row);

    return state ? { ...state, icon: state.icon ?? FPC_TABLE_STATE_ICON[state.tone] } : null;
  }

  protected cellClass(column: FpcTableColumn<T>): string {
    const classes = [`text-${column.align ?? 'start'}`, `fpc-data-table__cell--p${column.priority ?? 2}`];

    if (column.type === 'state') classes.push('fpc-data-table__cell--state');
    if (column.type === 'state' && column.iconOnly !== false) classes.push('fpc-data-table__cell--state-icon');
    if (column.id === this.leadColumnId()) classes.push('fpc-data-table__cell--lead');

    return classes.join(' ');
  }

  protected linkOf(row: T): string | null {
    return this.rowLink()?.(row) ?? null;
  }

  protected hrefOf(link: string): string {
    return this.locationStrategy ? this.locationStrategy.prepareExternalUrl(link) : link;
  }

  protected onLinkClick(link: string, event: MouseEvent): void {
    // Modified clicks (new tab / window) keep the browser's behaviour.
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || !this.router) return;

    event.preventDefault();
    void this.router.navigateByUrl(link);
  }

  protected toggleGroup(key: string): void {
    const next = new Set(this.collapsedGroups());

    if (next.has(key)) next.delete(key);
    else next.add(key);
    this.collapsedGroups.set(next);
  }

  protected isSortable(column: FpcTableColumn<T>): boolean {
    return column.sortable ?? (!!column.value || (column.type === 'state' && !!column.state));
  }

  protected ariaSort(column: FpcTableColumn<T>): string | null {
    const sort = this.sort();

    if (!this.isSortable(column)) return null;
    if (sort?.column !== column.id) return 'none';

    return sort.direction === 'asc' ? 'ascending' : 'descending';
  }

  protected onSortClick(column: FpcTableColumn<T>): void {
    if (this.isSortable(column)) this.sort.set(fpcNextSort(this.sort(), column.id));
  }

  protected onScroll(): void {
    const element = this.scroller()?.nativeElement;

    if (!element) return;

    const head = this.headScroller()?.nativeElement;

    if (head && head.scrollLeft !== element.scrollLeft) head.scrollLeft = element.scrollLeft;

    this.syncOverflow(false);
    this.scrollTop.set(element.scrollTop);
    this.viewportHeight.set(element.clientHeight || 600);
  }

  /**
   * Head overflow indicator click: reveals the next cut-off column that way (column-wise, user 2026-10-30), scrolling
   * the body smoothly like the step strip's chevrons (the head mirrors it). Sticky columns are no candidates and their
   * widths count as covered.
   */
  protected pageColumns(direction: -1 | 1): void {
    const body = this.scroller()?.nativeElement;
    const table = this.bodyTable()?.nativeElement;

    if (!body || !table) return;

    const columns = this.scrollableColumns().map((cell) => ({
      left: cell.offsetLeft,
      right: cell.offsetLeft + cell.offsetWidth,
    }));

    fpcScrollToLeft(body, fpcScrollColumnTarget(body, columns, direction, this.stickyLead, this.stickyTrail), true);
  }

  /** The body's sizer cells of the columns that scroll sideways (shown, not the sticky first / trailing ones). */
  private scrollableColumns(): HTMLElement[] {
    const table = this.bodyTable()?.nativeElement;

    if (!table) return [];

    const cells = this.sizerCells(table);
    const sticky = new Set<HTMLElement>();

    if (table.classList.contains('fpc-table--sticky-first') && cells[0]) sticky.add(cells[0]);
    const lastCell = cells[cells.length - 1];

    if (lastCell?.classList.contains('fpc-data-table__more')) sticky.add(lastCell);

    return cells.filter((cell) => !sticky.has(cell) && cell.offsetWidth > 0);
  }

  protected isSelected(row: T): boolean {
    return this.selectedSet().has(this.rowId()(row));
  }

  protected toggleRow(row: T): void {
    const id = this.rowId()(row);

    if (this.single()) {
      // Radio semantics: selecting is idempotent, nothing deselects.
      if (this.selected().length !== 1 || this.selected()[0] !== id) this.selected.set([id]);

      return;
    }

    this.selected.set(
      this.selectedSet().has(id) ? this.selected().filter((entry) => entry !== id) : [...this.selected(), id],
    );
  }

  protected toggleAll(): void {
    this.selected.set(this.allSelected() ? [] : this.pageRows().map((row) => this.rowId()(row)));
  }

  protected clearSelection(): void {
    this.selected.set([]);
  }

  protected onRowClick(row: T, event: MouseEvent): void {
    const target = event.target as HTMLElement;

    if (target.closest('input, button, a, [fpcTableStop]')) return;
    if (fpcNow() < this.suppressClickUntil) return;

    // Single selection: a click picks the row (Enter / double click pick and activate).
    if (this.single()) {
      this.toggleRow(row);

      return;
    }

    this.activate(row);
  }

  protected onRowDblClick(row: T, event: MouseEvent): void {
    if (!this.single()) return;
    if ((event.target as HTMLElement).closest('button, a, [fpcTableStop]')) return;

    this.toggleRow(row);
    this.activate(row);
  }

  /** Accessible name of a row's radio / check box: the lead column's value, else the generic "Select row". */
  protected rowLabel(row: T): string {
    const lead = this.shownColumns().find((column) => column.id === this.leadColumnId());
    const value = lead ? fpcColumnValue(lead, row) : null;

    return value === null || value === undefined || value === '' ? this.text().selectRow : String(value);
  }

  private activate(row: T): void {
    const link = this.linkOf(row);

    if (link && this.router) void this.router.navigateByUrl(link);
    this.rowActivate.emit(row);
  }

  private focusRow(current: HTMLElement, target: 'next' | 'previous' | 'first' | 'last'): void {
    const rows = Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>('tbody > tr.fpc-data-table__row'));
    const index = rows.indexOf(current);
    const next =
      target === 'first'
        ? rows[0]
        : target === 'last'
          ? rows[rows.length - 1]
          : rows[index + (target === 'next' ? 1 : -1)];

    next?.focus();
  }

  protected onRowKeydown(row: T, event: KeyboardEvent): void {
    if (event.target !== event.currentTarget) return;

    const keys: Record<string, 'next' | 'previous' | 'first' | 'last'> = {
      ArrowDown: 'next',
      ArrowUp: 'previous',
      Home: 'first',
      End: 'last',
    };

    if (keys[event.key]) {
      event.preventDefault();
      this.focusRow(event.currentTarget as HTMLElement, keys[event.key]);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (this.single()) this.toggleRow(row);
      this.activate(row);
    } else if (event.key === ' ' && this.selectable()) {
      event.preventDefault();
      this.toggleRow(row);
    } else if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      event.preventDefault();
      this.openMenu(row, rect.left + 24, rect.bottom);
    }
  }

  protected onRowContextMenu(row: T, event: MouseEvent): void {
    if (!this.rowMenu()) return;

    event.preventDefault();
    this.openMenu(row, event.clientX, event.clientY);
  }

  protected onMoreClick(row: T, event: MouseEvent): void {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.openMenu(row, rect.right - 192, rect.bottom);
  }

  protected onMenuSelect(item: FpcMenuItem): void {
    if (this.menuRow !== null) this.rowAction.emit({ row: this.menuRow, item });
  }

  protected canDrag(row: T): boolean {
    if (!this.dragEnabled()) return false;

    const draggable = this.rowDraggable();

    return typeof draggable === 'function' ? draggable(row) : draggable;
  }

  protected onRowDragStart(row: T, event: DragEvent): void {
    const group = this.dropGroup();

    if (!group || !this.canDrag(row)) {
      event.preventDefault();

      return;
    }

    const id = this.rowId()(row);
    const element = event.currentTarget as HTMLElement | null;

    fpcSetActiveTableDrag({
      group,
      row,
      fromData: this.dropData(),
      fromIndex: this.pageRows().indexOf(row),
      source: this,
      end: () => this.endDrag(),
    });
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', id);
    }
    // The browser snapshots the row after this handler as the drag image: an opaque stacked card for that moment, then
    // the row in place becomes the dimmed placeholder.
    element?.classList.add('fpc-data-table__row--drag-preview');
    setTimeout(() => {
      element?.classList.remove('fpc-data-table__row--drag-preview');
      if (fpcActiveTableDrag()?.source === this) this.dragRowId.set(id);
    }, 0);
  }

  protected onRowDragEnd(): void {
    if (fpcActiveTableDrag()?.source === this) fpcSetActiveTableDrag(null);
    this.endDrag();
  }

  private endDrag(): void {
    this.dragRowId.set(null);
    this.dropOver.set(false);
    this.suppressClickUntil = fpcNow() + 200;
  }

  /** The active drag if this table accepts it. */
  private acceptedDrag() {
    const drag = fpcActiveTableDrag();

    if (!drag || !this.dragEnabled() || drag.group !== this.dropGroup()) return null;

    const predicate = (this.dropPredicate() ?? fpcDefaultDropPredicate) as FpcTableDropPredicate;

    return predicate({ row: drag.row, fromData: drag.fromData, toData: this.dropData() }) ? drag : null;
  }

  protected onDropZoneDragOver(event: DragEvent): void {
    if (!this.acceptedDrag()) return;

    // Accepting: the default (no drop) is cancelled.
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    if (!this.dropOver()) this.dropOver.set(true);
  }

  protected onDropZoneDragLeave(event: DragEvent): void {
    const related = event.relatedTarget as Node | null;
    const zone = event.currentTarget as HTMLElement | null;

    if (related && zone?.contains(related)) return;
    if (this.dropOver()) this.dropOver.set(false);
  }

  protected onDropZoneDrop(event: DragEvent): void {
    const drag = this.acceptedDrag();

    this.dropOver.set(false);
    if (!drag) return;

    event.preventDefault();

    const rows = Array.from(
      this.bodyTable()?.nativeElement.querySelectorAll<HTMLElement>(':scope > tbody > tr.fpc-data-table__row') ?? [],
    ).map((element) => element.getBoundingClientRect());

    fpcSetActiveTableDrag(null);
    drag.end();
    this.suppressClickUntil = fpcNow() + 200;
    this.rowDrop.emit({
      row: drag.row as T,
      fromData: drag.fromData,
      toData: this.dropData(),
      fromIndex: drag.fromIndex,
      toIndex: fpcDropIndex(rows, event.clientY),
    });
  }

  protected toggleColumn(column: FpcTableColumn<T>): void {
    if (column.required) return;

    const ids = this.shownColumns().map((entry) => entry.id);
    const next = ids.includes(column.id) ? ids.filter((id) => id !== column.id) : [...ids, column.id];
    const order = this.columns().map((entry) => entry.id);

    this.visibleColumns.set(order.filter((id) => next.includes(id)));
  }

  protected onClearAll(): void {
    this.clearChips.emit();
    this.filtersCleared.emit();
  }

  protected trackRow = (_: number, row: T): string => this.rowId()(row);
  protected trackEntry = (_: number, entry: FpcTableEntry<T>): string =>
    entry.kind === 'group' ? `group:${entry.key}` : this.rowId()(entry.row);
  protected readonly columnValue = fpcColumnValue;

  /** The body's column-sizer cells (first row of its aria-hidden `<thead>`), one per column. */
  private sizerCells(body: HTMLTableElement): HTMLElement[] {
    return Array.from(body.tHead?.rows[0]?.cells ?? []);
  }

  private trackColumns(): void {
    this.labelFooterRows();

    const body = this.bodyTable()?.nativeElement;
    const scroller = this.scroller()?.nativeElement;

    if (!body || !scroller || typeof ResizeObserver === 'undefined') return;

    const cells = this.sizerCells(body);
    const unchanged =
      scroller === this.observedScroller &&
      cells.length === this.observedCells.length &&
      cells.every((cell, index) => cell === this.observedCells[index]);

    if (unchanged) return;

    // Each `observe` reports once right away, so a new column set syncs on the next frame.
    this.columnObserver ??= this.zone.runOutsideAngular(
      () =>
        new ResizeObserver(() => {
          this.syncHead();
          this.syncOverflow(true);
        }),
    );
    this.columnObserver.disconnect();
    this.columnObserver.observe(scroller);
    this.columnObserver.observe(body);
    for (const cell of cells) this.columnObserver.observe(cell);
    this.observedCells = cells;
    this.observedScroller = scroller;
  }

  /**
   * Copies the body's column widths (sizer cells, px) into the head's `<colgroup>`, gives the head table the body's
   * width (`table-layout: fixed` from then on), reserves the body's vertical scrollbar width in the head and realigns
   * `scrollLeft`. Writes styles directly (no change detection); only the head changes, so the observer never loops.
   */
  private syncHead(): void {
    const head = this.headTable()?.nativeElement;
    const body = this.bodyTable()?.nativeElement;
    const scroller = this.scroller()?.nativeElement;

    if (!head || !body || !scroller) return;

    this.host.nativeElement.style.setProperty(
      '--fpc-data-table-gutter',
      `${Math.max(0, scroller.offsetWidth - scroller.clientWidth)}px`,
    );

    const cells = this.sizerCells(body);
    const cols = Array.from(head.querySelectorAll<HTMLElement>(':scope > colgroup > col'));
    const tableWidth = body.getBoundingClientRect().width;

    // Column sets differ for one render (the observer catches up) or the table is not laid out (hidden tab).
    if (cells.length !== cols.length || tableWidth === 0) return;

    // Stacked cards hide the sizer (all 0): keep the last widths; the head is hidden then anyway.
    const widths = cells.map((cell) => cell.getBoundingClientRect().width);

    if (widths.every((width) => width === 0)) return;

    // Priority columns hidden by the container query (`display: none` cells) keep their `<col>`, and the fixed head
    // layout assigns cols by position: the shown cells take the first cols in order, the rest get 0 (otherwise the
    // shown heads land on the hidden columns' 0 px and overlap, e.g. narrow lanes).
    const shown = cells
      .map((cell, index) => ({ cell, width: widths[index] }))
      .filter(({ cell }) => getComputedStyle(cell).display !== 'none');

    cols.forEach((col, index) => (col.style.width = `${shown[index]?.width ?? 0}px`));
    head.style.width = `${tableWidth}px`;
    head.classList.add('fpc-data-table__table--measured');

    const headScroller = this.headScroller()?.nativeElement;

    if (headScroller && headScroller.scrollLeft !== scroller.scrollLeft) headScroller.scrollLeft = scroller.scrollLeft;

    this.syncStateAxis(head, headScroller?.scrollLeft ?? 0);
  }

  /**
   * Leading axis: the toolbar's search magnifier sits on the same vertical axis as the first column's marks: the
   * selection check boxes when the table is selectable, otherwise the icon-only state glyphs (head + row badges).
   * Publishes that centre, measured from the search strip's start at scroll 0, as `--fpc-data-table-state-axis` (read
   * by `fpc-search-field`); without either column (or while the head is hidden, e.g. stacked cards) the search keeps
   * its default inset.
   */
  private syncStateAxis(head: HTMLTableElement, scrollLeft: number): void {
    const hostEl = this.host.nativeElement;
    const glyph =
      head.querySelector<HTMLElement>('.fpc-data-table__check .form-check-input') ??
      head.querySelector<HTMLElement>('.fpc-data-table__cell--state-icon .fpc-data-table__state-head > .bi');
    const strip = hostEl.querySelector<HTMLElement>('.fpc-data-table__search .search-input-container');
    const glyphRect = glyph?.getBoundingClientRect();

    if (!glyphRect || !strip || glyphRect.width === 0) {
      hostEl.classList.remove('fpc-data-table--state-axis');
      hostEl.style.removeProperty('--fpc-data-table-state-axis');

      return;
    }

    const axis = glyphRect.left + glyphRect.width / 2 + scrollLeft - strip.getBoundingClientRect().left;

    hostEl.style.setProperty('--fpc-data-table-state-axis', `${Math.max(0, axis)}px`);
    hostEl.classList.add('fpc-data-table--state-axis');
  }

  /**
   * Head overflow indicators: toggles `--more-start` / `--more-end` on the head frame while the body overflows
   * sideways and has more columns that way (1px slack, LTR). With `measure`, also publishes the widths of the sticky
   * first / trailing head cells (`--fpc-data-table-overflow-start` / `-end`), so the indicators sit inside them instead
   * of covering them. Direct DOM writes (scroll / resize), no change detection.
   */
  private syncOverflow(measure: boolean): void {
    const frame = this.headFrame()?.nativeElement;
    const body = this.scroller()?.nativeElement;

    if (!frame || !body) return;

    if (measure) {
      const head = this.headTable()?.nativeElement;
      const cells = Array.from(head?.tHead?.rows[0]?.cells ?? []);
      const first = head?.classList.contains('fpc-table--sticky-first') ? cells[0] : undefined;
      const last = cells[cells.length - 1];
      const lead = first?.getBoundingClientRect().width ?? 0;
      const trail = last?.classList.contains('fpc-data-table__more') ? last.getBoundingClientRect().width : 0;

      frame.style.setProperty('--fpc-data-table-overflow-start', `${lead}px`);
      frame.style.setProperty('--fpc-data-table-overflow-end', `${trail}px`);
      this.stickyLead = lead;
      this.stickyTrail = trail;
    }

    const edges = fpcScrollEdges(body);
    // The ends come from the content, not from `scrollWidth`: a sticky trailing column (⋮ / inline actions) keeps its
    // end padding clipped, so the scroll width counts a few px the body can never reach — `scrollLeft` never got to
    // "the end" and the right chevron stayed (user, 2026-10-30). More that way = a scrollable column still reaches
    // under the sticky column (or past the scrollport's edge without one), measured where those actually are.
    const columns = this.scrollableColumns();
    const table = this.bodyTable()?.nativeElement;
    const cells = table ? this.sizerCells(table) : [];
    const view = body.getBoundingClientRect();
    const leadCell = table?.classList.contains('fpc-table--sticky-first') ? cells[0] : undefined;
    const lastCell = cells[cells.length - 1];
    const trailCell = lastCell?.classList.contains('fpc-data-table__more') ? lastCell : undefined;
    const startEdge = leadCell ? leadCell.getBoundingClientRect().right : view.left;
    const endEdge = trailCell ? trailCell.getBoundingClientRect().left : view.left + body.clientWidth;
    const first = columns[0]?.getBoundingClientRect();
    const last = columns[columns.length - 1]?.getBoundingClientRect();
    const moreStart = first ? first.left < startEdge - FPC_EDGE_PX : !edges.atStart;
    const moreEnd = last ? last.right > endEdge + FPC_EDGE_PX : !edges.atEnd;

    frame.classList.toggle('fpc-data-table__head-frame--more-start', edges.overflowing && moreStart);
    frame.classList.toggle('fpc-data-table__head-frame--more-end', edges.overflowing && moreEnd);
  }

  /** Footer rows come from the consumer's template; without explicit roles they would be presentational. */
  private labelFooterRows(): void {
    const foot = this.bodyTable()?.nativeElement.tFoot;

    if (!foot) return;

    for (const row of Array.from(foot.rows)) {
      if (!row.hasAttribute('role')) row.setAttribute('role', 'row');
      for (const cell of Array.from(row.cells)) {
        if (!cell.hasAttribute('role')) cell.setAttribute('role', cell.tagName === 'TH' ? 'rowheader' : 'cell');
      }
    }
  }

  private openMenu(row: T, x: number, y: number): void {
    const items = this.rowMenu()?.(row) ?? [];

    if (items.length === 0) return;

    this.menuRow = row;
    this.menuItems.set(items);
    this.menuPosition.set({ x: Math.max(8, x), y });
  }
}

function fpcNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
