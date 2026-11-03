/**
 * Sideways overflow of a scroll container, shared by the step strip chevrons (`fpcStepStrip`) and the data table's
 * head indicators (`fpc-data-table`): where the container sits between its ends and how far one chevron click pages.
 */

/** Rounding slack when deciding whether a container overflows / sits at one of its ends. */
export const FPC_SCROLL_EDGE_PX = 1;

/** Share of the visible width one page step scrolls (the neighbouring content stays partly in view). */
export const FPC_SCROLL_PAGE_SHARE = 0.75;

export interface FpcScrollEdges {
  /** The content is wider than the container: it scrolls sideways. */
  overflowing: boolean;
  atStart: boolean;
  atEnd: boolean;
}

/** Where `element` sits sideways (LTR). */
export function fpcScrollEdges(element: HTMLElement): FpcScrollEdges {
  const max = element.scrollWidth - element.clientWidth;

  return {
    overflowing: max > FPC_SCROLL_EDGE_PX,
    atStart: element.scrollLeft <= FPC_SCROLL_EDGE_PX,
    atEnd: element.scrollLeft >= max - FPC_SCROLL_EDGE_PX,
  };
}

/**
 * The `scrollLeft` one page towards `direction` lands on: about three quarters of the visible width, clamped.
 * `obscured`: width covered by content that doesn't scroll (sticky columns), so a page is what actually moves.
 */
export function fpcScrollPageTarget(element: HTMLElement, direction: -1 | 1, obscured = 0): number {
  const step = Math.max(1, (element.clientWidth - obscured) * FPC_SCROLL_PAGE_SHARE);

  return Math.max(0, Math.min(element.scrollWidth - element.clientWidth, element.scrollLeft + direction * step));
}

/** Scrolls `element` sideways to `left`: smooth when asked and the user doesn't prefer reduced motion. */
export function fpcScrollToLeft(element: HTMLElement, left: number, smooth: boolean): void {
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (typeof element.scrollTo === 'function')
    element.scrollTo({ left, behavior: smooth && !reduced ? 'smooth' : 'auto' });
  else element.scrollLeft = left;
}

/** A column's sideways extent in the scrolled content (px from its start). */
export interface FpcScrollColumn {
  left: number;
  right: number;
}

/**
 * The `scrollLeft` that reveals the next cut-off column towards `direction` (column-wise paging of the data table's
 * head indicators): forwards, the first column ending past the visible area ends at its right edge; backwards, the
 * last column starting before it starts at its left edge. `lead` / `trail`: widths covered by sticky columns at
 * either side. Clamped; without such a column, the end of that side.
 */
export function fpcScrollColumnTarget(
  element: Pick<HTMLElement, 'scrollLeft' | 'scrollWidth' | 'clientWidth'>,
  columns: readonly FpcScrollColumn[],
  direction: -1 | 1,
  lead = 0,
  trail = 0,
): number {
  const max = Math.max(0, element.scrollWidth - element.clientWidth);
  const viewLeft = element.scrollLeft + lead;
  const viewRight = element.scrollLeft + element.clientWidth - trail;
  const target =
    direction === 1
      ? (() => {
          const next = columns.find((c) => c.right > viewRight + FPC_SCROLL_EDGE_PX);

          return next ? next.right - (element.clientWidth - trail) : max;
        })()
      : (() => {
          const previous = [...columns].reverse().find((c) => c.left < viewLeft - FPC_SCROLL_EDGE_PX);

          return previous ? previous.left - lead : 0;
        })();

  return Math.max(0, Math.min(max, target));
}
