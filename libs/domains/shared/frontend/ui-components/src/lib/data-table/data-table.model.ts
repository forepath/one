import { type EnvironmentProviders, InjectionToken, makeEnvironmentProviders } from '@angular/core';

import type { FpcBadgeTone } from '../badge/badge.component';

export type FpcTableCellValue = string | number | boolean | null | undefined;

/** A row's state for the State column (3.38 D1 / D7): icon + tone + human-readable label. */
export interface FpcTableState {
  /** Translated, human-readable label (title + aria-label of the icon badge). */
  label: string;
  tone: FpcBadgeTone;
  /** Bootstrap icon without `bi-`; default per tone. */
  icon?: string;
  /** Sort rank (lower = more severe, first in ascending order); default per tone. */
  severity?: number;
}

/** Default icon / severity per tone (danger first). */
export const FPC_TABLE_STATE_ICON: Record<FpcBadgeTone, string> = {
  danger: 'x-circle-fill',
  warning: 'exclamation-triangle-fill',
  info: 'info-circle-fill',
  primary: 'arrow-repeat',
  neutral: 'dash-circle',
  success: 'check-circle-fill',
  dark: 'circle-fill',
};

export const FPC_TABLE_STATE_SEVERITY: Record<FpcBadgeTone, number> = {
  danger: 0,
  warning: 1,
  primary: 2,
  info: 3,
  neutral: 4,
  dark: 5,
  success: 6,
};

/**
 * Column priority: 1 = also on phones (stacked card). 2 / 3 only matter with the table's opt-in `columnPriorities`
 * (2 = hidden in narrow tables, 3 = only in wide tables); by default narrow tables scroll sideways instead.
 */
export type FpcTableColumnPriority = 1 | 2 | 3;

/** One column of `fpc-data-table`. Rich cells use `<ng-template fpcTableCell="<id>" let-row let-value="value">`. */
export interface FpcTableColumn<T = unknown> {
  id: string;
  label: string;
  /** Display / sort value; omit for template-only columns. */
  value?: (row: T) => FpcTableCellValue;
  /** Defaults to `true` when `value` is set. */
  sortable?: boolean;
  /** CSS width (`8rem`, `20%`). */
  width?: string;
  align?: 'start' | 'center' | 'end';
  /** Hidden until chosen in the column chooser. */
  hidden?: boolean;
  /** Cannot be hidden (the name column). */
  required?: boolean;
  mono?: boolean;
  /**
   * `state`: the fixed narrow State column (first column; `state(row)` → square icon badge with the label as tooltip,
   * sorted by severity, required). `iconOnly: false` shows icon + label.
   */
  type?: 'state';
  state?: (row: T) => FpcTableState | null;
  /** State column: show the label beside the icon. Default `true` (icon only). */
  iconOnly?: boolean;
  /** Responsive priority (default 2; the name column and the State column always show). */
  priority?: FpcTableColumnPriority;
}

export interface FpcTableSort {
  column: string;
  direction: 'asc' | 'desc';
}

/** A saved view offered in the toolbar's "Views" menu. */
export interface FpcTableView {
  id: string;
  name: string;
}

export interface FpcDataTableLabels {
  search: string;
  filters: string;
  views: string;
  saveView: string;
  deleteView: string;
  noViews: string;
  columns: string;
  refresh: string;
  selectAll: string;
  selectRow: string;
  /** `{count}` is replaced with the number of selected rows. */
  selected: string;
  clearSelection: string;
  more: string;
  empty: string;
  /** Shown instead of `empty` while a search, chip or filter narrows the rows. */
  noMatches: string;
  noMatchesHint: string;
  rowActions: string;
  sortAscending: string;
  sortDescending: string;
  changed: string;
  state: string;
  pagination: string;
  previousPage: string;
  nextPage: string;
  pageSize: string;
  /** `{from}`, `{to}`, `{total}`. */
  range: string;
  /** Range without a known total: `{from}`, `{to}`. */
  rangeOpen: string;
  loadingMore: string;
  collapseGroup: string;
  expandGroup: string;
  /** Head overflow indicators (tooltips): scroll a wide table back / on sideways. */
  previousColumns: string;
  nextColumns: string;
}

export const FPC_DATA_TABLE_LABELS: FpcDataTableLabels = {
  search: 'Search',
  filters: 'Filters',
  views: 'Views',
  saveView: 'Save current view…',
  deleteView: 'Delete view',
  noViews: 'No saved views',
  columns: 'Columns',
  refresh: 'Refresh',
  selectAll: 'Select all',
  selectRow: 'Select row',
  selected: '{count} selected',
  clearSelection: 'Clear selection',
  more: 'More',
  empty: 'Nothing to show',
  noMatches: 'No matches',
  noMatchesHint: 'Nothing matches the search or filters.',
  rowActions: 'Row actions',
  sortAscending: 'Sorted ascending',
  sortDescending: 'Sorted descending',
  changed: 'Changed in the draft',
  state: 'State',
  pagination: 'Pagination',
  previousPage: 'Previous page',
  nextPage: 'Next page',
  pageSize: 'Rows per page',
  range: '{from}–{to} of {total}',
  rangeOpen: '{from}–{to}',
  loadingMore: 'Loading more…',
  collapseGroup: 'Collapse group',
  expandGroup: 'Expand group',
  previousColumns: 'Previous columns',
  nextColumns: 'Next columns',
};

/** Sort key of a State cell: severity (explicit or by tone), then label. */
export function fpcStateSortValue(state: FpcTableState | null | undefined): FpcTableCellValue {
  if (!state) return null;

  return `${String(state.severity ?? FPC_TABLE_STATE_SEVERITY[state.tone]).padStart(3, '0')} ${state.label}`;
}

/** The value a column sorts / renders by (`state` columns: severity key). */
export function fpcColumnValue<T>(column: FpcTableColumn<T>, row: T): FpcTableCellValue {
  if (column.value) return column.value(row);
  if (column.type === 'state' && column.state) return fpcStateSortValue(column.state(row));

  return null;
}

/** One page of client-side rows (1-based `page`). */
export function fpcPageSlice<T>(rows: readonly T[], page: number, pageSize: number): readonly T[] {
  const size = Math.max(1, pageSize);
  const start = (Math.max(1, page) - 1) * size;

  return rows.slice(start, start + size);
}

/** Last valid page for `total` rows (≥ 1). */
export function fpcPageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
}

/** Columns shown: `visible` ids (in column order) or the columns not `hidden`; `required` ones always. */
export function fpcVisibleColumns<T>(
  columns: readonly FpcTableColumn<T>[],
  visible: readonly string[] | null,
): FpcTableColumn<T>[] {
  const fixed = (column: FpcTableColumn<T>) => column.required || column.type === 'state';

  if (!visible) return columns.filter((column) => !column.hidden || fixed(column));

  const ids = new Set(visible);

  return columns.filter((column) => fixed(column) || ids.has(column.id));
}

function compareValues(a: FpcTableCellValue, b: FpcTableCellValue): number {
  const emptyA = a === null || a === undefined || a === '';
  const emptyB = b === null || b === undefined || b === '';

  if (emptyA || emptyB) return emptyA === emptyB ? 0 : emptyA ? 1 : -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;

  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

/** Rows sorted by `sort` (stable; empty values last in both directions). */
export function fpcSortRows<T>(
  rows: readonly T[],
  columns: readonly FpcTableColumn<T>[],
  sort: FpcTableSort | null,
): readonly T[] {
  const column = sort ? columns.find((candidate) => candidate.id === sort.column) : undefined;

  if (!sort || !column || (!column.value && !(column.type === 'state' && column.state))) return rows;

  const value = (row: T) => fpcColumnValue(column, row);
  const factor = sort.direction === 'asc' ? 1 : -1;

  return rows
    .map((row, index) => ({ row, index, key: value(row) }))
    .sort((a, b) => {
      const emptyA = a.key === null || a.key === undefined || a.key === '';
      const emptyB = b.key === null || b.key === undefined || b.key === '';

      if (emptyA !== emptyB) return emptyA ? 1 : -1;

      return compareValues(a.key, b.key) * factor || a.index - b.index;
    })
    .map((entry) => entry.row);
}

/** Next sort when a header is clicked: asc → desc → none. */
export function fpcNextSort(current: FpcTableSort | null, column: string): FpcTableSort | null {
  if (!current || current.column !== column) return { column, direction: 'asc' };
  if (current.direction === 'asc') return { column, direction: 'desc' };

  return null;
}

/** App-wide (localized) defaults for every `fpc-data-table`; a table's own `labels` still win. */
export const FPC_DATA_TABLE_DEFAULT_LABELS = new InjectionToken<Partial<FpcDataTableLabels>>(
  'FPC_DATA_TABLE_DEFAULT_LABELS',
  { providedIn: 'root', factory: () => ({}) },
);

/** Localize the data table texts once per app (e.g. "No matches" / "Nothing to show"). */
export function provideFpcDataTableLabels(labels: Partial<FpcDataTableLabels>): EnvironmentProviders {
  return makeEnvironmentProviders([{ provide: FPC_DATA_TABLE_DEFAULT_LABELS, useValue: labels }]);
}
