import type { FpcTableColumn } from '@forepath/shared/frontend/ui-components';

/**
 * Client-side search of the initiative tables (`fpc-data-table` shows the query, the page filters): a row matches
 * when every word of the query appears in the text of one of its columns (the human-readable labels the user sees,
 * state labels included) or in the extra text (e.g. a body that is not a column).
 */
export function filterInitiativeRows<T>(
  rows: readonly T[],
  query: string,
  columns: readonly FpcTableColumn<T>[],
  extra?: (row: T) => string | null | undefined,
): T[] {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);

  if (words.length === 0) {
    return [...rows];
  }

  return rows.filter((row) => {
    const text = [
      ...columns.map((column) => {
        if (column.type === 'state') {
          return column.state?.(row)?.label ?? '';
        }

        const value = column.value?.(row);

        return value === null || value === undefined ? '' : String(value);
      }),
      extra?.(row) ?? '',
    ]
      .join('\n')
      .toLocaleLowerCase();

    return words.every((word) => text.includes(word));
  });
}
