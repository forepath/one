/**
 * One entry of a generated menu (`fpc-context-menu`, the "More" menus of `fpc-object-header` and
 * `fpc-data-table`). Labels are passed in already localized by the consumer.
 */
export interface FpcMenuItem {
  id: string;
  label: string;
  /** Bootstrap icon name without `bi-`. */
  icon?: string;
  disabled?: boolean;
  /** Destructive entry (red text). */
  danger?: boolean;
  /** Native tooltip, e.g. why an entry is disabled. */
  title?: string;
  /** A divider is drawn above this entry. */
  dividerBefore?: boolean;
  /** Optional heading drawn above this entry (groups in long menus). */
  heading?: string;
}

/** The enabled entries of `items`, in order (keyboard navigation skips disabled ones). */
export function fpcEnabledMenuItems(items: readonly FpcMenuItem[]): FpcMenuItem[] {
  return items.filter((item) => !item.disabled);
}
